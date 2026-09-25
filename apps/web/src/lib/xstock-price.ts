import { PublicKey } from "@solana/web3.js";
import { operativeMultiplier } from "@fineprint/core";
import { USDC_MINT, getQuote, web3Connection } from "@contra/short";

/** USDC's mint is fixed at 6 decimals; used to turn a Jupiter sell quote's
 * raw outAmount into a UI dollar figure. */
const USDC_DECIMALS = 6;

interface ScaledUiAmountState {
  multiplier?: unknown;
  newMultiplier?: unknown;
  newMultiplierEffectiveTimestamp?: unknown;
}

/** Operative scaled-UI multiplier for a Token-2022 mint: 1 when the mint has
 * no scaledUiAmountConfig extension. A read failure throws rather than
 * silently pricing at 1x, which would misprice a scaled mint. Shared by the
 * Pyth fair-value line and the positions page so both price a share the
 * same way. */
export async function readOperativeMultiplier(mint: string): Promise<number> {
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

export interface XstockLivePrice {
  multiplier: number;
  /** USDC received per 1 displayed xStock share on a small Jupiter sell. */
  jupiterSellPrice: number;
}

/** Live per-share sell price for one xStock mint: reads the scaled-UI
 * multiplier once, then quotes selling exactly 1 displayed share through
 * Jupiter. A small fixed size, not the full position, so the quoted price
 * reflects the market rather than this position's own price impact. */
export async function readXstockLivePrice(mint: string, decimals: number): Promise<XstockLivePrice> {
  const multiplier = await readOperativeMultiplier(mint);
  const rawAmount = BigInt(Math.max(1, Math.round(10 ** decimals / multiplier)));
  const displayedShares = (Number(rawAmount) / 10 ** decimals) * multiplier;
  const quote = await getQuote({ inputMint: mint, outputMint: USDC_MINT, amount: rawAmount, slippageBps: 100 });
  const usdcOut = Number(quote.outAmount) / 10 ** USDC_DECIMALS;
  if (!Number.isFinite(usdcOut) || usdcOut <= 0) {
    throw new Error(`Jupiter quote returned no output amount for mint ${mint}`);
  }
  return { multiplier, jupiterSellPrice: usdcOut / displayedShares };
}
