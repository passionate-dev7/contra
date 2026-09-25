// Pure helpers and types shared by the server Pyth reader and client components.

export function canonicalXstockSymbol(ticker: string): string {
  const upper = ticker.trim().toUpperCase();
  const base = upper.endsWith("X") ? upper.slice(0, -1) : upper;
  return `${base}x`;
}

export interface PythFair {
  ticker: string;
  pythPrice: number | null;
  confidence: number | null;
  /** Unix seconds of the Hermes publish, null when no feed. */
  publishTime: number | null;
  /** "open" | "closed", null when no feed. */
  session: string | null;
  /** USDC received per 1 displayed xStock share on a small Jupiter sell. */
  jupiterSellPrice: number | null;
  /** (jupiterSellPrice / pythPrice - 1) * 10000, null when no feed. */
  gapBps: number | null;
  /** Null when live; otherwise the honest reason there is no price. */
  reason: string | null;
}
