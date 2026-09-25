import { address } from "@solana/kit";
import { Fraction } from "@kamino-finance/klend-sdk";
import { loadMarket, findUsdcReserve } from "@contra/short";
import { readXstockLivePrice } from "./xstock-price";

export interface PositionLine {
  symbol: string;
  amount: number;
  marketValueUsd: number;
  decimals: number;
  reserveAddress: string;
}

/** One open short inside the obligation: entry context (last on-chain borrow
 * activity, since Contra has no indexer and can't know the original open
 * price without one) plus a live mark-to-market. `kaminoValueUsd` is
 * Kamino's own Scope-oracle mark (what the protocol uses for LTV and
 * liquidation); `jupiterValueUsd` is what the market would actually pay to
 * buy the position back right now, priced through a live Jupiter quote with
 * the mint's scaled-UI multiplier applied. The two can differ when Scope's
 * price lags the live market. */
export interface ShortPosition {
  symbol: string;
  reserveAddress: string;
  mint: string;
  decimals: number;
  /** Raw-mint-unit amount owed, before the Token-2022 scaled-UI multiplier. */
  rawUnitAmount: number;
  /** Scaled-UI multiplier applied to the mint right now (1 when the mint has none). */
  multiplier: number;
  /** rawUnitAmount * multiplier: the actual number of shares a wallet would show. */
  displayedAmount: number;
  kaminoValueUsd: number;
  jupiterPricePerShare: number | null;
  jupiterValueUsd: number | null;
  jupiterError: string | null;
  pairBorrowFactor: number | null;
  liquidationPriceUsd: number | null;
  /** UI-unit interest accrued since lastBorrowActivityUnix, from the
   * position's own on-chain cumulativeBorrowRateBsf snapshot vs the reserve's
   * current rate. Not interest since the short was first opened: Contra
   * tracks no history of prior borrow/repay actions on this position. */
  accruedInterest: number;
  lastBorrowActivityUnix: number;
  pythEntitled: boolean;
}

export interface ObligationView {
  obligationAddress: string;
  deposits: PositionLine[];
  borrows: PositionLine[];
  shorts: ShortPosition[];
  totalDepositUsd: number;
  totalBorrowUsd: number;
  loanToValuePct: number;
  liquidationLtvPct: number;
  liquidationPriceUsd: number | null;
  liquidationTicker: string | null;
  healthy: boolean;
}

const PYTH_ENTITLED = new Set(["TSLAX", "QQQX"]);

/** Live read of one owner's obligation on the xStocks market: KaminoObligation
 * hydrated at the current slot, not a cached indexer snapshot. Returns null
 * when the owner has no obligation here yet (a genuinely empty state, not an
 * error). */
export async function readObligation(owner: string): Promise<ObligationView | null> {
  const market = await loadMarket();
  let kaminoObligation;
  try {
    kaminoObligation = await market.getUserVanillaObligation(address(owner));
  } catch {
    return null;
  }
  if (kaminoObligation === null || kaminoObligation === undefined) {
    return null;
  }
  if (kaminoObligation.deposits.size === 0 && kaminoObligation.borrows.size === 0) {
    return null;
  }

  // Position.amount is the raw-mint-unit amount as a Decimal (Kamino's SDK
  // doc calls this "lamports"), not divided by the mint's decimals. Every
  // consumer here needs the UI-decimal amount, so toLine converts once.
  const toLine = (reserveAddr: string, pos: { amount: { toNumber(): number }; marketValueRefreshed: { toNumber(): number } }): PositionLine => {
    const reserve = market.getReserveByAddress(address(reserveAddr));
    const decimals = reserve !== undefined ? Number(reserve.state.liquidity.mintDecimals.toString()) : 6;
    return {
      symbol: reserve?.getTokenSymbol() ?? reserveAddr,
      amount: pos.amount.toNumber() / 10 ** decimals,
      marketValueUsd: pos.marketValueRefreshed.toNumber(),
      decimals,
      reserveAddress: reserveAddr,
    };
  };

  const deposits = Array.from(kaminoObligation.deposits.entries()).map(([addr, pos]) => toLine(addr.toString(), pos));
  const borrows = Array.from(kaminoObligation.borrows.entries()).map(([addr, pos]) => toLine(addr.toString(), pos));

  const stats = kaminoObligation.refreshedStats;
  const usdcReserve = findUsdcReserve(market);

  const xstockBorrowEntries = Array.from(kaminoObligation.borrows.entries()).filter(([addr]) => {
    const reserve = market.getReserveByAddress(addr);
    return reserve !== undefined && /x$/.test(reserve.getTokenSymbol());
  });

  const shorts: ShortPosition[] = await Promise.all(
    xstockBorrowEntries.map(async ([addr, pos]) => {
      const reserve = market.getReserveByAddress(addr);
      const symbol = reserve?.getTokenSymbol() ?? addr.toString();
      const decimals = reserve !== undefined ? Number(reserve.state.liquidity.mintDecimals.toString()) : 6;
      const mint = reserve?.getLiquidityMint().toString() ?? "";
      const rawUnitAmount = pos.amount.toNumber() / 10 ** decimals;

      const pairBorrowFactor =
        reserve !== undefined ? market.getMaxAndLiquidationLtvAndBorrowFactorForPair(usdcReserve.address, reserve.address).borrowFactor : null;
      const liquidationPriceUsd =
        pairBorrowFactor !== null && rawUnitAmount > 0
          ? stats.borrowLiquidationLimit.toNumber() / (rawUnitAmount * pairBorrowFactor)
          : null;

      // Interest accrued since this position's last borrow/repay: the raw
      // account's own cumulativeBorrowRateBsf snapshot at that action vs the
      // amount refreshed to the reserve's current rate (pos.amount).
      const rawEntry = kaminoObligation.state.borrows.find((b) => b.borrowReserve.toString() === addr.toString());
      let accruedInterest = 0;
      let lastBorrowActivityUnix = 0;
      if (rawEntry !== undefined) {
        const principalRaw = new Fraction(rawEntry.borrowedAmountSf).toDecimal();
        accruedInterest = Math.max(0, pos.amount.toNumber() - principalRaw.toNumber()) / 10 ** decimals;
        lastBorrowActivityUnix = Number(rawEntry.lastBorrowedAtTimestamp.toString());
      }

      let multiplier = 1;
      let jupiterPricePerShare: number | null = null;
      let jupiterError: string | null = null;
      if (mint !== "") {
        try {
          const live = await readXstockLivePrice(mint, decimals);
          multiplier = live.multiplier;
          jupiterPricePerShare = live.jupiterSellPrice;
        } catch (err) {
          jupiterError = err instanceof Error ? err.message : String(err);
        }
      }
      const displayedAmount = rawUnitAmount * multiplier;
      const jupiterValueUsd = jupiterPricePerShare !== null ? displayedAmount * jupiterPricePerShare : null;

      return {
        symbol,
        reserveAddress: addr.toString(),
        mint,
        decimals,
        rawUnitAmount,
        multiplier,
        displayedAmount,
        kaminoValueUsd: pos.marketValueRefreshed.toNumber(),
        jupiterPricePerShare,
        jupiterValueUsd,
        jupiterError,
        pairBorrowFactor,
        liquidationPriceUsd,
        accruedInterest,
        lastBorrowActivityUnix,
        pythEntitled: PYTH_ENTITLED.has(symbol.toUpperCase()),
      };
    }),
  );

  const primaryShort = shorts[0];

  return {
    obligationAddress: kaminoObligation.obligationAddress.toString(),
    deposits,
    borrows,
    shorts,
    totalDepositUsd: stats.userTotalDeposit.toNumber(),
    totalBorrowUsd: stats.userTotalBorrow.toNumber(),
    loanToValuePct: stats.loanToValue.toNumber(),
    liquidationLtvPct: stats.liquidationLtv.toNumber(),
    liquidationPriceUsd: primaryShort?.liquidationPriceUsd ?? null,
    liquidationTicker: primaryShort?.symbol ?? null,
    healthy: stats.loanToValue.lt(stats.liquidationLtv),
  };
}
