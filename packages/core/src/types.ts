/**
 * Shared contract. Owned by the orchestrator, consumed by every package.
 * Do not change a field here without updating every consumer in the same commit.
 *
 * Every value in MintFacts is decoded from mainnet via getAccountInfo(jsonParsed).
 * Nothing here is read from an issuer website or a price API.
 */

/** A Token-2022 transfer fee tier, as stored on the mint. */
export interface TransferFeeTier {
  epoch: number;
  transferFeeBasisPoints: number;
  /** u64 max means uncapped. Kept as string because it overflows Number. */
  maximumFee: string;
}

/**
 * Scaled UI amount state.
 *
 * The trap: `multiplier` is the OLD value and stays stale after a change lands.
 * Once `newMultiplierEffectiveTimestamp` is in the past, the operative value is
 * `newMultiplier`. Reading `multiplier` naively reports SPACEX 5x wrong.
 */
export interface ScaledUiAmount {
  multiplier: string;
  newMultiplier: string;
  newMultiplierEffectiveTimestamp: number;
  /** Computed: whichever of the two is in force at `asOfUnix`. */
  operativeMultiplier: number;
}

/** Powers the issuer holds over a holder's tokens, decoded from extensions. */
export interface IssuerPowers {
  /** Can move any holder's tokens without consent. */
  permanentDelegate: string | null;
  /** Can halt all transfers. */
  pausableAuthority: string | null;
  paused: boolean;
  /** Can raise the transfer fee. It already doubled once. */
  transferFeeAuthority: string | null;
  withdrawWithheldAuthority: string | null;
  transferHookAuthority: string | null;
  transferHookProgramId: string | null;
  scaledUiAmountAuthority: string | null;
  /** "frozen" means accounts are allowlisted by default. */
  defaultAccountState: string | null;
  /** True when one key holds every lever above. */
  singleKeyControlsAll: boolean;
  distinctAuthorities: string[];
}

export interface MintFacts {
  symbol: string;
  mint: string;
  /** TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb for Token-2022. */
  ownerProgram: string;
  decimals: number;
  /** Raw on-chain supply, before decimals and before the multiplier. */
  rawSupply: string;
  /** rawSupply / 10^decimals * operativeMultiplier. The number a human should see. */
  effectiveSupply: number;
  transferFee: {
    /** The NEWER tier as stored on the mint. A schedule, not necessarily the live rate. */
    current: TransferFeeTier;
    /** The OLDER tier as stored on the mint. Null only when both tiers are identical. */
    previous: TransferFeeTier | null;
    /**
     * Basis points charged on a single transfer RIGHT NOW.
     *
     * This is the in-force tier, selected by epoch: the newest tier whose
     * activation epoch is at or below the chain's current epoch. It is not
     * always `current.transferFeeBasisPoints`, and treating it as such
     * overstates the fee for the whole window between the authority scheduling
     * a change and the epoch rolling over.
     */
    currentBps: number;
    /** A round trip is two transfers. Derived from `currentBps`, so also in-force. */
    roundTripBps: number;
    /** Whether the IN-FORCE tier's maximumFee is u64 max. */
    uncapped: boolean;
    /** Basis points of a scheduled tier that has not activated yet. Null when none is pending. */
    pendingBps?: number | null;
    /** The epoch at which `pendingBps` starts being charged. Null when none is pending. */
    pendingActivationEpoch?: number | null;
    /** The chain epoch the in-force selection was made against, from getEpochInfo. */
    currentEpoch?: number;
    /** Slots remaining before `pendingActivationEpoch` begins. Null when none is pending. */
    slotsUntilActivation?: number | null;
    /** `slotsUntilActivation` at Solana's 0.4s target slot time. Null when none is pending. */
    secondsUntilActivation?: number | null;
  };
  scaledUiAmount: ScaledUiAmount | null;
  powers: IssuerPowers;
  extensionsPresent: string[];
  asOfUnix: number;
  slot: number;
}

/** What the naive reading would have produced, so the UI can show the delta. */
export interface NaiveVsCorrect {
  symbol: string;
  naiveSupply: number;
  correctSupply: number;
  /** correct/naive - 1, as a percentage. SPACEX = +400%. */
  errorPct: number;
}

/* ------------------------------------------------------------------ */
/* Cost surface                                                        */
/* ------------------------------------------------------------------ */

export type Venue = "forge" | "equityzen" | "hiive" | "onchain";

/** Fee schedules quoted from each venue's Form CRS or published fee page. */
export interface TradFiQuote {
  venue: Exclude<Venue, "onchain">;
  buyFeePct: number;
  sellFeePct: number;
  /** Days to close. Sources disagree; carry both and cite which. */
  daysToCloseLow: number;
  daysToCloseHigh: number;
  sourceUrl: string;
  sourceNote: string;
}

export interface OnChainQuote {
  symbol: string;
  notionalUsd: number;
  /** AMM price impact on the buy leg, bps. */
  buyImpactBps: number;
  sellImpactBps: number;
  /** Token-2022 issuer fee, both legs. */
  transferFeeBps: number;
  /** Everything in, round trip. */
  totalRoundTripBps: number;
  /** Seconds, not days. */
  settlementSeconds: number;
  route: string;
  quotedAtUnix: number;
}

/**
 * The verdict. This is the product.
 *
 * `useOnChain: false` is a legitimate and expected output. A tool that tells you
 * not to trade is the differentiator; refusing to emit it would make this a
 * brochure for the on-chain path rather than an honest cost surface.
 */
export interface CostVerdict {
  symbol: string;
  notionalUsd: number;
  onChain: OnChainQuote;
  bestTradFi: TradFiQuote;
  onChainTotalPct: number;
  tradFiTotalPct: number;
  /** Positive means on-chain is cheaper by this many percentage points. */
  advantagePct: number;
  useOnChain: boolean;
  /** Plain sentence shown to the user, including when the answer is "don't". */
  reason: string;
  /** Speed advantage survives even when cost does not. */
  settlementAdvantage: string;
}

/* ------------------------------------------------------------------ */
/* Execution                                                           */
/* ------------------------------------------------------------------ */

export interface SwapRequest {
  symbol: string;
  mint: string;
  notionalUsd: number;
  /** Wallet public key. A private key never enters this process. */
  userPublicKey: string;
  slippageBps: number;
}

/**
 * Post-condition of a swap. An accepted transaction is not a completed one:
 * we assert the destination balance moved by the expected amount net of the
 * 100bps transfer fee, or we report failure.
 */
export interface SwapResult {
  signature: string;
  confirmed: boolean;
  expectedNetDelta: number;
  actualNetDelta: number;
  /** actual within tolerance of expected */
  postConditionHeld: boolean;
  slot: number;
  explorerUrl: string;
}
