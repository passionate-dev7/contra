# HTTP API reference

Six route handlers live in `apps/web/src/app/api`. Every one sets `export const dynamic = "force-dynamic"`, so nothing is cached. No route requires authentication. Errors are always JSON `{ "error": string }`.

Base URL for a local run: `http://localhost:3000`.

| Method | Path | Handler |
|---|---|---|
| GET | `/api/reserves` | `apps/web/src/app/api/reserves/route.ts` |
| POST | `/api/open` | `apps/web/src/app/api/open/route.ts` |
| POST | `/api/close` | `apps/web/src/app/api/close/route.ts` |
| GET | `/api/positions` | `apps/web/src/app/api/positions/route.ts` |
| GET | `/api/hedge` | `apps/web/src/app/api/hedge/route.ts` |
| GET | `/api/pyth` | `apps/web/src/app/api/pyth/route.ts` |

## GET /api/reserves

Every reserve in the xStocks market, read live through klend-sdk. No parameters.

```bash
curl -s localhost:3000/api/reserves
```

**200**: a bare JSON array of `PublicReserveRow` (`apps/web/src/lib/types.ts`):

| Field | Type | Meaning |
|---|---|---|
| `symbol` | string | reserve symbol, e.g. `SPYx`, `USDC` |
| `isXstock` | boolean | symbol ends in lowercase `x` |
| `borrowable` | boolean | xStock with `borrowLimit > 0`, remaining cap above 0, and available liquidity above 0 |
| `reason` | string | `live`, `borrow limit 0 on Kamino`, `borrow cap reached on Kamino`, `no available liquidity on Kamino`, `collateral asset, not offered to short` (USDC), or `not an xStock reserve` |
| `maxLtv` | number | percent. For xStocks, the USDC/xStock pair max LTV; otherwise the reserve's own `loanToValuePct` |
| `liqLtv` | number | percent. Pair liquidation LTV for xStocks, else the reserve's `liquidationThresholdPct` |
| `borrowFactor` | number \| null | reserve config `borrowFactorPct / 100` (1.66 means 166%) |
| `pairBorrowFactor` | number \| null | USDC/xStock pair borrow factor; `null` for non-xStocks |
| `borrowApy` | number | fraction, e.g. `0.05` = 5% |
| `availableRaw` | string | available liquidity, raw base units |
| `decimals` | number | mint decimals |
| `mint` | string | liquidity mint |
| `priceUsd` | number \| null | Kamino oracle price; `null` when `oracleValid` is false |
| `oracleValid` | boolean | klend-sdk `hasValidOraclePrice()` |

**502**: market load or RPC failure.

## POST /api/open

Builds an open-short transaction with `buildOpenShort`. Does not sign or send.

Body (all strings, all required):

| Field | Meaning |
|---|---|
| `owner` | base58 wallet address; becomes fee payer and obligation owner |
| `ticker` | `SPY` or `SPYx`; a trailing `x` or `X` is stripped |
| `usdcCollateral` | USDC to deposit, raw base units (`"500000"` = 0.5 USDC) |
| `borrowRaw` | xStock to borrow and sell, raw base units |

```bash
curl -s -X POST localhost:3000/api/open \
  -H 'content-type: application/json' \
  -d '{"owner":"sadmBTQm5HJsyzWHEjV4YwG9CiahZKVDVqAyS4Wx1zH","ticker":"SPYx","usdcCollateral":"500000","borrowRaw":"100000"}'
```

That body is the one `check-web.mjs` posts.

**200**:

```json
{ "transactions": ["<base64 v0 tx>", "<optional second>"], "route": "Byreal", "reason": "single v0 transaction: ..." }
```

`transactions` has one element, or two when the message exceeded 1232 bytes. Send them in order, confirming the first before the second. Slippage is fixed at the builder default of 100 bps.

The raw strings are converted with `Number(raw) / 10 ** decimals` and back to raw inside the builder (`apps/web/src/app/api/open/route.ts:41`). Amounts above 2^53 raw units lose precision.

**400**: `invalid JSON body`, or `owner, ticker, usdcCollateral, borrowRaw are required`.
**409**: `MarketClosedError` when the ticker's Pyth `Equity.US.<T>/USD` feed reports the market closed. Checked before anything is built.
**502**: any builder error, including a Scope-staleness `MarketClosedError`, an unknown ticker, an invalid owner address, and Jupiter failures. See [errors](errors.md).

## POST /api/close

Builds a close with `buildCloseShort`: Jupiter buy-back, repay, withdraw.

Body (all strings, all required):

| Field | Meaning |
|---|---|
| `owner` | base58 wallet address |
| `ticker` | `SPY` or `SPYx` |
| `repayRaw` | xStock to repay, raw base units (borrow plus accrued interest) |
| `withdrawRaw` | USDC collateral to withdraw, raw base units |
| `maxUsdcInRaw` | USDC ceiling for the buy-back, raw base units |

```bash
curl -s -X POST localhost:3000/api/close \
  -H 'content-type: application/json' \
  -d '{"owner":"<owner>","ticker":"SPYx","repayRaw":"10000","withdrawRaw":"5000000","maxUsdcInRaw":"15000000"}'
```

**200**: same shape as `/api/open`.
**400**: `invalid JSON body`, or `owner, ticker, repayRaw, withdrawRaw, maxUsdcInRaw are required`.
**502**: builder errors, including `buy-back quote min out ... is below the repay amount ...` and `buy-back of ... needs ... raw USDC, over maxUsdcIn ...`.

## GET /api/positions

The owner's vanilla obligation on the xStocks market, read at the current slot.

| Query | Required | Meaning |
|---|---|---|
| `owner` | yes | base58 wallet address |

```bash
curl -s 'localhost:3000/api/positions?owner=DK7iCr4uSjKQF7qYTnygrrZuAc2hFNaKPrYDV2UKikWC'
```

**200**: `null` when the owner has no obligation, or when it has no deposits and no borrows. Otherwise `ObligationView` (`apps/web/src/lib/obligation.ts:48`):

| Field | Type | Meaning |
|---|---|---|
| `obligationAddress` | string | obligation PDA |
| `deposits`, `borrows` | `PositionLine[]` | `{ symbol, amount, marketValueUsd, decimals, reserveAddress }`; `amount` in UI units |
| `shorts` | `ShortPosition[]` | one per xStock borrow, below |
| `totalDepositUsd`, `totalBorrowUsd` | number | klend-sdk refreshed stats |
| `loanToValuePct`, `liquidationLtvPct` | number | percent, 0 to 100 |
| `liquidationPriceUsd`, `liquidationTicker` | number \| null, string \| null | the first short's values |
| `healthy` | boolean | `loanToValue < liquidationLtv` |

`ShortPosition` fields: `symbol`, `reserveAddress`, `mint`, `decimals`, `rawUnitAmount`, `multiplier`, `displayedAmount`, `kaminoValueUsd`, `jupiterPricePerShare`, `jupiterValueUsd`, `jupiterError`, `pairBorrowFactor`, `liquidationPriceUsd`, `accruedInterest`, `lastBorrowActivityUnix`, `pythEntitled`. Definitions are in [oracle-and-pricing](../explanation/oracle-and-pricing.md#positions-pl). A failed Jupiter quote does not fail the route: it sets `jupiterPricePerShare` and `jupiterValueUsd` to `null` and fills `jupiterError`.

**400**: `owner is required`, or `"<owner>" is not a valid Solana address`.
**502**: market load or RPC failure.

## GET /api/hedge

A wallet's xStock holdings and a suggested hedge size.

| Query | Required | Meaning |
|---|---|---|
| `owner` | yes | base58 wallet address |

The page at `/hedge` takes `?wallet=`, not `?owner=`. The API takes `?owner=`.

```bash
curl -s 'localhost:3000/api/hedge?owner=DrAR2ZNC5KYZps7NJyYHfzeZTaqbMUaGM3CBUWfpbCUs'
```

**200**:

```json
{
  "holdings": [{ "symbol": "SPYx", "mint": "...", "amountRaw": "...", "amountUi": 0.0, "usd": 0.0 }],
  "suggestion": { "ticker": "SPYx", "borrowRaw": "...", "reason": "Hedge 50% of the SPYx holding at the live max LTV." }
}
```

- `holdings`: every Token-2022 account of the owner whose mint and decimals match an xStock reserve, summed per mint, sorted by USD value. `usd` is `null` when Kamino's oracle price is not valid.
- `suggestion`: half of the largest holding that is borrowable with a valid price, capped at `min(availableLiquidity, borrowLimit - borrowed)`. The reason then reads "Kamino's available borrow is below 50% of the ... holding, so the hedge is capped at live reserve capacity." When nothing qualifies, `ticker` is `""`, `borrowRaw` is `"0"`, and `reason` explains why.

The collateral sizing (`plan` in `apps/web/src/lib/hedge.ts`) is computed but not returned by this route. Only the `/hedge` page renders it.

`readHedge` reads with `SOLANA_RPC_URL` or the public endpoint. It ignores `RPC_URL` (`hedge.ts:108`).

**400**: `owner is required`, or `owner must be a valid Solana address`.
**502**: RPC or market read failure.

## GET /api/pyth

The Pyth fair-value line for one xStock.

| Query | Required | Meaning |
|---|---|---|
| `ticker` | yes | `TSLA`, `TSLAx`, `tslax`; normalized to `<BASE>x` |

```bash
curl -s 'localhost:3000/api/pyth?ticker=TSLAx'
```

**200**: `PythFair` (`apps/web/src/lib/pyth-shared.ts:9`):

| Field | Type | Meaning |
|---|---|---|
| `ticker` | string | normalized symbol |
| `pythPrice` | number \| null | Hermes price |
| `confidence` | number \| null | Hermes confidence |
| `publishTime` | number \| null | unix seconds |
| `session` | `"open"` \| `"closed"` \| null | from the feed's market hours |
| `jupiterSellPrice` | number \| null | USDC per displayed share on a one-share Jupiter sell |
| `gapBps` | number \| null | `(jupiterSellPrice / pythPrice - 1) * 10000` |
| `reason` | string \| null | `null` when live; `PYTH_API_KEY not configured` or `Pyth feed not in the current plan` otherwise |

Only TSLAx and QQQx have entitled feeds (`apps/web/src/lib/pyth-fair.ts:13`). Every other ticker, and every ticker when `PYTH_API_KEY` is unset, returns 200 with all price fields `null`.

**400**: `ticker is required`.
**502**: `Hermes price update failed: <status> ...`, `Hermes returned no parsed price for feed ...`, `Hermes returned an unusable price for feed ...`, or a failure in the Jupiter or mint read.
