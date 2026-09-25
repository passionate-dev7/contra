import { HERMES_URL } from "./constants.js";

const PYTH_FEED_TIMEOUT_MS = 10_000;

export class PythApiKeyMissingError extends Error {
  constructor() {
    super(
      "PYTH_API_KEY is not set. Hermes (hermes.pyth.network) has required an API key for every " +
        "request since 2026-08-26; the user places it in .env as PYTH_API_KEY. Refusing to build " +
        "an open without a live, fresh price check rather than skip the gate.",
    );
    this.name = "PythApiKeyMissingError";
  }
}

export class MarketClosedError extends Error {
  constructor(ticker: string, nextOpenUnix: number | null, detail?: string) {
    super(
      `Equity.US.${ticker}/USD market is closed` +
        (nextOpenUnix !== null ? `; next open ${new Date(nextOpenUnix * 1000).toISOString()}` : "") +
        (detail !== undefined ? `: ${detail}` : ""),
    );
    this.name = "MarketClosedError";
  }
}

export class StalePriceError extends Error {
  constructor(ticker: string, ageSeconds: number, maxAgeSeconds: number) {
    super(`Equity.US.${ticker}/USD price is ${ageSeconds}s old, exceeds the ${maxAgeSeconds}s freshness bound`);
    this.name = "StalePriceError";
  }
}

export interface PriceFeedMeta {
  id: string;
  isOpen: boolean;
  nextOpenUnix: number | null;
  nextCloseUnix: number | null;
}

interface PriceFeedSearchResult {
  id: string;
  market_hours?: { is_open: boolean; next_open?: number; next_close?: number };
  attributes: { symbol: string; [k: string]: unknown };
}

/**
 * Resolve the Equity.US.<TICKER>/USD feed id and market-hours state. This
 * endpoint (`/v2/price_feeds`) is free, no API key required — Pyth exposes
 * feed metadata openly and gates only the price-update endpoints.
 */
export async function resolveEquityFeed(ticker: string): Promise<PriceFeedMeta> {
  const symbol = `Equity.US.${ticker.toUpperCase()}`;
  const res = await fetch(`${HERMES_URL}/v2/price_feeds?query=${encodeURIComponent(symbol)}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(PYTH_FEED_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Hermes price_feeds lookup failed: ${res.status} ${await res.text()}`);
  }
  const results = (await res.json()) as PriceFeedSearchResult[];
  const match = results.find((r) => r.attributes.symbol === `${symbol}/USD`);
  if (match === undefined) {
    throw new Error(`No Pyth feed found for ${symbol}/USD`);
  }
  return {
    id: match.id,
    isOpen: match.market_hours?.is_open ?? false,
    nextOpenUnix: match.market_hours?.next_open ?? null,
    nextCloseUnix: match.market_hours?.next_close ?? null,
  };
}

export interface FreshPrice {
  ticker: string;
  feedId: string;
  priceUsd: number;
  publishTimeUnix: number;
  ageSeconds: number;
}

/**
 * Gate a short open/close on the Equity.US.<TICKER>/USD Pyth feed: the market
 * must be open AND the latest price must be fresher than maxAgeSeconds.
 * Throws PythApiKeyMissingError, MarketClosedError or StalePriceError rather
 * than returning a fabricated price when any check fails.
 */
export async function requireFreshEquityPrice(ticker: string, maxAgeSeconds = 60): Promise<FreshPrice> {
  const apiKey = process.env["PYTH_API_KEY"];
  const feed = await resolveEquityFeed(ticker);
  if (!feed.isOpen) {
    throw new MarketClosedError(ticker, feed.nextOpenUnix);
  }
  if (apiKey === undefined || apiKey.trim() === "") {
    throw new PythApiKeyMissingError();
  }

  const res = await fetch(`${HERMES_URL}/v2/updates/price/latest?ids[]=${feed.id}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Hermes price update failed: ${res.status} ${text}`);
  }
  const body = JSON.parse(text) as {
    parsed: Array<{ price: { price: string; expo: number; publish_time: number } }>;
  };
  const parsed = body.parsed[0];
  if (parsed === undefined) {
    throw new Error(`Hermes returned no parsed price for feed ${feed.id}`);
  }
  const priceUsd = Number(parsed.price.price) * 10 ** parsed.price.expo;
  const nowUnix = Math.floor(Date.now() / 1000);
  const ageSeconds = nowUnix - parsed.price.publish_time;
  if (ageSeconds > maxAgeSeconds) {
    throw new StalePriceError(ticker, ageSeconds, maxAgeSeconds);
  }
  return { ticker, feedId: feed.id, priceUsd, publishTimeUnix: parsed.price.publish_time, ageSeconds };
}
