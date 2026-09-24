// Exercises buildScopeRefresh's MarketClosed gate against live Scope data: once with the
// real reserve maxAgePriceSeconds (expect pass + ages), once with it forced to 1s in memory
// (expect MarketClosedError), since the upstream cannot be made stale on demand.
import { loadMarket, findUsdcReserve, findXstockReserve } from "../src/market.js";
import { buildScopeRefresh } from "../src/scope.js";
const market = await loadMarket();
const rs = [findUsdcReserve(market), findXstockReserve(market, "SPY"), findXstockReserve(market, "TSLA")];
const ok = await buildScopeRefresh(market, rs.map((r) => r.address));
console.log("live:", JSON.stringify(ok.upstreamAgeSeconds), "tokens", ok.tokens.join(","), "ix accounts", ok.instruction?.keys.length);
(rs[1]!.state.config.tokenInfo as { maxAgePriceSeconds: unknown }).maxAgePriceSeconds = 1;
try {
  await buildScopeRefresh(market, rs.map((r) => r.address));
  console.log("forced: NO ERROR (gate broken)");
} catch (e) {
  console.log(`forced: ${(e as Error).name}: ${(e as Error).message}`);
}
