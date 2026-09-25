/** Shape returned by GET /api/reserves. One row per reserve in the xStocks market. */
export interface PublicReserveRow {
  symbol: string;
  borrowable: boolean;
  reason: string;
  maxLtv: number;
  liqLtv: number;
  /** Per-reserve borrow factor as a ratio (e.g. 1.66), from live Kamino config. */
  borrowFactor: number | null;
  borrowApy: number;
  availableRaw: string;
  decimals: number;
  mint: string;
  priceUsd: number | null;
  oracleValid: boolean;
  pairBorrowFactor: number | null;
  isXstock: boolean;
}
