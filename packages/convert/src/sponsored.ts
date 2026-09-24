import type { Connection } from "@solana/web3.js";
import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { JupiterApiError, getQuote } from "@fineprint/exec";

export const SWAP_INSTRUCTIONS_URL =
  "https://lite-api.jup.ag/swap/v1/swap-instructions";

const REQUEST_TIMEOUT_MS = 15_000;

export interface SponsoredConversionParams {
  connection: Connection;
  owner: string;
  feePayer: string;
  fromMint: string;
  toMint: string;
  amountRaw: string | bigint | number;
}

interface JupAccountMeta {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

interface JupInstruction {
  programId: string;
  accounts: JupAccountMeta[];
  data: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asInstruction(value: unknown, what: string): JupInstruction {
  if (!isRecord(value)) {
    throw new JupiterApiError(0, `swap-instructions: ${what} is not an object`);
  }
  if (typeof value["programId"] !== "string") {
    throw new JupiterApiError(0, `swap-instructions: ${what} missing programId`);
  }
  if (!Array.isArray(value["accounts"])) {
    throw new JupiterApiError(0, `swap-instructions: ${what} missing accounts`);
  }
  if (typeof value["data"] !== "string") {
    throw new JupiterApiError(0, `swap-instructions: ${what} missing data`);
  }
  for (const meta of value["accounts"] as unknown[]) {
    if (
      !isRecord(meta) ||
      typeof meta["pubkey"] !== "string" ||
      typeof meta["isSigner"] !== "boolean" ||
      typeof meta["isWritable"] !== "boolean"
    ) {
      throw new JupiterApiError(
        0,
        `swap-instructions: ${what} has a malformed account meta`,
      );
    }
  }
  return value as unknown as JupInstruction;
}

function asInstructionList(value: unknown, what: string): JupInstruction[] {
  if (!Array.isArray(value)) {
    throw new JupiterApiError(0, `swap-instructions: ${what} is not an array`);
  }
  return value.map((entry, index) => asInstruction(entry, `${what}[${index}]`));
}

async function postSwapInstructions(
  quote: Record<string, unknown>,
  owner: string,
  feePayer: string | null,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(SWAP_INSTRUCTIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: owner,
        ...(feePayer === null ? {} : { payer: feePayer }),
        wrapAndUnwrapSol: false,
        dynamicComputeUnitLimit: true,
      }),
      signal: controller.signal,
    });
    const bodyText = await res.text();
    if (!res.ok) {
      throw new JupiterApiError(res.status, bodyText);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText) as unknown;
    } catch {
      throw new JupiterApiError(res.status, bodyText);
    }
    if (!isRecord(parsed)) {
      throw new JupiterApiError(res.status, bodyText);
    }
    if ("error" in parsed && Boolean(parsed["error"])) {
      throw new JupiterApiError(res.status, bodyText);
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

function toInstruction(ix: JupInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((meta) => ({
      pubkey: new PublicKey(meta.pubkey),
      isSigner: meta.isSigner,
      isWritable: meta.isWritable,
    })),
    data: Buffer.from(ix.data, "base64"),
  });
}

/**
 * If Jupiter ignored (or rejected) the separate `payer` field, its setup
 * instructions fund new ATA rent from the owner. The sponsor must pay that
 * rent, so rewrite the funder (accounts[0] of an Associated Token Program
 * create / createIdempotent) from the owner to the fee payer.
 */
function sponsorAtaRent(
  instructions: TransactionInstruction[],
  owner: PublicKey,
  feePayer: PublicKey,
): void {
  for (const ix of instructions) {
    if (!ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      continue;
    }
    if (ix.keys.length === 0) {
      continue;
    }
    const funder = ix.keys[0];
    if (funder !== undefined && funder.pubkey.equals(owner)) {
      funder.pubkey = feePayer;
    }
  }
}

/**
 * Build an UNSIGNED v0 sponsored conversion: the owner signs as the token
 * authority, the fee payer (transaction payerKey) covers fees and ATA rent.
 */
export async function buildSponsoredConversion(
  p: SponsoredConversionParams,
): Promise<VersionedTransaction> {
  const ownerPk = new PublicKey(p.owner);
  const feePayerPk = new PublicKey(p.feePayer);
  if (ownerPk.equals(feePayerPk)) {
    throw new RangeError("fee payer must be the sponsor, not the holder");
  }
  const amount = BigInt(p.amountRaw);
  if (amount <= 0n) {
    throw new RangeError(`amountRaw must be positive, received ${String(p.amountRaw)}`);
  }

  // Quote path reuses @fineprint/exec (same Jupiter Swap API v1 endpoint).
  const quote = await getQuote({
    inputMint: p.fromMint,
    outputMint: p.toMint,
    amount,
    slippageBps: 300,
  });

  // Jupiter supports a separate `payer` for rent/fees; if this deployment
  // does not, fall back to rebuilding the rent payer locally below.
  let body: Record<string, unknown>;
  try {
    body = await postSwapInstructions(
      quote as unknown as Record<string, unknown>,
      p.owner,
      p.feePayer,
    );
  } catch (err) {
    if (!(err instanceof JupiterApiError)) {
      throw err;
    }
    body = await postSwapInstructions(
      quote as unknown as Record<string, unknown>,
      p.owner,
      null,
    );
  }

  const computeBudget = asInstructionList(
    body["computeBudgetInstructions"] ?? [],
    "computeBudgetInstructions",
  );
  const setup = asInstructionList(
    body["setupInstructions"] ?? [],
    "setupInstructions",
  );
  if (!isRecord(body["swapInstruction"])) {
    throw new JupiterApiError(0, "swap-instructions: missing swapInstruction");
  }
  const swap = asInstruction(body["swapInstruction"], "swapInstruction");
  const other = asInstructionList(
    body["otherInstructions"] ?? [],
    "otherInstructions",
  );
  const cleanupRaw = body["cleanupInstruction"];
  const cleanup =
    cleanupRaw === null || cleanupRaw === undefined
      ? null
      : asInstruction(cleanupRaw, "cleanupInstruction");

  const instructions = [
    ...computeBudget.map(toInstruction),
    ...setup.map(toInstruction),
    toInstruction(swap),
    ...other.map(toInstruction),
    ...(cleanup === null ? [] : [toInstruction(cleanup)]),
  ];
  sponsorAtaRent(instructions, ownerPk, feePayerPk);

  const tableAddresses = body["addressLookupTableAddresses"];
  if (!Array.isArray(tableAddresses)) {
    throw new JupiterApiError(
      0,
      "swap-instructions: missing addressLookupTableAddresses",
    );
  }
  const lookups = [];
  for (const entry of tableAddresses) {
    if (typeof entry !== "string") {
      throw new JupiterApiError(
        0,
        "swap-instructions: addressLookupTableAddresses entry is not a string",
      );
    }
    const table = await p.connection.getAddressLookupTable(
      new PublicKey(entry),
    );
    if (table.value === null) {
      throw new Error(`address lookup table ${entry} not found on-chain`);
    }
    lookups.push(table.value);
  }

  const { blockhash } = await p.connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: feePayerPk,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lookups);
  return new VersionedTransaction(message);
}
