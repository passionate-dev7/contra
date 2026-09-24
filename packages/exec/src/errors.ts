export interface ExecErrorDetails {
  cause?: unknown;
}

function applyCause(
  target: Error,
  details: ExecErrorDetails | undefined,
): void {
  if (details !== undefined && details.cause !== undefined) {
    (target as { cause?: unknown }).cause = details.cause;
  }
}

export class ExecError extends Error {
  readonly code: string;

  constructor(message: string, code: string, details?: ExecErrorDetails) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = new.target.name;
    this.code = code;
    applyCause(this, details);
  }
}

export interface MintIdentityDetails extends ExecErrorDetails {
  mint?: string;
  ownerProgram?: string;
}

export class NotToken2022Error extends ExecError {
  readonly mint?: string;
  readonly ownerProgram?: string;

  constructor(message?: string, details?: MintIdentityDetails) {
    super(
      message ?? "Mint is not owned by the Token-2022 program",
      "NOT_TOKEN_2022",
      details,
    );
    this.mint = details?.mint;
    this.ownerProgram = details?.ownerProgram;
  }
}

export class NoTransferFeeConfigError extends ExecError {
  readonly mint?: string;

  constructor(message?: string, details?: MintIdentityDetails) {
    super(
      message ?? "Mint has no transferFeeConfig extension",
      "NO_TRANSFER_FEE_CONFIG",
      details,
    );
    this.mint = details?.mint;
  }
}

export interface MintPausedDetails extends ExecErrorDetails {
  mint?: string;
  pausableAuthority?: string | null;
}

export class MintPausedError extends ExecError {
  readonly mint: string;
  readonly pausableAuthority: string | null;

  constructor(
    mint = "unknown",
    pausableAuthority: string | null = null,
    message?: string,
    details?: ExecErrorDetails,
  ) {
    const authority = pausableAuthority ?? "unknown";
    super(
      message ??
        `Mint ${mint} is paused by pausable authority ${authority}: issuer has halted transfers`,
      "MINT_PAUSED",
      details,
    );
    this.mint = mint;
    this.pausableAuthority = pausableAuthority;
  }
}

export interface FrozenByDefaultDetails extends ExecErrorDetails {
  mint?: string;
  destinationAta?: string;
}

export class FrozenByDefaultError extends ExecError {
  readonly mint: string;
  readonly destinationAta: string;

  constructor(
    mint = "unknown",
    destinationAta = "unknown",
    message?: string,
    details?: ExecErrorDetails,
  ) {
    super(
      message ??
        `Mint ${mint} has defaultAccountState frozen: tokens for ${destinationAta} would land in a frozen account`,
      "FROZEN_BY_DEFAULT",
      details,
    );
    this.mint = mint;
    this.destinationAta = destinationAta;
  }
}

export interface JupiterApiDetails extends ExecErrorDetails {
  status?: number;
  body?: string;
}

export class JupiterApiError extends ExecError {
  readonly status: number;
  readonly body: string;

  constructor(status = 0, body = "", message?: string, details?: ExecErrorDetails) {
    super(
      message ?? `Jupiter API error (status ${String(status)}): ${body.slice(0, 200)}`,
      "JUPITER_API_ERROR",
      details,
    );
    this.status = status;
    this.body = body;
  }
}

export interface SimulationFailedDetails extends ExecErrorDetails {
  err?: unknown;
  logs?: string[];
}

export class SimulationFailedError extends ExecError {
  readonly err: unknown;
  readonly logs: string[];

  constructor(
    err: unknown = "unknown",
    logs: string[] = [],
    message?: string,
    details?: ExecErrorDetails,
  ) {
    const tail = logs.slice(-20).join("\n");
    super(
      message ?? `Simulation failed: ${String(err)}${tail === "" ? "" : `\n${tail}`}`,
      "SIMULATION_FAILED",
      details,
    );
    this.err = err;
    this.logs = logs;
  }
}

export interface TransactionExpiredDetails extends ExecErrorDetails {
  transactionSignature?: string;
  lastValidBlockHeight?: number;
}

export class TransactionExpiredError extends ExecError {
  readonly transactionSignature: string;
  readonly lastValidBlockHeight: number;

  constructor(
    transactionSignature = "unknown",
    lastValidBlockHeight = 0,
    message?: string,
    details?: ExecErrorDetails,
  ) {
    super(
      message ??
        `Transaction ${transactionSignature} expired before finalization (lastValidBlockHeight ${String(lastValidBlockHeight)})`,
      "TRANSACTION_EXPIRED",
      details,
    );
    this.transactionSignature = transactionSignature;
    this.lastValidBlockHeight = lastValidBlockHeight;
  }
}

export interface FinalizationTimeoutDetails extends ExecErrorDetails {
  transactionSignature?: string;
  timeoutMs?: number;
}

export class FinalizationTimeoutError extends ExecError {
  readonly transactionSignature: string;
  readonly timeoutMs: number;

  constructor(
    transactionSignature = "unknown",
    timeoutMs = 0,
    message?: string,
    details?: ExecErrorDetails,
  ) {
    super(
      message ??
        `Timed out waiting for finalized confirmation of ${transactionSignature} after ${String(timeoutMs)}ms`,
      "FINALIZATION_TIMEOUT",
      details,
    );
    this.transactionSignature = transactionSignature;
    this.timeoutMs = timeoutMs;
  }
}

export interface PostConditionDetails extends ExecErrorDetails {
  reasons?: string[];
}

export class PostConditionError extends ExecError {
  readonly reasons: string[];

  constructor(message?: string, details?: PostConditionDetails) {
    const reasons = details?.reasons ?? [];
    super(
      message ??
        (reasons.length > 0
          ? `Post-condition failed: ${reasons.join("; ")}`
          : "Post-condition failed"),
      "POST_CONDITION_FAILED",
      details,
    );
    this.reasons = reasons;
  }
}

export class WalletMutatedTransactionError extends ExecError {
  constructor(message?: string, details?: ExecErrorDetails) {
    super(
      message ?? "Wallet mutated the transaction message during signing",
      "WALLET_MUTATED_TRANSACTION",
      details,
    );
  }
}
