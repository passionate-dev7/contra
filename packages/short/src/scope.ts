import type { TransactionInstruction } from "@solana/web3.js";
import type { KaminoMarket } from "@kamino-finance/klend-sdk";
import { Scope } from "@kamino-finance/scope-sdk";
import { address, type Address } from "@solana/kit";
import { kitRpc } from "./rpc.js";
import { kitIxToWeb3 } from "./kit.js";
import { MarketClosedError } from "./pyth.js";

/**
 * Kamino prices every xStocks-market reserve through a Scope chain, e.g. SPYx:
 *   344 CappedFloored(src 343, cap/floor 278)
 *     343 MostRecentOf(278 ChainlinkX, 342 PythLazer, sourcesMaxAge 60s)
 *   279 ScopeTwap(src 278)
 * Only the derived entries (CappedFloored / MostRecentOf / ScopeTwap) can be
 * recomputed permissionlessly by `refresh_price_list`. The leaves (ChainlinkX,
 * PythLazer) move only when someone posts a signed Chainlink Data Streams /
 * Pyth Lazer report, which needs the providers' credentials (Kamino's crank).
 * So prepending refresh_price_list fixes a lagging crank on the derived
 * entries, and cannot help when the upstream leaves themselves are old.
 *
 * Scope's own gates (Kamino-Finance/scope, programs/scope/src/):
 * - handler_refresh_prices.rs check_execution_ctx: every instruction before
 *   refresh_price_list must be a ComputeBudget instruction, so it goes at
 *   index 1, right after the CU-limit ix.
 * - oracles/chainlink.rs: the xStock ChainlinkX mappings carry generic data 0
 *   = MarketStatusBehavior::AllUpdates, so Scope accepts ChainlinkX reports in
 *   any market status. Closed-market staleness therefore shows up only as the
 *   leaves' timestamps ageing, which is what preflight measures.
 */
const DERIVED = new Set([33, 28, 39, 12]); // CappedFloored, MostRecentOf, CappedMostRecentOf, ScopeTwap
const FIXED_PRICE = 23;
const U16_MAX = 65535;

export interface ScopeRefresh {
  instruction: TransactionInstruction | null;
  tokens: number[];
  /** per reserve symbol: seconds since the freshest upstream leaf published */
  upstreamAgeSeconds: Record<string, number>;
}

/**
 * Build the single refresh_price_list instruction covering every derived Scope
 * entry that `reserves` price through, and refuse (MarketClosedError) when a
 * reserve's upstream leaves are older than that reserve's maxAgePriceSeconds,
 * since no in-transaction refresh can then produce a price klend accepts.
 */
export async function buildScopeRefresh(market: KaminoMarket, reserves: Address[]): Promise<ScopeRefresh> {
  const rs = [...new Set(reserves.map(String))].map((a) => {
    const r = market.getReserveByAddress(address(a));
    if (r === undefined) throw new Error(`reserve ${a} not in market`);
    return r;
  });
  const feeds = new Set(rs.map((r) => r.state.config.tokenInfo.scopeConfiguration.priceFeed.toString()));
  if (feeds.size !== 1) {
    // Scope rejects a second refresh_price_list in the same tx (it must follow only ComputeBudget ixs).
    throw new Error(`reserves span ${feeds.size} Scope feeds; one refresh_price_list can cover only one`);
  }
  const prices = address([...feeds][0]!);
  const scope = new Scope("mainnet-beta", kitRpc());
  const [configAddr, config] = await scope.getSingleFeedConfiguration({ prices });
  const [mappings, oraclePrices] = await Promise.all([
    scope.getOracleMappings({ config: configAddr }),
    scope.getSingleOraclePrices({ prices }),
  ]);
  const now = Math.floor(Date.now() / 1000);
  const ts = (i: number): number => Number(oraclePrices.prices[i]!.unixTimestamp.toString());
  const valid = (i: number): boolean => i < mappings.priceTypes.length;

  const tokens: number[] = [];
  function sources(i: number): number[] {
    const t = mappings.priceTypes[i];
    const g = Buffer.from(mappings.generic[i]!);
    if (t === 33) return [g.readUInt16LE(0)]; // cap/floor entries do not gate freshness
    if (t === 28 || t === 39) return [0, 1, 2, 3].map((k) => g.readUInt16LE(k * 2)).filter(valid);
    if (t === 12) return [Number(mappings.twapSource[i])];
    return [];
  }
  // Post-order walk: sources are refreshed before the entries derived from them.
  // Returns the upstream publish time that entry i can at best carry after refresh.
  function walk(i: number): number {
    if (!valid(i)) return Infinity;
    const t = mappings.priceTypes[i]!;
    if (t === FIXED_PRICE) return Infinity;
    if (!DERIVED.has(t)) return ts(i);
    const srcTs = sources(i).map(walk);
    if (!tokens.includes(i)) tokens.push(i);
    return t === 33 || t === 12 ? srcTs[0]! : Math.max(...srcTs);
  }

  const upstreamAgeSeconds: Record<string, number> = {};
  for (const r of rs) {
    const info = r.state.config.tokenInfo;
    const chain = (c: number[]) => c.filter((x) => x !== U16_MAX);
    const priceTs = Math.min(...chain(info.scopeConfiguration.priceChain).map(walk));
    chain(info.scopeConfiguration.twapChain).forEach(walk);
    const age = now - priceTs;
    upstreamAgeSeconds[r.getTokenSymbol()] = age;
    const maxAge = Number(info.maxAgePriceSeconds.toString());
    if (age > maxAge) {
      throw new MarketClosedError(
        r.getTokenSymbol().replace(/x$/, ""),
        null,
        `Scope upstream (ChainlinkX / PythLazer) for ${r.getTokenSymbol()} last published ${age}s ago, ` +
          `over the reserve's ${maxAge}s maxAgePriceSeconds. refresh_price_list only recomputes derived entries, ` +
          `so klend would reject the transaction with ReserveStale (6009); not building it.`,
      );
    }
  }

  const ix = tokens.length === 0 ? null : await scope.refreshPriceListIxWithAccounts(tokens, config, mappings);
  return {
    instruction: ix === null ? null : kitIxToWeb3(ix as Parameters<typeof kitIxToWeb3>[0]),
    tokens,
    upstreamAgeSeconds,
  };
}
