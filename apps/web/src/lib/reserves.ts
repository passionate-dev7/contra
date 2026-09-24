import Decimal from "decimal.js";
import { loadMarket, findUsdcReserve, ledgerInstant, resolveEquityFeed } from "@contra/short";
import type { PublicReserveRow } from "@/lib/types";

export interface ReserveRow {
  symbol: string;
  mint: string;
  decimals: number;
  isXstock: boolean;
  borrowable: boolean;
  reason: string;
  maxLtv: number;
  liqLtv: number;
  borrowFactor: number;
  borrowApy: number;
  availableRaw: string;
  borrowLimitRaw: string;
  totalBorrowedRaw: string;
  priceUsd: number | null;
  oracleValid: boolean;
  pairMaxLtv: number | null;
  pairLiqLtv: number | null;
  pairBorrowFactor: number | null;
}

/** Live read of every reserve in the xStocks market, hydrated with the pair
 * (USDC collateral, xStock debt) LTV/liquidation-LTV/borrow-factor the ticket
 * needs, and each reserve's borrow APY and oracle price. Nothing here is
 * hardcoded: borrowable is derived from the reserve's own borrowLimit/available
 * liquidity, exactly the "5 of 9 have borrowLimit 0" fact the brief names. */
export async function readReserveRows(): Promise<ReserveRow[]> {
  const market = await loadMarket();
  const instant = await ledgerInstant();
  const usdc = findUsdcReserve(market);

  const rows: ReserveRow[] = [];
  for (const reserve of market.getReserves()) {
    const cfg = reserve.state.config;
    const decimals = Number(reserve.state.liquidity.mintDecimals.toString());
    const symbol = reserve.getTokenSymbol();
    const isXstock = /x$/.test(symbol);

    const availableRaw = reserve.getLiquidityAvailableAmount().toFixed(0);
    const borrowLimitRaw = new Decimal(cfg.borrowLimit.toString()).toFixed(0);
    const totalBorrowedRaw = reserve.getBorrowedAmount().toFixed(0);
    const remainingCap = new Decimal(borrowLimitRaw).sub(totalBorrowedRaw);

    let borrowable = false;
    let reason = "not an xStock reserve";
    if (isXstock) {
      if (new Decimal(borrowLimitRaw).lte(0)) {
        reason = "borrow limit 0 on Kamino";
      } else if (remainingCap.lte(0)) {
        reason = "borrow cap reached on Kamino";
      } else if (new Decimal(availableRaw).lte(0)) {
        reason = "no available liquidity on Kamino";
      } else {
        borrowable = true;
        reason = "live";
      }
    } else if (symbol === "USDC") {
      reason = "collateral asset, not offered to short";
    }

    let oracleValid = false;
    let priceUsd: number | null = null;
    try {
      oracleValid = reserve.hasValidOraclePrice();
      if (oracleValid) {
        priceUsd = reserve.getOracleMarketPrice().toNumber();
      }
    } catch {
      oracleValid = false;
    }

    let pairMaxLtv: number | null = null;
    let pairLiqLtv: number | null = null;
    let pairBorrowFactor: number | null = null;
    if (isXstock) {
      const pair = market.getMaxAndLiquidationLtvAndBorrowFactorForPair(usdc.address, reserve.address);
      // getMaxAndLiquidationLtvAndBorrowFactorForPair returns LTVs as 0-1 fractions
      // (unlike cfg.loanToValuePct/liquidationThresholdPct, which are already 0-100)
      // and borrowFactor as a plain multiplier (1.66 = 1.66x), not a *Pct value.
      pairMaxLtv = pair.maxLtv * 100;
      pairLiqLtv = pair.liquidationLtv * 100;
      pairBorrowFactor = pair.borrowFactor;
    }

    rows.push({
      symbol,
      mint: reserve.getLiquidityMint().toString(),
      decimals,
      isXstock,
      borrowable,
      reason,
      maxLtv: cfg.loanToValuePct,
      liqLtv: cfg.liquidationThresholdPct,
      borrowFactor: cfg.borrowFactorPct,
      borrowApy: reserve.totalBorrowAPY(instant),
      availableRaw,
      borrowLimitRaw,
      totalBorrowedRaw,
      priceUsd,
      oracleValid,
      pairMaxLtv,
      pairLiqLtv,
      pairBorrowFactor,
    });
  }
  return rows;
}

/** The one shape both GET /api/reserves and the server-rendered home page emit,
 * so the API and the initial SSR data never drift apart. */
export function toPublicRow(r: ReserveRow): PublicReserveRow {
  return {
    symbol: r.symbol,
    borrowable: r.borrowable,
    reason: r.reason,
    maxLtv: r.pairMaxLtv ?? r.maxLtv,
    liqLtv: r.pairLiqLtv ?? r.liqLtv,
    borrowApy: r.borrowApy,
    availableRaw: r.availableRaw,
    decimals: r.decimals,
    mint: r.mint,
    priceUsd: r.priceUsd,
    oracleValid: r.oracleValid,
    pairBorrowFactor: r.pairBorrowFactor,
    isXstock: r.isXstock,
  };
}

export interface MarketOpenState {
  isOpen: boolean;
  nextOpenUnix: number | null;
  nextCloseUnix: number | null;
}

/** US equities open/close on one clock; SPY's Pyth feed hours stand for the
 * whole market. Free `/v2/price_feeds` endpoint, no PYTH_API_KEY needed. */
export async function readMarketOpenState(): Promise<MarketOpenState> {
  const feed = await resolveEquityFeed("SPY");
  return { isOpen: feed.isOpen, nextOpenUnix: feed.nextOpenUnix, nextCloseUnix: feed.nextCloseUnix };
}
