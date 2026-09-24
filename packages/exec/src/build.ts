import type { Commitment, Connection } from "@solana/web3.js";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getTransferFeeAmount,
  unpackAccount,
} from "@solana/spl-token";
import type { SwapRequest } from "@fineprint/core";
import { readExecMintFacts, type ExecMintFacts } from "./mint.js";
import {
  USDC_MINT,
  getQuote,
  getSwapTransaction,
  routeLabel,
  type JupQuote,
} from "./jupiter.js";
import { grossForNet, netAfterTransferFee } from "./fee.js";
import {
  FrozenByDefaultError,
  MintPausedError,
  SimulationFailedError,
  WalletMutatedTransactionError,
} from "./errors.js";

const USDC_UNITS_PER_DOLLAR = 1_000_000;

export interface AtaState {
  exists: boolean;
  netRaw: bigint;
  withheldRaw: bigint;
}

export interface UnsignedSwap {
  transaction: VersionedTransaction;
  request: SwapRequest;
  facts: ExecMintFacts;
  quote: JupQuote;
  destinationAta: string;
  route: string;
  lastValidBlockHeight: number;
  quoteSemantics: "gross" | "net";
  expectedGrossRaw: bigint;
  expectedNetRaw: bigint;
  minimumNetRaw: bigint;
  transferFeeRaw: bigint;
  preNetRaw: bigint;
  preWithheldRaw: bigint;
  simulation: {
    err: unknown;
    unitsConsumed?: number;
    logs: string[];
    simulatedGrossRaw: bigint;
    simulatedNetRaw: bigint;
    simulatedWithheldRaw: bigint;
  };
}

/** Destination ATA for a Token-2022 mint. The program id is part of the PDA seeds. */
export function destinationAtaFor(mint: string, owner: string): PublicKey {
  return getAssociatedTokenAddressSync(
    new PublicKey(mint),
    new PublicKey(owner),
    true,
    TOKEN_2022_PROGRAM_ID,
  );
}

/** Decode a Token-2022 account: spendable `amount` and the withheld transfer fee. */
export function decodeAtaState(
  address: PublicKey,
  data: Buffer,
  owner: PublicKey,
  lamports: number,
): AtaState {
  const account = unpackAccount(
    address,
    { data, owner, lamports, executable: false, rentEpoch: 0 },
    TOKEN_2022_PROGRAM_ID,
  );
  const fee = getTransferFeeAmount(account);
  return {
    exists: true,
    netRaw: account.amount,
    withheldRaw: fee === null ? 0n : fee.withheldAmount,
  };
}

export async function readAtaState(
  conn: Connection,
  address: PublicKey,
  commitment: Commitment,
): Promise<AtaState> {
  const info = await conn.getAccountInfo(address, commitment);
  if (info === null) {
    return { exists: false, netRaw: 0n, withheldRaw: 0n };
  }
  return decodeAtaState(address, info.data, info.owner, info.lamports);
}

/** True only when no signature slot has been filled in. */
export function isFullyUnsigned(tx: VersionedTransaction): boolean {
  return tx.signatures.every((sig) => sig.every((byte) => byte === 0));
}

/**
 * Every account the transaction touches, static keys plus lookup-table entries it
 * actually indexes. The Token-2022 program id lives in a lookup table on a Jupiter
 * route, never in staticAccountKeys, so a naive check misses it.
 */
export async function resolvedAccountKeys(
  conn: Connection,
  tx: VersionedTransaction,
): Promise<PublicKey[]> {
  const keys = tx.message.staticAccountKeys.slice();
  for (const lookup of tx.message.addressTableLookups) {
    const table = await conn.getAddressLookupTable(lookup.accountKey);
    const addresses = table.value?.state.addresses;
    if (addresses === undefined) {
      continue;
    }
    for (const index of [...lookup.writableIndexes, ...lookup.readonlyIndexes]) {
      const key = addresses[index];
      if (key !== undefined) {
        keys.push(key);
      }
    }
  }
  return keys;
}

export async function buildUnsignedSwap(
  conn: Connection,
  req: SwapRequest,
  opts?: { facts?: ExecMintFacts; simulate?: boolean },
): Promise<UnsignedSwap> {
  if (!Number.isFinite(req.notionalUsd) || req.notionalUsd <= 0) {
    throw new RangeError(
      `notionalUsd must be a positive number, received ${String(req.notionalUsd)}`,
    );
  }
  if (
    !Number.isInteger(req.slippageBps) ||
    req.slippageBps < 1 ||
    req.slippageBps > 5000
  ) {
    throw new RangeError(
      `slippageBps must be an integer in 1..5000, received ${String(req.slippageBps)}`,
    );
  }

  const facts = opts?.facts ?? (await readExecMintFacts(conn, req.mint));

  // Fail before touching Jupiter: the issuer can halt every transfer of this mint.
  if (facts.paused) {
    throw new MintPausedError(facts.mint, facts.pausableAuthority);
  }

  const destinationAtaKey = destinationAtaFor(facts.mint, req.userPublicKey);
  const destinationAta = destinationAtaKey.toBase58();
  const pre = await readAtaState(conn, destinationAtaKey, "finalized");

  if (facts.defaultAccountState === "frozen" && !pre.exists) {
    throw new FrozenByDefaultError(facts.mint, destinationAta);
  }

  const amount = BigInt(Math.round(req.notionalUsd * USDC_UNITS_PER_DOLLAR));
  const quote = await getQuote({
    inputMint: USDC_MINT,
    outputMint: req.mint,
    amount,
    slippageBps: req.slippageBps,
  });
  const swapResponse = await getSwapTransaction({
    quote,
    userPublicKey: req.userPublicKey,
  });

  const transaction = VersionedTransaction.deserialize(
    Buffer.from(swapResponse.swapTransaction, "base64"),
  );
  if (!isFullyUnsigned(transaction)) {
    throw new WalletMutatedTransactionError(
      "Jupiter returned a transaction carrying a signature; refusing to hand a pre-signed transaction to a wallet",
    );
  }

  const keys = await resolvedAccountKeys(conn, transaction);
  if (!keys.some((key) => key.equals(TOKEN_2022_PROGRAM_ID))) {
    throw new Error(
      `Built transaction for ${facts.mint} does not touch the Token-2022 program ${TOKEN_2022_PROGRAM_ID.toBase58()}`,
    );
  }

  let simulatedNetRaw = 0n;
  let simulatedWithheldRaw = 0n;
  let simulatedGrossRaw = 0n;
  let unitsConsumed: number | undefined;
  let logs: string[] = [];

  if (opts?.simulate !== false) {
    const sim = await conn.simulateTransaction(transaction, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
      accounts: { encoding: "base64", addresses: [destinationAta] },
    });
    logs = sim.value.logs ?? [];
    unitsConsumed = sim.value.unitsConsumed ?? undefined;
    if (sim.value.err !== null) {
      throw new SimulationFailedError(sim.value.err, logs);
    }
    const simulated = sim.value.accounts?.[0];
    const encoded = simulated?.data?.[0];
    if (simulated === undefined || simulated === null || encoded === undefined) {
      throw new SimulationFailedError(
        "simulation returned no post-state for the destination token account",
        logs,
      );
    }
    const post = decodeAtaState(
      destinationAtaKey,
      Buffer.from(encoded, "base64"),
      new PublicKey(simulated.owner),
      simulated.lamports,
    );
    simulatedNetRaw = post.netRaw - pre.netRaw;
    simulatedWithheldRaw = post.withheldRaw - pre.withheldRaw;
    simulatedGrossRaw = simulatedNetRaw + simulatedWithheldRaw;
  }

  const bps = facts.inForceBps;
  const cap = facts.inForceMaximumFee;
  const quotedOut = BigInt(quote.outAmount);

  // Measured, not assumed: a Manifest-terminated route quotes the gross transfer
  // amount, a Meteora DLMM-terminated route quotes the amount net of the transfer
  // fee. Whichever the simulated post-state sits closer to is what the quote means.
  let quoteSemantics: "gross" | "net" = "gross";
  if (simulatedGrossRaw > 0n) {
    const toGross = absBigInt(quotedOut - simulatedGrossRaw);
    const toNet = absBigInt(quotedOut - simulatedNetRaw);
    quoteSemantics = toGross <= toNet ? "gross" : "net";
  }

  const expectedGrossRaw =
    quoteSemantics === "gross" ? quotedOut : grossForNet(quotedOut, bps, cap);
  const expectedNetRaw = netAfterTransferFee(expectedGrossRaw, bps, cap);
  const transferFeeRaw = expectedGrossRaw - expectedNetRaw;

  const quotedFloor = BigInt(quote.otherAmountThreshold);
  const thresholdGross =
    quoteSemantics === "gross" ? quotedFloor : grossForNet(quotedFloor, bps, cap);
  const minimumNetRaw = netAfterTransferFee(thresholdGross, bps, cap);

  return {
    transaction,
    request: req,
    facts,
    quote,
    destinationAta,
    route: routeLabel(quote),
    lastValidBlockHeight: swapResponse.lastValidBlockHeight,
    quoteSemantics,
    expectedGrossRaw,
    expectedNetRaw,
    minimumNetRaw,
    transferFeeRaw,
    preNetRaw: pre.netRaw,
    preWithheldRaw: pre.withheldRaw,
    simulation: {
      err: null,
      unitsConsumed,
      logs,
      simulatedGrossRaw,
      simulatedNetRaw,
      simulatedWithheldRaw,
    },
  };
}

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}
