import { PRESTOCKS_API_URL } from "./constants.js";

export interface PreStocksToken {
  symbol: string;
  name: string;
  mint: string;
  /** Informational. The issuer serves null for these at times, so they are nullable. */
  markPrice: number | null;
  tokenPrice: number | null;
  /** Load-bearing: the number the on-chain decode is cross-checked against. Never null. */
  supply: number;
}

export interface FetchOptions {
  /** Ignore the in-process cache and hit the API. */
  force?: boolean;
  /** How long a successful response stays reusable, ms. Default 60_000. */
  ttlMs?: number;
  /** Attempts on 429 / 5xx before giving up. Default 7, exponential backoff capped at 30s. */
  retries?: number;
}

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_RETRIES = 7;
const BASE_BACKOFF_MS = 1_000;

let cache: { at: number; tokens: PreStocksToken[] } | null = null;
let inFlight: Promise<PreStocksToken[]> | null = null;

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`PreStocks API: expected a non-empty string for ${field}`);
  }
  return value;
}

function asNumber(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) {
    throw new Error(`PreStocks API: expected a finite number for ${field}, got ${JSON.stringify(value)}`);
  }
  return parsed;
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function toToken(row: unknown): PreStocksToken {
  if (typeof row !== "object" || row === null) {
    throw new Error("PreStocks API: expected an array of objects");
  }
  const record = row as Record<string, unknown>;
  return {
    symbol: asString(record["symbol"], "symbol"),
    name: asString(record["name"], "name"),
    mint: asString(record["contract_address"], "contract_address"),
    markPrice: asNullableNumber(record["markPrice"]),
    tokenPrice: asNullableNumber(record["tokenPrice"]),
    supply: asNumber(record["supply"], "supply"),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(res: Response, attempt: number): number {
  const header = res.headers.get("retry-after");
  if (header !== null) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  }
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, 30_000);
}

async function load(retries: number): Promise<PreStocksToken[]> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: Response;
    try {
      res = await fetch(PRESTOCKS_API_URL, { headers: { accept: "application/json" } });
    } catch (cause) {
      lastError = new Error(`PreStocks API request failed: ${String(cause)}`);
      await sleep(BASE_BACKOFF_MS * 2 ** attempt);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      lastError = new Error(`PreStocks API returned HTTP ${res.status}`);
      if (attempt < retries) {
        await sleep(retryAfterMs(res, attempt));
        continue;
      }
      throw lastError;
    }
    if (res.status !== 200) {
      throw new Error(`PreStocks API returned HTTP ${res.status}`);
    }
    const payload: unknown = await res.json();
    if (!Array.isArray(payload)) {
      throw new Error("PreStocks API returned an unexpected payload");
    }
    if (payload.length === 0) {
      throw new Error("PreStocks API returned an empty token list");
    }
    // The issuer intermittently serves rows with `supply: null`. That is an incomplete
    // response, not a valid state, and supply is the value the on-chain decode is checked
    // against. Treat it as retryable rather than letting a null poison the comparison.
    let tokens: PreStocksToken[];
    try {
      tokens = payload.map(toToken);
    } catch (cause) {
      lastError = cause instanceof Error ? cause : new Error(String(cause));
      if (attempt < retries) {
        await sleep(BASE_BACKOFF_MS * 2 ** attempt);
        continue;
      }
      throw lastError;
    }
    tokens.sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
    return tokens;
  }
  throw lastError ?? new Error("PreStocks API: exhausted retries");
}

/**
 * The live token list. The mint addresses come from here and are never hardcoded,
 * so a new listing or a re-mint is picked up without a code change.
 *
 * The issuer rate-limits aggressively, so successful responses are reused for
 * `ttlMs` within the process and concurrent callers share one request.
 */
export async function fetchPreStocksTokens(options: FetchOptions = {}): Promise<PreStocksToken[]> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;

  if (!options.force && cache !== null && Date.now() - cache.at < ttlMs) {
    return cache.tokens;
  }
  if (!options.force && inFlight !== null) {
    return inFlight;
  }

  const request = load(retries)
    .then((tokens) => {
      cache = { at: Date.now(), tokens };
      return tokens;
    })
    .finally(() => {
      if (inFlight === request) inFlight = null;
    });

  inFlight = request;
  return request;
}

/** Drops the in-process cache. Exposed so a test can prove the fetch path really runs. */
export function clearPreStocksCache(): void {
  cache = null;
  inFlight = null;
}
