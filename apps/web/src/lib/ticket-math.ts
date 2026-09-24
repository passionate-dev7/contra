/** Pure pre-trade math for the order ticket. Every input is a live number
 * read from the reserve (pair LTV/liquidation-LTV/borrow-factor, oracle price)
 * or typed by the trader (size, collateral); nothing here is fabricated. */
export interface TicketInputs {
  sizeUsd: number;
  collateralUsdc: number;
  priceUsd: number;
  pairMaxLtv: number; // percent, 0-100
  pairLiqLtv: number; // percent, 0-100
  pairBorrowFactor: number; // multiplier, e.g. 1.66 = 1.66x
}

export interface TicketMath {
  xstockAmount: number;
  initialLtvPct: number;
  liquidationPriceUsd: number;
  overMaxLtv: boolean;
}

export function computeTicketMath(i: TicketInputs): TicketMath {
  const xstockAmount = i.priceUsd > 0 ? i.sizeUsd / i.priceUsd : 0;
  const borrowFactor = i.pairBorrowFactor;
  // Kamino weights borrow value by borrowFactor before comparing to collateral:
  // liquidation (and the max-LTV gate) trip on (borrowValue * borrowFactor) / collateralValue,
  // not on the raw notional/collateral ratio. Both the displayed LTV and the max-LTV
  // check must use this weighted figure or they disagree with the liquidation price below.
  const weightedBorrowValueUsd = i.sizeUsd * borrowFactor;
  const initialLtvPct = i.collateralUsdc > 0 ? (weightedBorrowValueUsd / i.collateralUsdc) * 100 : 0;
  // Price at which that same weighted ratio reaches the liquidation LTV:
  const liquidationPriceUsd =
    xstockAmount > 0 && borrowFactor > 0 ? (i.collateralUsdc * (i.pairLiqLtv / 100)) / (xstockAmount * borrowFactor) : 0;
  return {
    xstockAmount,
    initialLtvPct,
    liquidationPriceUsd,
    overMaxLtv: initialLtvPct > i.pairMaxLtv,
  };
}
