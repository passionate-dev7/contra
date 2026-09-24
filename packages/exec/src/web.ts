/**
 * Server-side adapter for the split the browser needs: build here, sign in the
 * wallet, confirm here. No key crosses either boundary.
 *
 * The confirm half verifies against the finalized transaction itself rather than
 * a wall-clock before/after read, so nothing another transfer does to the same
 * account in the same second can be mistaken for this swap's result.
 */
import type { Connection, ParsedInstruction, PartiallyDecodedInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import type { SwapRequest, SwapResult } from "@fineprint/core";
import { buildUnsignedSwap, destinationAtaFor } from "./build.js";
import { readExecMintFacts, type ExecMintFacts } from "./mint.js";
import { transferFeeOf } from "./fee.js";
import { defaultConnection } from "./connection.js";

export interface WebUnsignedSwap {
  /** Base64 serialized VersionedTransaction. The browser wallet signs it. */
  transactionBase64: string;
  lastValidBlockHeight: number;
  /** Token units expected to land, already net of the in-force transfer fee. */
  expectedNetDelta: number;
  /** The fee tier actually in force this epoch, which is not always the newest one. */
  inForceBps: number;
  route: string;
  destinationAta: string;
  quoteSemantics: "gross" | "net";
}

export interface FinalizedSwapEvidence {
  signature: string;
  slot: number;
  err: unknown;
  destinationAta: string;
  /** Amount the route sent, read out of the Token-2022 transfer instruction. */
  grossRaw: bigint;
  /** What the fee schedule says was withheld from that gross. */
  feeRaw: bigint;
  /** grossRaw - feeRaw: what should have landed. */
  netRaw: bigint;
  /** What the destination account's balance actually moved by, from the ledger. */
  balanceDeltaRaw: bigint;
  /** netRaw === balanceDeltaRaw. Two independent readings of the same event agree. */
  netMatchesBalanceDelta: boolean;
  transferCount: number;
}

export async function buildSwap(
  req: SwapRequest,
  conn: Connection = defaultConnection(),
): Promise<WebUnsignedSwap> {
  const built = await buildUnsignedSwap(conn, req);
  return {
    transactionBase64: Buffer.from(built.transaction.serialize()).toString("base64"),
    lastValidBlockHeight: built.lastValidBlockHeight,
    expectedNetDelta:
      Number(built.expectedNetRaw) / 10 ** built.facts.decimals,
    inForceBps: built.facts.inForceBps,
    route: built.route,
    destinationAta: built.destinationAta,
    quoteSemantics: built.quoteSemantics,
  };
}

function isParsed(
  ix: ParsedInstruction | PartiallyDecodedInstruction,
): ix is ParsedInstruction {
  return "parsed" in ix;
}

interface ParsedTransferInfo {
  destination?: unknown;
  mint?: unknown;
  tokenAmount?: { amount?: unknown };
}

/**
 * Read what a finalized transaction actually did to the destination token account.
 * Returns null while the transaction has not reached `finalized`.
 */
export async function readFinalizedSwapEvidence(
  conn: Connection,
  signature: string,
  mint: string,
  owner: string,
  facts: ExecMintFacts,
): Promise<FinalizedSwapEvidence | null> {
  const tx = await conn.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0,
    commitment: "finalized",
  });
  if (tx === null || tx.meta === null) {
    return null;
  }

  const destinationAta = destinationAtaFor(mint, owner).toBase58();
  const token2022 = TOKEN_2022_PROGRAM_ID.toBase58();

  const every: Array<ParsedInstruction | PartiallyDecodedInstruction> = [
    ...tx.transaction.message.instructions,
    ...(tx.meta.innerInstructions ?? []).flatMap((group) => group.instructions),
  ];

  let grossRaw = 0n;
  let transferCount = 0;
  for (const ix of every) {
    if (!isParsed(ix) || ix.programId.toBase58() !== token2022) {
      continue;
    }
    if (!String(ix.parsed.type).startsWith("transfer")) {
      continue;
    }
    const info = ix.parsed.info as ParsedTransferInfo;
    if (info.destination !== destinationAta || info.mint !== mint) {
      continue;
    }
    const amount = info.tokenAmount?.amount;
    if (typeof amount !== "string") {
      continue;
    }
    grossRaw += BigInt(amount);
    transferCount += 1;
  }

  const matches = (
    b: { mint: string; owner?: string },
  ): boolean => b.mint === mint && b.owner === owner;
  const pre = (tx.meta.preTokenBalances ?? []).find(matches);
  const post = (tx.meta.postTokenBalances ?? []).find(matches);
  const balanceDeltaRaw =
    BigInt(post?.uiTokenAmount.amount ?? "0") -
    BigInt(pre?.uiTokenAmount.amount ?? "0");

  const feeRaw = transferFeeOf(
    grossRaw,
    facts.inForceBps,
    facts.inForceMaximumFee,
  );
  const netRaw = grossRaw - feeRaw;

  return {
    signature,
    slot: tx.slot,
    err: tx.meta.err,
    destinationAta,
    grossRaw,
    feeRaw,
    netRaw,
    balanceDeltaRaw,
    netMatchesBalanceDelta: netRaw === balanceDeltaRaw,
    transferCount,
  };
}

/**
 * Poll a submitted signature to `finalized` and assert the post-condition.
 * `confirmed` and `processed` are not terminal states and are never treated as one.
 */
export async function confirmSwap(
  signature: string,
  req: SwapRequest,
  expectedNetDelta: number,
  o?: {
    conn?: Connection;
    facts?: ExecMintFacts;
    toleranceBps?: number;
    timeoutMs?: number;
    pollIntervalMs?: number;
  },
): Promise<SwapResult> {
  const conn = o?.conn ?? defaultConnection();
  const facts = o?.facts ?? (await readExecMintFacts(conn, req.mint));
  const toleranceBps = o?.toleranceBps ?? 25;
  const timeoutMs = o?.timeoutMs ?? 180_000;
  const pollIntervalMs = o?.pollIntervalMs ?? 2_000;
  const scale = 10 ** facts.decimals;
  const explorerUrl = `https://solscan.io/tx/${signature}`;
  const expectedNetRaw = BigInt(Math.round(expectedNetDelta * scale));

  const deadline = Date.now() + timeoutMs;
  let evidence: FinalizedSwapEvidence | null = null;
  for (;;) {
    evidence = await readFinalizedSwapEvidence(
      conn,
      signature,
      req.mint,
      req.userPublicKey,
      facts,
    );
    if (evidence !== null) {
      break;
    }
    if (Date.now() >= deadline) {
      return {
        signature,
        confirmed: false,
        expectedNetDelta,
        actualNetDelta: 0,
        postConditionHeld: false,
        slot: 0,
        explorerUrl,
      };
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, pollIntervalMs);
    });
  }

  const confirmed = evidence.err === null;
  const tolerance =
    (expectedNetRaw * BigInt(toleranceBps) + 9_999n) / 10_000n;
  const drift =
    evidence.balanceDeltaRaw >= expectedNetRaw
      ? evidence.balanceDeltaRaw - expectedNetRaw
      : expectedNetRaw - evidence.balanceDeltaRaw;

  const postConditionHeld =
    confirmed &&
    evidence.grossRaw > 0n &&
    evidence.balanceDeltaRaw > 0n &&
    evidence.netMatchesBalanceDelta &&
    drift <= tolerance;

  return {
    signature,
    confirmed,
    expectedNetDelta,
    actualNetDelta: Number(evidence.balanceDeltaRaw) / scale,
    postConditionHeld,
    slot: evidence.slot,
    explorerUrl,
  };
}
