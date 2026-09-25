import { HERMES_URL, findXstockReserve, loadMarket, resolveEquityFeed } from "@contra/short";
import { readXstockLivePrice } from "./xstock-price";

const HERMES_TIMEOUT_MS = 10_000;
/** Past this publish age the equity session reads as closed when the feed's
 * own market status cannot be reached. Pyth equity feeds publish every few
 * seconds while the market is open, so a stale publish means closed. */
const STALE_SESSION_SECONDS = 900;

/** Pyth Pro trial plan: only these equity feeds are entitled. TSLAx maps to
 * the Equity.US.TSLA/USD feed, QQQx to Equity.US.QQQ/USD. Anything else
 * (SPYx, NVDAx) honestly reports no feed rather than a fabricated price. */
const ENTITLED_FEEDS: Record<string, { equity: string; feedId: string }> = {
  TSLAX: {
    equity: "TSLA",
    feedId: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
  },
  QQQX: {
    equity: "QQQ",
    feedId: "9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d",
  },
};

export { canonicalXstockSymbol } from "./pyth-shared";
export type { PythFair } from "./pyth-shared";
import { canonicalXstockSymbol, type PythFair } from "./pyth-shared";

function unavailable(ticker: string, reason: string): PythFair {
  return {
    ticker,
    pythPrice: null,
    confidence: null,
    publishTime: null,
    session: null,
    jupiterSellPrice: null,
    gapBps: null,
    reason,
  };
}

interface HermesPrice {
  price: string;
  conf?: string | null;
  expo: number;
  publish_time: number;
}

/** Fair value for one xStock: live Pyth price plus the Jupiter sell price per
 * displayed share and the gap between them in bps. Never fabricates: tickers
 * outside the entitled plan and a missing PYTH_API_KEY return nulls with the
 * reason stated. */
export async function readPythFair(ticker: string): Promise<PythFair> {
  const canonical = canonicalXstockSymbol(ticker);
  const entitled = ENTITLED_FEEDS[canonical.toUpperCase()];
  const apiKey = process.env["PYTH_API_KEY"]?.trim();
  if (apiKey === undefined || apiKey === "") {
    return unavailable(canonical, "PYTH_API_KEY not configured");
  }
  if (entitled === undefined) {
    return unavailable(canonical, "Pyth feed not in the current plan");
  }

  const res = await fetch(`${HERMES_URL}/v2/updates/price/latest?ids[]=${entitled.feedId}&parsed=true`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(HERMES_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Hermes price update failed: ${res.status} ${(await res.text()).slice(0, 160)}`);
  }
  const body = (await res.json()) as { parsed?: Array<{ price?: HermesPrice }> };
  const raw = body.parsed?.[0]?.price;
  if (raw === undefined) {
    throw new Error(`Hermes returned no parsed price for feed ${entitled.feedId}`);
  }
  const pythPrice = Number(raw.price) * 10 ** raw.expo;
  const confidence = raw.conf == null ? null : Number(raw.conf) * 10 ** raw.expo;
  const publishTime = Number(raw.publish_time);
  if (!Number.isFinite(pythPrice) || pythPrice <= 0 || !Number.isFinite(publishTime)) {
    throw new Error(`Hermes returned an unusable price for feed ${entitled.feedId}`);
  }

  let session: string;
  try {
    const feed = await resolveEquityFeed(entitled.equity);
    session = feed.isOpen ? "open" : "closed";
  } catch {
    session = Date.now() / 1000 - publishTime <= STALE_SESSION_SECONDS ? "open" : "closed";
  }

  const market = await loadMarket();
  const xstock = findXstockReserve(market, entitled.equity);
  const xDecimals = Number(xstock.state.liquidity.mintDecimals.toString());
  const mint = xstock.getLiquidityMint().toString();
  const { jupiterSellPrice } = await readXstockLivePrice(mint, xDecimals);
  const gapBps = (jupiterSellPrice / pythPrice - 1) * 10000;

  return {
    ticker: canonical,
    pythPrice,
    confidence,
    publishTime,
    session,
    jupiterSellPrice,
    gapBps,
    reason: null,
  };
}
