import Decimal from "decimal.js";
import { PublicKey } from "@solana/web3.js";
import { DEFAULT_RPC_URL, TOKEN_2022_PROGRAM_ID, web3Connection } from "@contra/short";
import { readReserveRows, type ReserveRow } from "@/lib/reserves";

export interface HedgeHolding {
  symbol: string;
  mint: string;
  amountRaw: string;
  amountUi: number;
  usd: number | null;
}

export interface HedgeSuggestion {
  ticker: string;
  borrowRaw: string;
  reason: string;
}

export interface HedgePlan extends HedgeSuggestion {
  borrowUi: number;
  sizeUsd: number;
  collateralRaw: string;
  collateralUsdc: number;
  usdcDecimals: number;
  priceUsd: number;
  borrowFactor: number;
  safeLtvPct: number;
  availableBorrowRaw: string;
  xstockDecimals: number;
}

export interface HedgeAnalysis {
  holdings: HedgeHolding[];
  suggestion: HedgeSuggestion;
  plan: HedgePlan | null;
}

type ParsedTokenInfo = {
  mint: string;
  amountRaw: string;
  decimals: number;
};

type InternalHolding = HedgeHolding & {
  reserve: ReserveRow;
  usdDecimal: Decimal | null;
};

function tokenInfo(account: { data: { parsed: unknown } }): ParsedTokenInfo | null {
  if (typeof account.data.parsed !== "object" || account.data.parsed === null) return null;
  const parsed = account.data.parsed as { info?: unknown };
  if (typeof parsed.info !== "object" || parsed.info === null) return null;
  const info = parsed.info as { mint?: unknown; tokenAmount?: unknown };
  if (typeof info.mint !== "string" || typeof info.tokenAmount !== "object" || info.tokenAmount === null) return null;
  const tokenAmount = info.tokenAmount as { amount?: unknown; decimals?: unknown };
  if (typeof tokenAmount.amount !== "string") return null;
  const decimals = Number(tokenAmount.decimals);
  if (!Number.isSafeInteger(decimals) || decimals < 0) return null;
  try {
    const amount = BigInt(tokenAmount.amount);
    if (amount < 0n) return null;
    return { mint: info.mint, amountRaw: amount.toString(), decimals };
  } catch {
    return null;
  }
}

function rawToDecimal(raw: bigint, decimals: number): Decimal {
  return new Decimal(raw.toString()).div(new Decimal(10).pow(decimals));
}

function validOwner(owner: string): boolean {
  try {
    new PublicKey(owner);
    return true;
  } catch {
    return false;
  }
}

function emptySuggestion(reason: string): HedgeSuggestion {
  return { ticker: "", borrowRaw: "0", reason };
}

function nonnegativeBigInt(value: string): bigint | null {
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : null;
  } catch {
    return null;
  }
}

function reserveAvailableBorrow(reserve: ReserveRow): bigint | null {
  const availableLiquidity = nonnegativeBigInt(reserve.availableRaw);
  const borrowLimit = nonnegativeBigInt(reserve.borrowLimitRaw);
  const totalBorrowed = nonnegativeBigInt(reserve.totalBorrowedRaw);
  if (availableLiquidity === null || borrowLimit === null || totalBorrowed === null) return null;
  const remainingCap = borrowLimit > totalBorrowed ? borrowLimit - totalBorrowed : 0n;
  return availableLiquidity < remainingCap ? availableLiquidity : remainingCap;
}

export async function readHedge(owner: string): Promise<HedgeAnalysis> {
  const rows = await readReserveRows();
  const xstockReserves = new Map(rows.filter((row) => row.isXstock).map((row) => [row.mint, row]));
  const usdc = rows.find((row) => row.symbol === "USDC");
  const connection = web3Connection(process.env["SOLANA_RPC_URL"]?.trim() || DEFAULT_RPC_URL);
  const accounts = await connection.getParsedTokenAccountsByOwner(new PublicKey(owner), {
    programId: new PublicKey(TOKEN_2022_PROGRAM_ID),
  });

  const totals = new Map<string, bigint>();
  for (const account of accounts.value) {
    const info = tokenInfo(account.account);
    if (info === null) continue;
    const reserve = xstockReserves.get(info.mint);
    if (reserve === undefined || info.decimals !== reserve.decimals) continue;
    totals.set(info.mint, (totals.get(info.mint) ?? 0n) + BigInt(info.amountRaw));
  }

  const internal: InternalHolding[] = [];
  for (const reserve of xstockReserves.values()) {
    const amountRaw = totals.get(reserve.mint) ?? 0n;
    if (amountRaw <= 0n) continue;
    const amountUiDecimal = rawToDecimal(amountRaw, reserve.decimals);
    const usdDecimal = reserve.priceUsd !== null && reserve.oracleValid && reserve.priceUsd > 0
      ? amountUiDecimal.mul(reserve.priceUsd)
      : null;
    internal.push({
      symbol: reserve.symbol,
      mint: reserve.mint,
      amountRaw: amountRaw.toString(),
      amountUi: amountUiDecimal.toNumber(),
      usd: usdDecimal?.toNumber() ?? null,
      reserve,
      usdDecimal,
    });
  }
  internal.sort((a, b) => {
    if (a.usdDecimal !== null && b.usdDecimal !== null) return b.usdDecimal.comparedTo(a.usdDecimal);
    if (a.usdDecimal !== null) return -1;
    if (b.usdDecimal !== null) return 1;
    return b.amountUi - a.amountUi;
  });

  const holdings = internal.map(({ reserve: _reserve, usdDecimal: _usdDecimal, ...holding }) => holding);
  const eligible = internal.filter((holding) => {
    const borrowFactor = holding.reserve.pairBorrowFactor ?? holding.reserve.borrowFactor;
    return (
      holding.reserve.borrowable &&
      holding.usdDecimal !== null &&
      holding.reserve.priceUsd !== null &&
      holding.reserve.priceUsd > 0 &&
      (holding.reserve.pairMaxLtv ?? holding.reserve.maxLtv) > 0 &&
      borrowFactor !== null &&
      borrowFactor > 0
    );
  });
  const selected = eligible[0];
  if (selected === undefined || usdc === undefined) {
    const reason = usdc === undefined
      ? "USDC collateral is not available in the Kamino market."
      : "No positive xStock holding maps to a borrowable Kamino reserve with live pricing.";
    return { holdings, suggestion: emptySuggestion(reason), plan: null };
  }

  const halfHoldingRaw = BigInt(selected.amountRaw) / 2n;
  const availableBorrowRaw = reserveAvailableBorrow(selected.reserve);
  if (availableBorrowRaw === null) {
    return { holdings, suggestion: emptySuggestion(`Kamino returned an invalid available borrow amount for ${selected.symbol}.`), plan: null };
  }
  const borrowRaw = halfHoldingRaw < availableBorrowRaw ? halfHoldingRaw : availableBorrowRaw;
  if (borrowRaw <= 0n) {
    return { holdings, suggestion: emptySuggestion(`The ${selected.symbol} holding is too small to hedge in whole base units.`), plan: null };
  }

  const borrowFactor = selected.reserve.pairBorrowFactor ?? selected.reserve.borrowFactor;
  if (borrowFactor === null || borrowFactor <= 0) {
    return { holdings, suggestion: emptySuggestion(`Kamino returned an invalid borrow factor for ${selected.symbol}.`), plan: null };
  }
  const safeLtvPct = selected.reserve.pairMaxLtv ?? selected.reserve.maxLtv;
  const priceUsd = selected.reserve.priceUsd as number;
  const borrowUiDecimal = rawToDecimal(borrowRaw, selected.reserve.decimals);
  const sizeUsdDecimal = borrowUiDecimal.mul(priceUsd);
  const collateralRawDecimal = sizeUsdDecimal
    .mul(borrowFactor)
    .div(safeLtvPct / 100)
    .mul(new Decimal(10).pow(usdc.decimals))
    .ceil();
  const collateralRaw = collateralRawDecimal.toFixed(0);
  const limitedByCapacity = availableBorrowRaw < halfHoldingRaw;
  const reason = limitedByCapacity
    ? `Kamino's available borrow is below 50% of the ${selected.symbol} holding, so the hedge is capped at live reserve capacity.`
    : `Hedge 50% of the ${selected.symbol} holding at the live max LTV.`;
  const suggestion: HedgeSuggestion = { ticker: selected.symbol, borrowRaw: borrowRaw.toString(), reason };
  const plan: HedgePlan = {
    ...suggestion,
    borrowUi: borrowUiDecimal.toNumber(),
    sizeUsd: sizeUsdDecimal.toNumber(),
    collateralRaw,
    collateralUsdc: new Decimal(collateralRaw).div(new Decimal(10).pow(usdc.decimals)).toNumber(),
    usdcDecimals: usdc.decimals,
    priceUsd,
    borrowFactor,
    safeLtvPct,
    availableBorrowRaw: availableBorrowRaw.toString(),
    xstockDecimals: selected.reserve.decimals,
  };
  return { holdings, suggestion, plan };
}

export function toPublicHedge(analysis: HedgeAnalysis): { holdings: HedgeHolding[]; suggestion: HedgeSuggestion } {
  return { holdings: analysis.holdings, suggestion: analysis.suggestion };
}

export { validOwner as isValidHedgeOwner };
