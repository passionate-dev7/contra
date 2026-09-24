import { address, type Address } from "@solana/kit";
import {
  KaminoMarket,
  KaminoReserve,
  VanillaObligation,
  DEFAULT_RECENT_SLOT_DURATION_MS,
  getCurrentLedgerInstant,
  type LedgerInstant,
} from "@kamino-finance/klend-sdk";
import { kitRpc } from "./rpc.js";
import { XSTOCKS_MARKET, USDC_MINT } from "./constants.js";

export async function loadMarket(marketAddress = XSTOCKS_MARKET): Promise<KaminoMarket> {
  const rpc = kitRpc();
  const market = await KaminoMarket.load(rpc, address(marketAddress), DEFAULT_RECENT_SLOT_DURATION_MS);
  if (market === null) {
    throw new Error(`Kamino market ${marketAddress} not found`);
  }
  return market;
}

export function findUsdcReserve(market: KaminoMarket): KaminoReserve {
  const reserve = market.getReserves().find((r) => r.getLiquidityMint().toString() === USDC_MINT);
  if (reserve === undefined) {
    throw new Error(`USDC reserve not found in market ${market.getAddress().toString()}`);
  }
  return reserve;
}

/** ticker is the plain equity ticker, e.g. "TSLA" — the reserve symbol is "TSLAx". */
export function findXstockReserve(market: KaminoMarket, ticker: string): KaminoReserve {
  const symbol = `${ticker.toUpperCase()}x`;
  const reserve = market.getReserves().find((r) => r.getTokenSymbol() === symbol);
  if (reserve === undefined) {
    throw new Error(`No reserve with symbol ${symbol} in market ${market.getAddress().toString()}`);
  }
  return reserve;
}

export function vanillaObligationType(market: KaminoMarket): VanillaObligation {
  return new VanillaObligation(market.programId);
}

export async function vanillaObligationAddress(market: KaminoMarket, owner: Address): Promise<Address> {
  return vanillaObligationType(market).toPda(market.getAddress(), owner);
}

export async function ledgerInstant(): Promise<LedgerInstant> {
  return getCurrentLedgerInstant(kitRpc());
}
