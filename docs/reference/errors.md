# Errors

Contra has three named error classes, many plain `Error` messages, and on-chain errors from the programs it composes. Over HTTP, every builder error comes back as `502 { "error": "<message>" }`. Match on the message text; the HTTP layer does not return an error code.

## Named errors (`packages/short/src/pyth.ts`)

| Class | Message | Thrown by | When |
|---|---|---|---|
| `MarketClosedError` | `Equity.US.<T>/USD market is closed[; next open <ISO>][: <detail>]` | `buildScopeRefresh` (inside both builders) | a Scope leaf behind a reserve in the transaction is older than that reserve's `maxAgePriceSeconds`. The detail reads `Scope upstream (ChainlinkX / PythLazer) for <SYM> last published <n>s ago, over the reserve's <max>s maxAgePriceSeconds ... not building it.` |
| | | `POST /api/open`, `requireFreshEquityPrice` | the ticker's Pyth feed reports `market_hours.is_open: false`. `/api/open` returns it with status 409 |
| `StalePriceError` | `Equity.US.<T>/USD price is <n>s old, exceeds the <max>s freshness bound` | `requireFreshEquityPrice` | latest Hermes price older than `maxAgeSeconds` (default 60) |
| `PythApiKeyMissingError` | `PYTH_API_KEY is not set. ...` | `requireFreshEquityPrice` | no `PYTH_API_KEY` in the environment |

When `buildScopeRefresh` throws `MarketClosedError`, the message still starts with `Equity.US.<T>/USD market is closed` even though Pyth was not consulted. The cause is in the detail after the colon.

`requireFreshEquityPrice` is not called by the builders or any route, so `StalePriceError` and `PythApiKeyMissingError` do not reach `/api/open` or `/api/close`. The market-hours `MarketClosedError` from `/api/open` comes from `resolveEquityFeed`, which needs no key.

## Builder errors (plain `Error`)

| Message | Source | When |
|---|---|---|
| `Kamino market <addr> not found` | `market.ts:17`, `reserves.ts:31` | RPC returned no market account |
| `USDC reserve not found in market <addr>` | `market.ts:25` | |
| `No reserve with symbol <T>x in market <addr>` | `market.ts:35` | unknown ticker, or `"SPYx"` passed to the package (the package expects `"SPY"`) |
| `reserve <addr> not in market` | `scope.ts:50` | the owner's obligation references a reserve the loaded market lacks |
| `reserves span <n> Scope feeds; one refresh_price_list can cover only one` | `scope.ts:56` | reserves in the transaction use different Scope feeds |
| `Jupiter quote failed: <status> <body>` | `jupiter.ts:70` | Jupiter `/quote` non-2xx, including no route |
| `Jupiter swap-instructions failed: <status> <body>` | `jupiter.ts:97` | Jupiter `/swap-instructions` non-2xx |
| `buy-back quote min out <x> is below the repay amount <y>` | `build.ts:246` | close: even after one re-quote, Jupiter's minimum out does not cover the repay |
| `buy-back of <n> <T>x needs <x> raw USDC, over maxUsdcIn <y>` | `build.ts:249` | close: the buy-back costs more than `maxUsdcIn` |
| `assertTokenAccountGteIx: minUsdcAfter must be >= 0, got <n>` / `overflows u64` | `guard.ts:30` | bound out of u64 range (the builder floors at 0, so only direct callers hit this) |
| `readOnlySigner: contra never signs transactions, the caller's wallet does` | `kit.ts:41` | something tried to sign with the placeholder signer; a bug |
| `kitIxToWeb3: lookup-table account metas are not supported, expected a plain AccountMeta` | `kit.ts:14` | klend-sdk returned an instruction with lookup-table account metas |

An invalid `owner` string fails inside `@solana/kit`'s `address()` or `new PublicKey()` with that library's message. Over `/api/open` and `/api/close` it is a 502, not a 400.

## Web read-side errors (`apps/web/src/lib`)

| Message | Source | Surfaces as |
|---|---|---|
| `Hermes price update failed: <status> ...` | `pyth-fair.ts:68` | `/api/pyth` 502 |
| `Hermes returned no parsed price for feed <id>` | `pyth-fair.ts:73` | `/api/pyth` 502 |
| `Hermes returned an unusable price for feed <id>` | `pyth-fair.ts:79` | `/api/pyth` 502 |
| `mint account data is not parsed: <mint>` | `xstock-price.ts:25` | `/api/pyth` 502; on `/api/positions` it fills `jupiterError` instead |
| `scaledUiAmountConfig on <mint> is missing multiplier fields` | `xstock-price.ts:39` | same as above |
| `Jupiter quote returned no output amount for mint <mint>` | `xstock-price.ts:66` | same as above |

## Wallet errors (browser, `apps/web/src/lib/wallet.ts` and `apps/web/src/components/CloseButton.tsx`)

| Message | When |
|---|---|
| `No Solana wallet found. Install a Wallet Standard wallet (Phantom, Backpack, Solflare).` | ticket connect with no Wallet Standard Solana wallet |
| `No Solana wallet found.` | close button, same condition |
| `<wallet> returned no account` | wallet connected without an account |
| `<wallet> does not support solana:signAndSendTransaction` | wallet lacks the feature |
| `<wallet> returned no signature` | wallet returned an empty result |
| `Connected wallet <a> does not match this position's owner <b>.` | close button, connected address is not the obligation owner |

## On-chain errors from composed programs

These appear in simulation or in a failed transaction as `{"InstructionError":[<index>,{"Custom":<code>}]}`. Use the index with [transaction-anatomy](../explanation/transaction-anatomy.md) to see which instruction failed.

| Program | Code | Name | When a Contra user hits it | Evidence |
|---|---|---|---|---|
| Lighthouse | 6001 (`0x1771`) | `AssertionFailed` | open: the owner's USDC balance at the end of the transaction is below `minUsdcAfter` (swap returned less than the quoted minimum, or USDC moved elsewhere) | `packages/short/artifacts/sim-guard-fail.json`: `[11,{"Custom":6001}]`, log `Program L2TEx... failed: custom program error: 0x1771`. Name from `LighthouseError` in `Jac0xb/lighthouse` `programs/lighthouse/src/error.rs` |
| klend | 6009 | `ReserveStale` ("Reserve state needs to be refreshed") | a reserve's price is too old at execution. The builder's Scope check exists to prevent this, but a transaction built just inside the window can still land outside it | `packages/short/artifacts/sim-open-red.json`: `[8,{"Custom":6009}]` on a 1 TSLAx borrow. Name from `packages/short/node_modules/@kamino-finance/klend-sdk/dist/@codegen/klend/errors/custom.js` |
| klend | 6011 | `WithdrawTooLarge` ("Withdraw amount too large") | close: `withdrawRaw` is more than klend lets the obligation withdraw | `packages/short/artifacts/sim-close-red.json`: `[11,{"Custom":6011}]` on a 4000 USDC withdraw against a 0.01 SPYx repay. Same klend-sdk source |

Other failures a user can hit without a committed artifact: Jupiter's own slippage error when the price moves past `slippageBps` before landing, and klend errors for exceeding borrow limits or LTV. Look these up in that klend-sdk file and Jupiter's program IDL by code.
