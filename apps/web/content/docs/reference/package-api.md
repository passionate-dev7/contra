# @contra/short package reference

Everything re-exported from `packages/short/src/index.ts`. The package is `private: true` and consumed as a workspace dependency (`"@contra/short": "workspace:*"`).

Not exported: `packages/short/src/kit.ts` (`readOnlySigner`, `kitIxToWeb3`) and `packages/short/src/scope.ts` (`buildScopeRefresh`, `ScopeRefresh`). Import them by file path if you need them.

## Builders (`build.ts`)

| Export | Signature |
|---|---|
| `buildOpenShort` | `(conn: Connection, req: ShortRequest) => Promise<BuiltShort>` |
| `buildCloseShort` | `(conn: Connection, req: CloseShortRequest) => Promise<BuiltShort>` |
| `ShortRequest` | `{ owner: string; ticker: string; usdcCollateral: number; borrowAmount: number; slippageBps?: number }` |
| `CloseShortRequest` | `{ owner: string; ticker: string; repayAmount: number; withdrawUsdc: number; maxUsdcIn: number; slippageBps?: number }` |
| `BuiltShort` | `{ instructions; lookupTables; quote: JupQuote; route: string; transaction: VersionedTransaction; secondTransaction?: VersionedTransaction; reason: string; scopeTokens: number[] }` |

`conn` is used for the blockhash, lookup table fetches, and (open only) the USDC balance read for the Lighthouse bound. The market, the ledger instant, and the Scope accounts are always read through `kitRpc()` from `resolveRpcUrl()`, not through `conn`. Both builders always load the xStocks market (`XSTOCKS_MARKET`); there is no market parameter.

Amounts are UI units. `ticker` is the base ticker (`"SPY"`). Default `slippageBps` is 100. Constants inside `build.ts`: compute unit limit 1,400,000; close buy-back buffer 50 bps plus slippage; close route `maxAccounts` 20. See [transaction-anatomy](../explanation/transaction-anatomy.md).

## Market (`market.ts`)

| Export | Signature | Notes |
|---|---|---|
| `loadMarket` | `(marketAddress = XSTOCKS_MARKET) => Promise<KaminoMarket>` | throws `Kamino market <addr> not found` |
| `findUsdcReserve` | `(market: KaminoMarket) => KaminoReserve` | matches `USDC_MINT` |
| `findXstockReserve` | `(market: KaminoMarket, ticker: string) => KaminoReserve` | matches symbol `${ticker.toUpperCase()}x` |
| `vanillaObligationType` | `(market: KaminoMarket) => VanillaObligation` | |
| `vanillaObligationAddress` | `(market: KaminoMarket, owner: Address) => Promise<Address>` | the owner's obligation PDA |
| `ledgerInstant` | `() => Promise<LedgerInstant>` | klend-sdk `getCurrentLedgerInstant` |

## Reserves (`reserves.ts`)

| Export | Signature |
|---|---|
| `readReserveFacts` | `(marketAddress = XSTOCKS_MARKET) => Promise<ReserveFacts[]>` |
| `ReserveFacts` | `{ symbol; mint; decimals; maxLtvPct; liquidationThresholdPct; borrowFactorPct; availableLiquidity; totalBorrowed; borrowLimit; remainingBorrowCap }` |

The four amount fields are UI-unit strings with 4 decimals. Running the file directly (`npx tsx src/reserves.ts`) prints a table and a borrowable verdict per xStock.

## Jupiter (`jupiter.ts`)

| Export | Signature |
|---|---|
| `getQuote` | `(p: { inputMint: string; outputMint: string; amount: bigint; slippageBps: number; maxAccounts?: number }) => Promise<JupQuote>` |
| `getSwapInstructions` | `(p: { quote: JupQuote; userPublicKey: string }) => Promise<JupSwapInstructions>` |
| `routeLabel` | `(quote: JupQuote) => string` |
| `JupQuote` | Jupiter quote response: `inputMint`, `inAmount`, `outputMint`, `outAmount`, `otherAmountThreshold`, `swapMode`, `slippageBps`, `priceImpactPct`, `routePlan`, plus passthrough keys |
| `JupSwapInstructions` | `{ setup: TransactionInstruction[]; swap: TransactionInstruction; cleanup: TransactionInstruction[]; lookupTableAddresses: string[] }` |

`getQuote` always sends `swapMode=ExactIn`. `getSwapInstructions` posts `wrapAndUnwrapSol: true` and `dynamicComputeUnitLimit: true`. It drops `computeBudgetInstructions` and `tokenLedgerInstruction` from the response.

## Lighthouse guard (`guard.ts`)

| Export | Signature |
|---|---|
| `LIGHTHOUSE_PROGRAM_ID` | `PublicKey` `L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95` |
| `assertTokenAccountGteIx` | `(usdcAta: string \| PublicKey, minAmount: bigint \| number \| string) => TransactionInstruction` |
| `withPostconditions` | `(instructions: TransactionInstruction[], p: Postconditions) => TransactionInstruction[]` |
| `Postconditions` | `{ owner: string \| PublicKey; usdcAta: string \| PublicKey; minUsdcAfter: bigint \| number \| string }` |

`assertTokenAccountGteIx` works on any SPL token account despite the parameter name. It throws for a negative bound or one at or above 2^64. `withPostconditions` appends one assertion and ignores `owner`.

## Pyth (`pyth.ts`)

| Export | Signature |
|---|---|
| `resolveEquityFeed` | `(ticker: string) => Promise<PriceFeedMeta>` |
| `requireFreshEquityPrice` | `(ticker: string, maxAgeSeconds = 60) => Promise<FreshPrice>` |
| `PriceFeedMeta` | `{ id: string; isOpen: boolean; nextOpenUnix: number \| null; nextCloseUnix: number \| null }` |
| `FreshPrice` | `{ ticker; feedId; priceUsd; publishTimeUnix; ageSeconds }` |
| `MarketClosedError`, `StalePriceError`, `PythApiKeyMissingError` | error classes, see [errors](errors.md) |

`requireFreshEquityPrice` is not called by either builder. See [oracle-and-pricing](../explanation/oracle-and-pricing.md#pyth-what-it-does-and-does-not-gate).

## RPC (`rpc.ts`)

| Export | Signature |
|---|---|
| `DEFAULT_RPC_URL` | `"https://api.mainnet-beta.solana.com"` |
| `resolveRpcUrl` | `() => string`: `SOLANA_RPC_URL`, then `RPC_URL`, then the default |
| `web3Connection` | `(url = resolveRpcUrl()) => Connection` at `confirmed` |
| `kitRpc` | `(url = resolveRpcUrl()) => Rpc` from `@solana/kit`, what klend-sdk needs |

## Constants (`constants.ts`)

`XSTOCKS_MARKET`, `KLEND_PROGRAM_ID`, `USDC_MINT`, `TOKEN_2022_PROGRAM_ID`, `XSTOCKS_MARKET_LUT`, `JUP_QUOTE_URL`, `JUP_SWAP_INSTRUCTIONS_URL`, `HERMES_URL`, `reserveMetricsUrl(market)`, `PYTH_EQUITY_FEED_IDS`. Values are in [addresses](addresses.md).

`reserveMetricsUrl` and `PYTH_EQUITY_FEED_IDS` are exported but nothing in the repo uses them. `PYTH_EQUITY_FEED_IDS` is an empty object.

## Scripts

`packages/short/package.json` defines `reserves`, `sim`, `sim:close`, `check` and `typecheck`:

```bash
pnpm --filter @contra/short reserves
pnpm --filter @contra/short sim
pnpm --filter @contra/short sim:close
pnpm --filter @contra/short check
pnpm --filter @contra/short typecheck
```
