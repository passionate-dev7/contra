import { address } from "@solana/kit";
import { loadMarket, findUsdcReserve } from "@contra/short";

export interface PositionLine {
  symbol: string;
  amount: number;
  marketValueUsd: number;
  decimals: number;
  reserveAddress: string;
}

export interface ObligationView {
  obligationAddress: string;
  deposits: PositionLine[];
  borrows: PositionLine[];
  totalDepositUsd: number;
  totalBorrowUsd: number;
  loanToValuePct: number;
  liquidationLtvPct: number;
  liquidationPriceUsd: number | null;
  liquidationTicker: string | null;
  healthy: boolean;
}

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

  const toLine = (reserveAddr: string, pos: { amount: { toNumber(): number }; marketValueRefreshed: { toNumber(): number } }): PositionLine => {
    const reserve = market.getReserveByAddress(address(reserveAddr));
    return {
      symbol: reserve?.getTokenSymbol() ?? reserveAddr,
      amount: pos.amount.toNumber(),
      marketValueUsd: pos.marketValueRefreshed.toNumber(),
      decimals: reserve !== undefined ? Number(reserve.state.liquidity.mintDecimals.toString()) : 6,
      reserveAddress: reserveAddr,
    };
  };

  const deposits = Array.from(kaminoObligation.deposits.entries()).map(([addr, pos]) => toLine(addr.toString(), pos));
  const borrows = Array.from(kaminoObligation.borrows.entries()).map(([addr, pos]) => toLine(addr.toString(), pos));

  const stats = kaminoObligation.refreshedStats;
  const xstockBorrow = borrows.find((b) => /x$/.test(b.symbol));
  let liquidationPriceUsd: number | null = null;
  if (xstockBorrow !== undefined && xstockBorrow.amount > 0) {
    const usdcReserve = findUsdcReserve(market);
    const xstockReserve = market.getReserveByAddress(address(xstockBorrow.reserveAddress));
    // Liquidation trips when borrow value * borrowFactor reaches the collateral's
    // liquidation limit (borrowLiquidationLimit is already that USD threshold).
    const borrowFactor =
      xstockReserve !== undefined ? market.getMaxAndLiquidationLtvAndBorrowFactorForPair(usdcReserve.address, xstockReserve.address).borrowFactor : 1;
    liquidationPriceUsd = stats.borrowLiquidationLimit.toNumber() / (xstockBorrow.amount * borrowFactor);
  }

  return {
    obligationAddress: kaminoObligation.obligationAddress.toString(),
    deposits,
    borrows,
    totalDepositUsd: stats.userTotalDeposit.toNumber(),
    totalBorrowUsd: stats.userTotalBorrow.toNumber(),
    loanToValuePct: stats.loanToValue.toNumber(),
    liquidationLtvPct: stats.liquidationLtv.toNumber(),
    liquidationPriceUsd,
    liquidationTicker: xstockBorrow?.symbol ?? null,
    healthy: stats.loanToValue.lt(stats.liquidationLtv),
  };
}
