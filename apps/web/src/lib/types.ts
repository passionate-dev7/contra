/** Shape returned by GET /api/reserves. One row per reserve in the xStocks market. */
export interface PublicReserveRow {
  symbol: string;
  borrowable: boolean;
  reason: string;
  maxLtv: number;
  liqLtv: number;
  borrowApy: number;
  availableRaw: string;
  decimals: number;
  mint: string;
  priceUsd: number | null;
  oracleValid: boolean;
  pairBorrowFactor: number | null;
  isXstock: boolean;
}
