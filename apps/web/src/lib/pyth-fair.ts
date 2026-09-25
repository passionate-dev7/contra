import { PublicKey } from "@solana/web3.js";
import { operativeMultiplier } from "@fineprint/core";
import {
  HERMES_URL,
  USDC_MINT,
  findUsdcReserve,
  findXstockReserve,
  getQuote,
  loadMarket,
  resolveEquityFeed,
  web3Connection,
} from "@contra/short";

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

interface ScaledUiAmountState {
  multiplier?: unknown;
  newMultiplier?: unknown;
  newMultiplierEffectiveTimestamp?: unknown;
}

/** Operative scaled-UI multiplier for a Token-2022 mint: 1 when the mint has
 * no scaledUiAmountConfig extension. A read failure throws rather than
 * silently pricing at 1x, which would misprice a scaled mint. */
async function readOperativeMultiplier(mint: string): Promise<number> {
  const conn = web3Connection();
  const parsed = await conn.getParsedAccountInfo(new PublicKey(mint), "confirmed");
  const data = parsed.value?.data;
  if (data === undefined || data === null || Buffer.isBuffer(data)) {
    throw new Error(`mint account data is not parsed: ${mint}`);
  }
  const info = (data.parsed as { info?: { extensions?: unknown } }).info;
  const extensions = Array.isArray(info?.extensions)
    ? (info.extensions as Array<{ extension?: unknown; state?: unknown }>)
    : [];
  const entry = extensions.find((e) => e.extension === "scaledUiAmountConfig");
  if (entry === undefined) return 1;
  const state = (entry.state ?? {}) as ScaledUiAmountState;
  if (
    typeof state.multiplier !== "string" ||
    typeof state.newMultiplier !== "string" ||
    typeof state.newMultiplierEffectiveTimestamp !== "number"
  ) {
    throw new Error(`scaledUiAmountConfig on ${mint} is missing multiplier fields`);
  }
  return operativeMultiplier(
    state.multiplier,
    state.newMultiplier,
    state.newMultiplierEffectiveTimestamp,
    Math.floor(Date.now() / 1000),
  );
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
  const usdc = findUsdcReserve(market);
  const xDecimals = Number(xstock.state.liquidity.mintDecimals.toString());
  const usdcDecimals = Number(usdc.state.liquidity.mintDecimals.toString());
  const mint = xstock.getLiquidityMint().toString();
  const multiplier = await readOperativeMultiplier(mint);
  const rawAmount = BigInt(Math.max(1, Math.round(10 ** xDecimals / multiplier)));
  const displayedShares = Number(rawAmount) / 10 ** xDecimals * multiplier;
  const quote = await getQuote({
    inputMint: mint,
    outputMint: USDC_MINT,
    amount: rawAmount,
    slippageBps: 100,
  });
  const usdcOut = Number(quote.outAmount) / 10 ** usdcDecimals;
  if (!Number.isFinite(usdcOut) || usdcOut <= 0) {
    throw new Error(`Jupiter quote returned no output amount for ${canonical}`);
  }
  const jupiterSellPrice = usdcOut / displayedShares;
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
