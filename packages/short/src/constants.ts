/** xStocks Market on Kamino, measured live 2026-09-24 (see docs/WIN-CONDITIONS.md). */
export const XSTOCKS_MARKET = "5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua";
export const KLEND_PROGRAM_ID = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export function reserveMetricsUrl(market: string): string {
  return `https://api.kamino.finance/kamino-market/${market}/reserves/metrics`;
}

export const JUP_QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
export const JUP_SWAP_INSTRUCTIONS_URL = "https://lite-api.jup.ag/swap/v1/swap-instructions";

export const HERMES_URL = "https://hermes.pyth.network";

/** Pyth "Equity.US.<TICKER>/USD" price feed ids, resolved once from Hermes
 * `/v2/price_feeds?query=Equity.US.<T>` and pinned here so a gating call does
 * not depend on the symbol search staying stable. Fill in as tickers are
 * verified; buildOpenShort throws a clear error for a ticker not listed here
 * rather than guessing an id. */
export const PYTH_EQUITY_FEED_IDS: Record<string, string> = {};
