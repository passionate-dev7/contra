# Contra architecture

## Components

**`packages/short/src`** is the protocol layer; it never touches a private key and returns unsigned transactions.

- `constants.ts`: pins the xStocks Market address (`5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua`), the klend program id (`KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`), USDC's mint, and the Kamino-published lookup table for this market (`8ofreL6hKfEet1DnhHVGvCTnSdz4pg85PpbuCUHnEcKm`, verified on-chain: active, 95 entries covering the market, its reserves, Scope price accounts, and the klend program).
- `rpc.ts`: resolves one RPC URL (`SOLANA_RPC_URL`, then `RPC_URL`, then the public mainnet endpoint) into both a `@solana/web3.js` `Connection` (simulate, `getAccountInfo`) and a `@solana/kit` `Rpc` (required by klend-sdk).
- `market.ts` / `reserves.ts`: load the `KaminoMarket` via klend-sdk and read every reserve's deployed config directly: max LTV, liquidation threshold, borrow factor, available liquidity, borrow limit, and remaining borrow-cap headroom. A reserve is borrowable only when it has both available liquidity and remaining cap room; this is the same computation `apps/web/src/lib/reserves.ts` calls for `/api/reserves`.
- `scope.ts`: Kamino prices every reserve through a Scope chain of derived entries (`CappedFloored`, `MostRecentOf`, `ScopeTwap`) built from leaf feeds (`ChainlinkX`, `PythLazer`). `buildScopeRefresh` walks that chain, builds one `refresh_price_list` instruction covering every derived entry the transaction's reserves touch, and throws `MarketClosedError` before building anything if a leaf is older than the reserve's `maxAgePriceSeconds`; a fresh refresh of a derived entry can't outrun a stale leaf underneath it.
- `jupiter.ts`: calls Jupiter's `/swap/v1/quote` and `/swap/v1/swap-instructions` (not `/swap`), because raw instructions compose into the same v0 message as the Kamino instructions instead of arriving as a separate pre-built transaction.
- `pyth.ts`: resolves the `Equity.US.<TICKER>/USD` Hermes feed (`resolveEquityFeed`, free, no key; `/api/open` refuses with 409 when its `market_hours.is_open` is false) and exposes `requireFreshEquityPrice`, which also checks the latest price's age against `PYTH_API_KEY`-gated `/v2/updates/price/latest` (used by `spikes/pyth_gate.mjs`, not by the builders). This is separate from Kamino's Scope oracle; it's the feed the product uses for the open gate and the fair-value cross-check.
- `guard.ts`: builds a Lighthouse `AssertTokenAccount` instruction (program `L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95`) asserting the owner's USDC token account is at or above a minimum amount, appended as the last instruction in the open-short transaction. A normal open's minimum is satisfiable and the assertion passes on-chain; an impossible minimum makes Lighthouse revert the whole transaction with its own custom error `6001`, so a bad outcome (a swap shortfall, a wrong ATA) fails inside the transaction instead of only being caught by an off-chain check that runs after the money has already moved.
- `build.ts`: assembles `buildOpenShort` and `buildCloseShort`: Kamino instructions via klend-sdk's `KaminoAction`, the Jupiter leg, the Scope refresh, the Lighthouse postcondition, one compute-budget instruction, and the xStocks-market lookup table, compiled into a v0 `VersionedTransaction`. Falls back to two transactions only if the combined message exceeds Solana's 1232-byte limit.
- `simulate.ts` / `simulate-close.ts` / `simulate-guard.ts`: mainnet proof scripts. Build a real transaction for a real funded Kamino obligation (found by scanning live obligations in `packages/short/spikes/`), run `simulateTransaction` with `sigVerify:false` and a replaced blockhash, and write pre-state plus simulated post-state account bytes to `artifacts/*.json`. `simulate-guard.ts` takes a `pass`/`fail` argument and writes `sim-guard-pass.json` / `sim-guard-fail.json`, the second with a Lighthouse minimum the transaction cannot satisfy. None of the three ever sign or send.
- `check.mjs` / `check-close.mjs` / `check-guard.mjs`: independent verifiers. `check.mjs` and `check-close.mjs` do not import `build.ts`; they re-decode the artifact's raw account bytes with klend-sdk's own generated `Obligation`/`Reserve` layouts and assert the balance-level post-conditions described in the README's evidence table. `check-guard.mjs` asserts the guarded-open artifact's simulation returned `err: null` with Lighthouse's program present in the logs, and the impossible-bound artifact reverted with `Custom: 6001` attributed to the Lighthouse program specifically.

**`apps/web`** (Next.js) is the interface: `/api/reserves` (GET, live reserve rows), `/api/open` and `/api/close` (POST, build a transaction from `@contra/short` and return it base64-encoded, unsigned), `/api/hedge` (GET, a wallet's xStock holdings plus a sizing suggestion), `/api/pyth` (GET, the fair-value cross-check for one ticker), `/api/positions` (GET, the live obligation view a positions page renders), plus the `/`, `/hedge`, and `/positions` pages. The browser signs and sends via the Wallet Standard (`apps/web/src/lib/wallet.ts`), never a private key on the server.

`apps/web/src/lib` holds the read-side logic the routes and server components share: `reserves.ts` (the blotter's live reserve rows, including the per-pair borrow factor), `hedge.ts` (reads a wallet's Token-2022 xStock balances directly via RPC and sizes a hedge against live reserve capacity), `obligation.ts` (`readObligation`: the owner's Kamino obligation, its deposits/borrows, and a `ShortPosition[]` per open xStock borrow with entry context, dual live marks, accrued interest, and liquidation price), `xstock-price.ts` (the scaled-UI multiplier read plus a live Jupiter per-share quote, shared by `pyth-fair.ts`'s fair-value line and `obligation.ts`'s positions marks so both price a share the same way), and `pyth-fair.ts` (the Pyth-vs-Jupiter fair-value line for TSLAx/QQQx, `/api/pyth`'s data source).

## Trust boundaries

- The server never holds a signing key. `buildOpenShort`/`buildCloseShort` take a `readOnlySigner` for the owner address and return an unsigned transaction; `apps/web/src/lib/wallet.ts` is where a real signature is produced, in the browser, via the Wallet Standard.
- Kamino's klend program, Jupiter's router, and Scope's oracle program are trusted on-chain code this project composes instructions for; Contra's own code never custom-signs or bypasses their instruction handlers.
- Price truth for gating comes from two independent places: Kamino's own Scope chain (what klend actually checks on-chain) and Pyth Hermes (what the product displays and uses for P&L). Contra refuses to build any transaction when Scope is stale, and refuses to build an open when Pyth reports the market closed or cannot be read.
- `check.mjs`/`check-close.mjs`/`check-guard.mjs` are a second trust boundary inside `packages/short`: they deliberately avoid importing `build.ts`, so a bug in the transaction builder can't also hide itself from the checker. `apps/web/check-hedge.mjs` and `apps/web/check-positions.mjs` extend the same discipline to the web app: each re-reads the relevant on-chain state directly (a raw RPC token-account read, or a raw obligation-account decode via klend-sdk's own layout) rather than trusting `apps/web/src/lib`'s own arithmetic, and `check-positions.mjs` also asserts the negative case (a fresh owner must report the named empty state, not a fabricated match).
- Positions P&L is scoped to what a stateless reader can prove. `readObligation` has no transaction history to draw on, so "entry context" is the position's own last on-chain borrow/repay timestamp (from the obligation account's `lastBorrowedAtTimestamp`), and "P&L" is two independent live marks (Kamino's Scope-oracle value versus a live Jupiter quote) rather than a profit figure computed against an entry price Contra never recorded.

## Why one v0 transaction

A v0 message has a hard 1232-byte wire limit. An open short needs, in order: a compute-budget instruction, an optional Scope `refresh_price_list` (which Scope requires to sit immediately after the compute-budget instruction), Kamino's deposit and borrow instructions, and Jupiter's swap setup/swap/cleanup instructions. Two things make that fit in one message often enough to matter: Jupiter's swap-instructions endpoint returns raw instructions instead of a wrapped transaction, so they compose directly; and the xStocks-market lookup table (95 entries: the market, every reserve, every Scope price account, the klend program) collapses most of the account list from full 32-byte keys to 1-byte indices. `build.ts` still measures the compiled message and falls back to two transactions, Kamino first then Jupiter, only when a wider Jupiter route (observed: Byreal near 1232 bytes, Riptide near 1165) pushes the combined message over the limit.

## Open-short sequence

```mermaid
sequenceDiagram
    participant User as User (wallet)
    participant Web as apps/web (/api/open)
    participant Short as packages/short (build.ts)
    participant Scope
    participant Klend as Kamino klend program
    participant Jupiter

    User->>Web: POST /api/open {owner, ticker, usdcCollateral, borrowRaw}
    Web->>Short: buildOpenShort(conn, req)
    Short->>Klend: load KaminoMarket, read reserve state
    Short->>Scope: walk Scope chain for held + action reserves
    alt leaf feed older than maxAgePriceSeconds
        Scope-->>Short: throw MarketClosedError
        Short-->>Web: error
        Web-->>User: 502 (no transaction built)
    else fresh enough
        Scope-->>Short: refresh_price_list instruction + tokens
        Short->>Klend: KaminoAction.buildDepositAndBorrowTxns
        Short->>Jupiter: GET /quote (xStock -> USDC)
        Jupiter-->>Short: quote
        Short->>Jupiter: POST /swap-instructions
        Jupiter-->>Short: setup + swap + cleanup instructions
        Short->>Short: compile v0 message with xStocks LUT
        Short-->>Web: {transaction, route, reason}
        Web-->>User: {transactions: [base64]}
        User->>User: sign with Wallet Standard
        User->>Klend: send signed transaction
        Klend->>Klend: deposit USDC, borrow xStock
        Klend->>Jupiter: CPI: route the borrowed xStock to USDC
        Klend-->>User: obligation now holds USDC collateral + xStock borrow, wallet holds sale proceeds
    end
```

## Close-short sequence

```mermaid
sequenceDiagram
    participant User as User (wallet)
    participant Web as apps/web (/api/close)
    participant Short as packages/short (build.ts)
    participant Scope
    participant Jupiter
    participant Klend as Kamino klend program

    User->>Web: POST /api/close {owner, ticker, repayRaw, withdrawRaw, maxUsdcInRaw}
    Web->>Short: buildCloseShort(conn, req)
    Short->>Klend: load KaminoMarket, read reserve state
    Short->>Scope: walk Scope chain for held reserves
    alt leaf feed too old
        Scope-->>Short: throw MarketClosedError
        Short-->>Web: error
        Web-->>User: 502 (no transaction built)
    else fresh enough
        Scope-->>Short: refresh_price_list instruction + tokens
        Short->>Jupiter: GET /quote (USDC -> xStock, ExactIn, oracle price + buffer)
        Jupiter-->>Short: quote
        alt quote minOut < repay amount
            Short->>Jupiter: re-quote with scaled input
            Jupiter-->>Short: quote
        end
        alt still short of repay, or over maxUsdcIn
            Short-->>Web: throw (no transaction built)
        else covers repay within budget
            Short->>Jupiter: POST /swap-instructions
            Jupiter-->>Short: setup + swap + cleanup instructions
            Short->>Klend: KaminoAction.buildRepayAndWithdrawTxns
            Short->>Short: compile v0 message with xStocks LUT
            Short-->>Web: {transaction, route, reason}
            Web-->>User: {transactions: [base64]}
            User->>User: sign with Wallet Standard
            User->>Jupiter: send signed transaction
            Jupiter->>Jupiter: buy back the xStock with USDC
            Jupiter->>Klend: (same tx) repay borrow, withdraw USDC collateral
            Klend-->>User: obligation's borrow and deposit both decrease, wallet holds any swap surplus + withdrawn USDC
        end
    end
```
