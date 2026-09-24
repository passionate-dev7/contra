import { JupiterApiError } from "./errors.js";

export const QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
export const SWAP_URL = "https://lite-api.jup.ag/swap/v1/swap";
export const USDC_MINT =
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const REQUEST_TIMEOUT_MS = 15_000;

export interface JupSwapInfo {
  label: string;
  [k: string]: unknown;
}

export interface JupRoutePlanEntry {
  swapInfo: JupSwapInfo;
  [k: string]: unknown;
}

export interface JupQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: JupRoutePlanEntry[];
  contextSlot?: number;
  [k: string]: unknown;
}

export interface GetQuoteParams {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  slippageBps: number;
  signal?: AbortSignal;
}

export interface GetSwapTransactionParams {
  quote: JupQuote;
  userPublicKey: string;
  signal?: AbortSignal;
}

export interface SwapTransactionResponse {
  swapTransaction: string;
  lastValidBlockHeight: number;
  [k: string]: unknown;
}

function withTimeout(signal: AbortSignal | undefined): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  if (signal === undefined) {
    return {
      signal: controller.signal,
      cleanup: () => {
        clearTimeout(timer);
      },
    };
  }
  if (signal.aborted) {
    controller.abort();
    return {
      signal: controller.signal,
      cleanup: () => {
        clearTimeout(timer);
      },
    };
  }
  const onAbort = (): void => {
    controller.abort();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonOrThrow(
  status: number,
  res: Response,
): Promise<Record<string, unknown>> {
  const bodyText = await res.text();
  if (!res.ok) {
    throw new JupiterApiError(status, bodyText);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText) as unknown;
  } catch {
    throw new JupiterApiError(status, bodyText);
  }
  if (!isRecord(parsed)) {
    throw new JupiterApiError(status, bodyText);
  }
  if ("error" in parsed && Boolean(parsed["error"])) {
    throw new JupiterApiError(status, bodyText);
  }
  return parsed;
}

export async function getQuote(p: GetQuoteParams): Promise<JupQuote> {
  const params = new URLSearchParams({
    inputMint: p.inputMint,
    outputMint: p.outputMint,
    amount: p.amount.toString(),
    slippageBps: String(p.slippageBps),
    swapMode: "ExactIn",
  });
  const scoped = withTimeout(p.signal);
  try {
    const res = await fetch(`${QUOTE_URL}?${params.toString()}`, {
      signal: scoped.signal,
    });
    const body = await readJsonOrThrow(res.status, res);
    return body as JupQuote;
  } finally {
    scoped.cleanup();
  }
}

export async function getSwapTransaction(
  p: GetSwapTransactionParams,
): Promise<SwapTransactionResponse> {
  const scoped = withTimeout(p.signal);
  try {
    const res = await fetch(SWAP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: p.quote,
        userPublicKey: p.userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
      }),
      signal: scoped.signal,
    });
    const body = await readJsonOrThrow(res.status, res);
    if (
      typeof body["swapTransaction"] !== "string" ||
      typeof body["lastValidBlockHeight"] !== "number"
    ) {
      throw new JupiterApiError(
        res.status,
        `Swap response missing swapTransaction/lastValidBlockHeight: ${JSON.stringify(body).slice(0, 200)}`,
      );
    }
    return body as SwapTransactionResponse;
  } finally {
    scoped.cleanup();
  }
}

export function routeLabel(quote: JupQuote): string {
  return quote.routePlan.map((entry) => entry.swapInfo.label).join(" -> ");
}
