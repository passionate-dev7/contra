# Oracle and pricing

Contra reads prices from three places. They answer different questions and are not interchangeable.

| Source | Where it is read | What it is used for |
|---|---|---|
| Kamino's Scope chain | `packages/short/src/scope.ts`, klend-sdk `getOracleMarketPrice` | the only price klend checks on-chain; LTV, liquidation, the ticket's size-to-amount conversion, the close buy-back sizing |
| Pyth Hermes `Equity.US.<T>/USD` | `packages/short/src/pyth.ts`, `apps/web/src/lib/pyth-fair.ts` | the UI's market open/closed state (SPY feed), and the fair-value line for TSLAx and QQQx |
| Jupiter quotes | `packages/short/src/jupiter.ts`, `apps/web/src/lib/xstock-price.ts` | the actual sell or buy route, the Lighthouse bound, and the positions page's market mark |

## The Scope chain walk

Every reserve in the xStocks market prices through Scope entries. The comment at `scope.ts:10` gives SPYx as an example:

```
344 CappedFloored(src 343, cap/floor 278)
  343 MostRecentOf(278 ChainlinkX, 342 PythLazer, sourcesMaxAge 60s)
279 ScopeTwap(src 278)
```

Leaves (`ChainlinkX`, `PythLazer`) only move when someone posts a signed report, which needs the provider's credentials. Derived entries can be recomputed by anyone with `refresh_price_list`. So an in-transaction refresh helps when Kamino's crank has not recomputed the derived entries, and cannot help when the leaves themselves are old.

`buildScopeRefresh(market, reserves)` does this:

1. Collect the reserves klend will refresh: every deposit and borrow in the owner's current obligation plus the USDC and xStock reserves of this action (`build.ts:58`).
2. Require that they share one Scope price feed. Scope allows only one `refresh_price_list` per transaction.
3. Load the feed's oracle mappings and current prices through `@kamino-finance/scope-sdk`.
4. Walk each reserve's `priceChain` and `twapChain` post-order. Derived types are 33 CappedFloored, 28 MostRecentOf, 39 CappedMostRecentOf, 12 ScopeTwap (`scope.ts:30`). Each derived entry is added to the refresh list. The walk returns the freshest leaf time that entry can carry after refresh: the maximum over sources for MostRecentOf, the single source for CappedFloored and TWAP, and "infinitely fresh" for FixedPrice (type 23).
5. For each reserve, `age = now - min(priceChain entries)`. If `age > reserve.config.tokenInfo.maxAgePriceSeconds`, throw `MarketClosedError`. The message says klend would reject the transaction with `ReserveStale` (6009).
6. Otherwise return one `refresh_price_list` instruction covering the collected entries, or `null` if there are none.

`maxAgePriceSeconds` is per reserve. Read on 2026-09-25 with klend-sdk from market `5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua`: 300 s for every xStock reserve, 180 s for USDC and USDG, 120 s for cbBTC.

### The gate is leaf age, not a clock

`buildOpenShort` does not check US market hours. It refuses only when a Scope leaf is too old. On 2026-09-25 at 06:25 UTC, Hermes reported `Equity.US.SPY/USD` with `is_open: false`, and a `buildOpenShort` call for 0.001 SPYx still succeeded (single transaction, 1024 bytes). The Scope comment at `scope.ts:25` explains why this can happen: the xStock ChainlinkX mappings accept reports in any market status, so staleness shows up only when the leaf timestamps age out.

So the market-hours gate lives one layer up. `POST /api/open` resolves the ticker's own `Equity.US.<T>/USD` feed with `resolveEquityFeed` and returns 409 with `MarketClosedError` when `market_hours.is_open` is false, before any Kamino or Jupiter call (`apps/web/src/app/api/open/route.ts`). `apps/web/check-open-gate.mjs` reads Hermes independently and asserts the route agrees; with the gate removed, the same request built a transaction while the market was closed. The web ticket also disables **Open short** when the SPY feed says closed (`apps/web/src/components/Ticket.tsx:78`). A caller using the package directly gets only the Scope leaf-age gate. Closing is never blocked by market hours, so a borrower can always exit.

## Pyth: what it does and does not gate

`packages/short/src/pyth.ts` exports two functions:

- `resolveEquityFeed(ticker)`: calls Hermes `/v2/price_feeds?query=Equity.US.<T>` (no API key) and returns the feed id plus `market_hours`.
- `requireFreshEquityPrice(ticker, maxAgeSeconds = 60)`: throws `MarketClosedError` if the market is closed, `PythApiKeyMissingError` if `PYTH_API_KEY` is unset, or `StalePriceError` if the latest price is older than `maxAgeSeconds`.

`requireFreshEquityPrice` is not called by `buildOpenShort`, `buildCloseShort`, or any API route; its only caller is `packages/short/spikes/pyth_gate.mjs`. It needs `PYTH_API_KEY`, and the current Pyth plan entitles only TSLA and QQQ price updates, so it cannot gate every ticker. `PYTH_EQUITY_FEED_IDS` in `constants.ts:24` is an empty object that nothing reads. Pyth's role in the running product is the three items below.

1. **Market-hours gate on opens.** `/api/open` refuses with 409 while the ticker's feed reports the market closed (above).
1. **Market state for the UI.** `readMarketOpenState()` (`apps/web/src/lib/reserves.ts:157`) reads the SPY feed's `is_open`. The home page shows it and the ticket gates on it.
2. **Fair-value line.** `readPythFair(ticker)` (`apps/web/src/lib/pyth-fair.ts:52`) is served at `/api/pyth` and rendered by `PythLine` in the ticket and on each short card.

### The fair-value line

`readPythFair` returns nulls with a `reason` when:

- `PYTH_API_KEY` is not set: `"PYTH_API_KEY not configured"`
- the ticker is not TSLAx or QQQx: `"Pyth feed not in the current plan"`

The TSLAx and QQQx feed ids are pinned in `pyth-fair.ts:13`. For those two it:

1. fetches `/v2/updates/price/latest?ids[]=<id>&parsed=true` with `Authorization: Bearer $PYTH_API_KEY`
2. computes `pythPrice = price * 10^expo` and `confidence = conf * 10^expo`
3. sets `session` from `resolveEquityFeed`; if that call fails, "open" when the publish is under 900 s old, else "closed"
4. quotes a Jupiter sell of one displayed share (below) and returns `gapBps = (jupiterSellPrice / pythPrice - 1) * 10000`

`PythLine` turns the gap red above 100 bps (`apps/web/src/components/PythLine.tsx:12`). The line is informational. Nothing blocks a trade on it.

## Jupiter marks and the scaled-UI multiplier

xStock mints are Token-2022 and may carry a `scaledUiAmountConfig` extension: the amount a wallet displays is the raw amount times a multiplier. `readOperativeMultiplier(mint)` (`apps/web/src/lib/xstock-price.ts:20`) reads the parsed mint account and passes `multiplier`, `newMultiplier` and `newMultiplierEffectiveTimestamp` to `operativeMultiplier` from `@fineprint/core`. A mint without the extension returns 1. A mint whose extension lacks those fields throws rather than defaulting to 1.

`readXstockLivePrice(mint, decimals)` then quotes a sell of `round(10^decimals / multiplier)` raw units, which is one displayed share, at 100 bps slippage. It returns USDC out per displayed share. The size is fixed small on purpose so the price reflects the market rather than the position's own price impact.

## Positions P&L

`readObligation(owner)` (`apps/web/src/lib/obligation.ts:68`) loads the owner's vanilla obligation through klend-sdk at the current slot. For each xStock borrow it reports:

| Field | Computation |
|---|---|
| `rawUnitAmount` | `position.amount / 10^decimals`, the amount owed in raw mint units, interest included |
| `displayedAmount` | `rawUnitAmount * multiplier` |
| `kaminoValueUsd` | klend-sdk's `marketValueRefreshed`, the Scope-priced value klend uses for LTV |
| `jupiterValueUsd` | `displayedAmount * jupiterPricePerShare`, or `null` with `jupiterError` if the quote failed |
| `accruedInterest` | `position.amount - borrowedAmountSf` from the raw account, converted to UI units |
| `lastBorrowActivityUnix` | the raw borrow entry's `lastBorrowedAtTimestamp` |
| `liquidationPriceUsd` | `stats.borrowLiquidationLimit / (rawUnitAmount * pairBorrowFactor)` |

The short card shows the gap `jupiterValueUsd / kaminoValueUsd - 1` and turns it red above 1%.

### Limits

- **No entry price.** Contra runs no indexer and stores nothing. There is no realized or unrealized P&L against an entry. The two marks are both current values of the debt.
- **Interest is since the last action, not since open.** `accruedInterest` compares the current amount to the principal snapshot taken at the last borrow or repay on that reserve.
- **Liquidation price assumes one moving asset.** It holds USDC collateral and every other borrow fixed. With more than one xStock borrow, each card's figure ignores the others moving. The obligation-level `liquidationPriceUsd` is simply the first short's figure.
- **Liquidation price is per raw mint unit.** It divides by `rawUnitAmount`, not `displayedAmount`. When a mint's multiplier is not 1, it is not a per-displayed-share price.
- **Jupiter mark is a sell quote.** Closing a short means buying. A buy quote for the full size can differ from one-share sell price times size.
