import type { Connection, VersionedTransaction } from "@solana/web3.js";
import type { SwapRequest, SwapResult } from "@fineprint/core";
import {
  buildUnsignedSwap,
  destinationAtaFor,
  readAtaState,
  type UnsignedSwap,
} from "./build.js";
import type { ExecMintFacts } from "./mint.js";
import { transferFeeOf } from "./fee.js";
import {
  FinalizationTimeoutError,
  TransactionExpiredError,
  WalletMutatedTransactionError,
} from "./errors.js";

export type SignTransaction = (
  tx: VersionedTransaction,
) => Promise<VersionedTransaction>;

export interface StatusUpdate {
  phase: string;
  detail?: string;
}

export interface ExecuteOptions {
  facts?: ExecMintFacts;
  toleranceBps?: number;
  finalizeTimeoutMs?: number;
  pollIntervalMs?: number;
  onStatus?: (s: StatusUpdate) => void;
}

export interface ConfirmFinalizedOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  onStatus?: (s: StatusUpdate) => void;
}

export interface PostConditionInput {
  expectedNetRaw: bigint;
  actualNetRaw: bigint;
  minimumNetRaw: bigint;
  grossRaw: bigint;
  withheldDeltaRaw: bigint;
  bps: number;
  maximumFee: bigint;
  toleranceBps: number;
}

export interface PostConditionVerdict {
  held: boolean;
  reasons: string[];
}

const DEFAULT_TOLERANCE_BPS = 25;
const DEFAULT_FINALIZE_TIMEOUT_MS = 180_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const TOLERANCE_DENOMINATOR = 10_000n;
const CEIL_ROUNDING_ADDEND = 9_999n;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function isZeroSignature(sig: Uint8Array): boolean {
  return sig.every((byte) => byte === 0);
}

export function evaluatePostCondition(
  p: PostConditionInput,
): PostConditionVerdict {
  const reasons: string[] = [];
  if (p.actualNetRaw <= 0n) {
    reasons.push(
      `destination balance did not move: actualNetRaw is ${p.actualNetRaw.toString()}, expected a positive amount`,
    );
  }
  const expectedWithheld = transferFeeOf(p.grossRaw, p.bps, p.maximumFee);
  if (p.withheldDeltaRaw !== expectedWithheld) {
    reasons.push(
      `withheld fee mismatch: gross ${p.grossRaw.toString()} at ${String(p.bps)} bps implies withheld ${expectedWithheld.toString()}, observed ${p.withheldDeltaRaw.toString()}`,
    );
  }
  if (p.actualNetRaw < p.minimumNetRaw) {
    reasons.push(
      `slippage floor breached: actual net ${p.actualNetRaw.toString()} is below minimum net ${p.minimumNetRaw.toString()}`,
    );
  }
  const toleranceRaw =
    (p.expectedNetRaw * BigInt(p.toleranceBps) + CEIL_ROUNDING_ADDEND) /
    TOLERANCE_DENOMINATOR;
  const drift =
    p.actualNetRaw >= p.expectedNetRaw
      ? p.actualNetRaw - p.expectedNetRaw
      : p.expectedNetRaw - p.actualNetRaw;
  if (drift > toleranceRaw) {
    reasons.push(
      `actual net ${p.actualNetRaw.toString()} drifted from expected net ${p.expectedNetRaw.toString()} by ${drift.toString()}, beyond tolerance ${toleranceRaw.toString()} (${String(p.toleranceBps)} bps)`,
    );
  }
  return { held: reasons.length === 0, reasons };
}

export async function confirmFinalized(
  conn: Connection,
  signature: string,
  lastValidBlockHeight: number,
  o?: ConfirmFinalizedOptions,
): Promise<{ slot: number; err: unknown }> {
  const timeoutMs = o?.timeoutMs ?? DEFAULT_FINALIZE_TIMEOUT_MS;
  const pollIntervalMs = o?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await conn.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = response.value[0];
    if (status !== null && status !== undefined) {
      if (status.err !== null) {
        return { slot: status.slot, err: status.err };
      }
      if (status.confirmationStatus === "finalized") {
        return { slot: status.slot, err: null };
      }
      o?.onStatus?.({
        phase: "pending",
        detail: status.confirmationStatus ?? "unknown",
      });
    } else {
      const height = await conn.getBlockHeight("finalized");
      if (height > lastValidBlockHeight) {
        throw new TransactionExpiredError(signature, lastValidBlockHeight);
      }
      o?.onStatus?.({ phase: "pending", detail: "unknown" });
    }
    if (Date.now() >= deadline) {
      throw new FinalizationTimeoutError(signature, timeoutMs);
    }
    await sleep(pollIntervalMs);
  }
}

async function readPostDeltas(
  conn: Connection,
  unsigned: UnsignedSwap,
  req: SwapRequest,
): Promise<{ actualNetRaw: bigint; withheldDeltaRaw: bigint; grossRaw: bigint }> {
  const destinationAtaKey = destinationAtaFor(
    unsigned.facts.mint,
    req.userPublicKey,
  );
  const post = await readAtaState(conn, destinationAtaKey, "finalized");
  const actualNetRaw = post.netRaw - unsigned.preNetRaw;
  const withheldDeltaRaw = post.withheldRaw - unsigned.preWithheldRaw;
  return {
    actualNetRaw,
    withheldDeltaRaw,
    grossRaw: actualNetRaw + withheldDeltaRaw,
  };
}

export async function executeSwap(
  conn: Connection,
  req: SwapRequest,
  signTransaction: SignTransaction,
  opts?: ExecuteOptions,
): Promise<SwapResult> {
  const toleranceBps = opts?.toleranceBps ?? DEFAULT_TOLERANCE_BPS;
  if (
    !Number.isInteger(toleranceBps) ||
    toleranceBps < 0 ||
    toleranceBps > 10_000
  ) {
    throw new RangeError(
      `toleranceBps must be an integer in 0..10000, received ${String(toleranceBps)}`,
    );
  }
  const finalizeTimeoutMs =
    opts?.finalizeTimeoutMs ?? DEFAULT_FINALIZE_TIMEOUT_MS;
  const pollIntervalMs = opts?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const unsigned = await buildUnsignedSwap(
    conn,
    req,
    opts?.facts === undefined ? undefined : { facts: opts.facts },
  );
  opts?.onStatus?.({ phase: "built", detail: unsigned.route });

  // Snapshot before handing the transaction out: a wallet that returns the same
  // object mutated in place would otherwise compare equal to itself.
  const messageBeforeSigning = unsigned.transaction.message.serialize();
  const signed = await signTransaction(unsigned.transaction);

  const firstSig = signed.signatures[0];
  if (firstSig === undefined || isZeroSignature(firstSig)) {
    throw new WalletMutatedTransactionError(
      "wallet returned a transaction without a signature at index 0; refusing to send an unsigned transaction",
    );
  }
  if (!bytesEqual(messageBeforeSigning, signed.message.serialize())) {
    throw new WalletMutatedTransactionError(
      "wallet altered the transaction message during signing; refusing to send",
    );
  }
  opts?.onStatus?.({ phase: "signed", detail: unsigned.route });

  const signature = await conn.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
    preflightCommitment: "confirmed",
  });
  opts?.onStatus?.({ phase: "sent", detail: signature });

  const scale = 10 ** unsigned.facts.decimals;
  const expectedNetDelta = Number(unsigned.expectedNetRaw) / scale;
  const explorerUrl = `https://solscan.io/tx/${signature}`;

  let slot: number;
  let confirmationErr: unknown;
  try {
    const confirmation = await confirmFinalized(
      conn,
      signature,
      unsigned.lastValidBlockHeight,
      {
        timeoutMs: finalizeTimeoutMs,
        pollIntervalMs,
        onStatus: opts?.onStatus,
      },
    );
    slot = confirmation.slot;
    confirmationErr = confirmation.err;
  } catch (err) {
    if (
      err instanceof TransactionExpiredError ||
      err instanceof FinalizationTimeoutError
    ) {
      let actualNetDelta = 0;
      try {
        const post = await readPostDeltas(conn, unsigned, req);
        actualNetDelta = Number(post.actualNetRaw) / scale;
      } catch {
        actualNetDelta = 0;
      }
      return {
        signature,
        confirmed: false,
        expectedNetDelta,
        actualNetDelta,
        postConditionHeld: false,
        slot: 0,
        explorerUrl,
      };
    }
    throw err;
  }

  const post = await readPostDeltas(conn, unsigned, req);
  const verdict = evaluatePostCondition({
    expectedNetRaw: unsigned.expectedNetRaw,
    actualNetRaw: post.actualNetRaw,
    minimumNetRaw: unsigned.minimumNetRaw,
    grossRaw: post.grossRaw,
    withheldDeltaRaw: post.withheldDeltaRaw,
    bps: unsigned.facts.inForceBps,
    maximumFee: unsigned.facts.inForceMaximumFee,
    toleranceBps,
  });
  const confirmed = confirmationErr === null;
  opts?.onStatus?.({
    phase: confirmed && verdict.held ? "verified" : "post-condition-failed",
    detail:
      confirmationErr === null
        ? verdict.reasons.join("; ")
        : `transaction failed on chain: ${JSON.stringify(confirmationErr)}`,
  });
  return {
    signature,
    confirmed,
    expectedNetDelta,
    actualNetDelta: Number(post.actualNetRaw) / scale,
    postConditionHeld: confirmed && verdict.held,
    slot,
    explorerUrl,
  };
}
