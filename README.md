# Contra

Live: https://contra-puce.vercel.app
Repo: https://github.com/passionate-dev7/contra

Contra is a one-signature short ticket for tokenized US stocks on Solana. Pick a ticker, deposit USDC, and one transaction deposits it as collateral on Kamino, borrows the xStock, and sells it through Jupiter. Closing is the same idea in reverse.

## The problem

Kamino's xStocks Market (`5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua`) already prices the borrow side of nine tokenized stocks. Pulled live from `api.kamino.finance/kamino-market/.../reserves/metrics` on 2026-09-25:

| xStock supplied vs borrowed (USD) | |
|---|---|
| Total xStock collateral supplied | $22,689,278.56 |
| Total xStock currently borrowed | $157,203.77 |
| Utilization | 0.69% |
| Tickers with $0 ever borrowed | GOOGLx, CRCLx, AAPLx, MSTRx, HOODx, METAx (6 of 10) |

The rails exist and carry a live borrow rate on every one of them. Almost nobody uses them. Part of that is Kamino's own borrow caps: querying `contra-puce.vercel.app/api/reserves` right now shows only SPYx, QQQx, TSLAx, and NVDAx as actually borrowable; the other six read `"borrow limit 0 on Kamino"` straight from the deployed reserve config, not from a guess. The rest is that borrowing an xStock, selling it on Jupiter, and later buying it back to repay is at least four separate instructions across two protocols, each needing a fresh Kamino oracle refresh and a fresh Jupiter quote. Nobody had wired that into one thing a wallet can sign once.

## What Contra does

**Open a short (one signature).** The order ticket reads Kamino's live reserve config, shows which xStocks are borrowable right now with the reason for the ones that aren't, then builds a single versioned transaction: `deposit_reserve_liquidity_and_obligation_collateral` (USDC in) → `borrow_obligation_liquidity` (the xStock) → a Jupiter swap of that xStock back to USDC, composed from Jupiter's swap-instructions endpoint rather than a pre-built transaction so it fits alongside the Kamino instructions in the same message.

**Close a short (one signature).** Same shape in reverse: buy the xStock back through Jupiter, `repay_obligation_liquidity`, `withdraw_obligation_collateral_and_redeem_reserve_collateral`. Jupiter has no exact-out route for these mints, so the close buys exact-in with a small buffer over the oracle price and checks the quote's minimum-out covers the repay before it ever builds a transaction.

**Price freshness, not a stale-oracle short.** Kamino prices every xStock reserve through a Scope chain (Chainlink Data Streams and Pyth Lazer feeding derived entries). Before either transaction is built, Contra recomputes how stale the upstream leaves are and prepends a `refresh_price_list` instruction at index 1 (right after the compute-budget instruction, which is the only thing Scope allows before it) covering every derived entry the reserves touch. If the upstream leaves themselves are too old, a fresh in-transaction refresh can't fix that, and building stops with `MarketClosedError` instead of submitting a transaction Kamino would reject with `ReserveStale`.

**Only what's actually borrowable.** The ticket and blotter both read `/api/reserves`, which computes `borrowable` from the deployed `borrowLimit` and available liquidity on each reserve, not a hardcoded list. A blocked ticker can't be selected, and the reason is shown inline instead of just greying it out.

## Evidence

Two mainnet `simulateTransaction` runs, each checked by a script that never imports the code that built the transaction and instead re-decodes the raw account bytes with klend-sdk's own on-chain layout:

| | Open (`packages/short/check.mjs`) | Close (`packages/short/check-close.mjs`) |
|---|---|---|
| Request | deposit 0.5 USDC, borrow 0.001 SPYx | repay 0.01 SPYx, withdraw 5 USDC |
| Route | Whirlpool | measured against a live Jupiter quote |
| Post-conditions checked | obligation USDC deposit increases; obligation SPYx borrow increases by exactly the requested raw amount; the owner's xStock account nets to ~0 (borrowed then sold in the same transaction); the owner's USDC delta matches collateral-out plus sale proceeds within 3% | borrow decreases by the repaid amount after accruing interest to the post-refresh rate; USDC collateral decreases by the withdrawn amount at the post-refresh exchange rate; the xStock account nets to a bounded surplus, never negative; USDC delta matches withdrawn minus buy-back cost |
| Result, rerun 2026-09-25 | `GREEN: all post-conditions held` (`simulation returned err: null`) | `GREEN: all post-conditions held` on the artifact in the repo |

The open-short run above is a live rerun of `npx tsx src/simulate.ts` followed by `node check.mjs`, not a cached result: it printed the same five `PASS` lines shown in `packages/short/artifacts/sim-open.json`.

A check that can't fail proves nothing, so each direction also has a red counterpart in `packages/short/artifacts/`: `sim-open-red.json` asks to borrow 1 whole TSLAx and the simulation reverts on-chain with klend's custom error 6009 (`ReserveStale`); `sim-close-red.json` asks to withdraw $4,000 of USDC collateral against a 0.01 SPYx repay and reverts with custom error 6011 (`WithdrawTooLarge`). Both checkers correctly report `RED` on these, which is what makes the `GREEN` on the real runs mean something.

`check-web.mjs` builds the deployed Next.js app, boots it, and asserts against the live routes: `/api/reserves` returns exactly the borrowable set computed above, the home page states the live "N of M xStocks can be shorted" figure and the US market open/closed state, and `/api/open` returns a transaction that actually invokes both the Kamino program and Jupiter's router.

## Honest status

- No signed mainnet short has been sent from Contra. Every proof above is `simulateTransaction`, never a submitted transaction, because sending one costs real USDC and the two red tests exist specifically to show the guard rails fire before that point.
- Opening a short only works during US market hours, because Kamino's Scope crank for these reserves refreshes on that schedule; outside it, `buildOpenShort` throws `MarketClosedError` rather than submit a transaction against a stale oracle.
- Pyth's own live equity price (used for P&L and staleness display, separate from Kamino's Scope-priced oracle) needs `PYTH_API_KEY` in `.env`; Hermes has required a key on every price-update request since 2026-08-26. Without it, `requireFreshEquityPrice` throws `PythApiKeyMissingError` instead of silently skipping the check.
- Kamino's own borrow caps currently allow only 4 of the 10 xStock reserves to be shorted (SPYx, QQQx, TSLAx, NVDAx); the other six have a deployed borrow limit of 0. Contra can't override that, only surface it.

## Run locally

```
pnpm install
pnpm --filter @contra/web dev            # web app on :3000
cd packages/short
npx tsx src/reserves.ts                  # print live reserve facts
npx tsx src/simulate.ts                  # build + simulate an open short, write artifacts/sim-open.json
node check.mjs                           # independently verify the artifact
npx tsx src/simulate-close.ts && node check-close.mjs
```

Environment: `SOLANA_RPC_URL` (or `RPC_URL`) for a Solana RPC endpoint, `PYTH_API_KEY` for live Hermes price checks. Neither is required to read reserves; both are required to build a real short.

## Risks

- **Liquidation.** A short is a leveraged position: if the xStock's price rises against the USDC collateral, the obligation can be liquidated on Kamino like any other borrow.
- **Borrow caps.** Six of ten xStock reserves are capped to zero borrow by Kamino today. That can change, but Contra doesn't control it and states the live number rather than a fixed list.
- **Oracle staleness.** The Scope price chain depends on Chainlink Data Streams and Pyth Lazer cranks that run during US market hours. Outside that window, or if a crank falls behind, opens and closes are blocked by design rather than proceeding on a stale price.
- **Non-US use only**, stated on the live site's footer. This is a short against tokenized equities, not the underlying security, and it isn't offered to US persons.

## Tracks entered

**Pyth**: the live `Equity.US.<TICKER>/USD` Hermes feed gates every open and close on market-open state and price freshness before a transaction is built, separate from and in addition to Kamino's own Scope oracle.

Meteora's DBC/Clawpump track was not entered: shorting an already-liquid, already-tokenized stock has no honest bonding-curve mechanic, and forcing one in would not reflect what the product actually does.
