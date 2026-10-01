# Contra

**Short a tokenized US stock on Solana with one signature.** Deposit USDC on Kamino, borrow the xStock, sell it on Jupiter: one v0 transaction, a Scope oracle refresh in front of it, a Lighthouse postcondition behind it.

- Live app: https://contra-sol.vercel.app
- Pitch deck: https://contra-sol.vercel.app/pitch
- Autonomous short agent: https://contra-sol.vercel.app/agent
- Developer docs: https://contra-sol.vercel.app/docs (source in [docs/README.md](docs/README.md))
- Repo: https://github.com/passionate-dev7/contra

## The problem

Kamino's xStocks Market (`5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua`) prices the borrow side of ten tokenized stocks and carries a live borrow rate on every one. Almost nobody borrows on it. Read from `api.kamino.finance/kamino-market/.../reserves/metrics` on 2026-09-25 and re-read on 2026-10-01:

| xStock supplied vs borrowed (USD) | 2026-09-25 | 2026-10-01 |
|---|---|---|
| Total xStock collateral supplied | $22,689,278.56 | $21,781,451.01 |
| Total xStock currently borrowed | $157,203.77 | $150,127.16 |
| Utilization | 0.69% | 0.69% |
| Tickers with $0 ever borrowed | GOOGLx, CRCLx, AAPLx, MSTRx, HOODx, METAx (6 of 10) | same six |

The reason is the workflow. Kamino's own guide opens a short in three wallet confirmations: supply USDC, borrow the xStock, swap it for USDC on a separate screen with a fresh quote. Each borrow also needs a Kamino oracle refresh at the right position in the message, or klend rejects it as `ReserveStale`. Between the second and third confirmation the trader holds a borrowed stock and no short. Contra builds that whole sequence as one transaction.

## What it does

**One signature to open.** The order ticket builds a single versioned transaction: `deposit_reserve_liquidity_and_obligation_collateral` (USDC in), `borrow_obligation_liquidity` (the xStock), then a Jupiter swap of that xStock back to USDC. The Jupiter leg is composed from Jupiter's swap-instructions endpoint, not taken as a pre-built transaction, so it lands in the same message as the Kamino instructions. Kamino's published xStocks lookup table (`8ofreL6hKfEet1DnhHVGvCTnSdz4pg85PpbuCUHnEcKm`, 95 entries) compresses the account list, and an open built on 2026-09-25 compiled to 1024 bytes against Solana's 1232-byte limit. `packages/short/src/build.ts` measures every compiled message; a Jupiter route wide enough to cross the limit is emitted as an ordered pair, the second sent after the first confirms.

**One signature to close.** The same message in reverse: buy the xStock back through Jupiter, `repay_obligation_liquidity`, `withdraw_obligation_collateral_and_redeem_reserve_collateral`. Jupiter has no exact-out route for these mints, so the close buys exact-in with a buffer over the oracle price and checks that the quote's minimum-out covers the repay before it builds anything.

**Never a stale-oracle short.** Kamino prices every xStock reserve through a Scope chain (Chainlink Data Streams and Pyth Lazer leaves feeding derived entries). Before building, Contra recomputes how old the upstream leaves are and prepends a `refresh_price_list` instruction at index 1, directly after the compute-budget instruction (the only instruction Scope allows before it), covering every derived entry the reserves touch. If the leaves themselves are older than the reserve's `maxAgePriceSeconds`, the build stops with `MarketClosedError` instead of producing a transaction Kamino would reject.

**A bad fill reverts on-chain.** The open ends with a Lighthouse `AssertTokenAccount` instruction (`packages/short/src/guard.ts`) asserting that the owner's USDC balance is at or above the quoted minimum after the deposit and the sale. A normal open passes it, with Lighthouse a real participant in the transaction. An impossible bound reverts the whole message with Lighthouse's own custom error `6001` before any state changes. `packages/short/check-guard.mjs` reruns both: the guarded open simulates with `err: null` and Lighthouse's program log present, and the impossible-bound run reverts with `Custom: 6001` attributed to the Lighthouse program.

**Market-hours gate.** `/api/open` reads the ticker's own Pyth `Equity.US.<TICKER>/USD` feed and returns 409 `MarketClosedError` while that market is closed, before any Kamino or Jupiter call. `apps/web/check-open-gate.mjs` reads Hermes independently and asserts the route agrees ticker by ticker. Closing is not gated by market hours.

**Only what Kamino will actually lend.** The ticket and blotter read `/api/reserves`, which computes `borrowable` from each reserve's deployed `borrowLimit` and available liquidity. Today that is SPYx, QQQx, TSLAx and NVDAx; the other six read `borrow limit 0 on Kamino` straight from reserve config. A blocked ticker is not selectable, and the reason is printed beside it. The borrow-factor column comes from Kamino's per-pair factor (`market.getMaxAndLiquidationLtvAndBorrowFactorForPair`), the multiplier applied to a borrow's value when it counts against LTV.

**Pyth fair value against Jupiter.** In the ticket and on the positions page, `/api/pyth` reads Hermes' live `Equity.US.<TICKER>/USD` price and compares it to a live Jupiter sell quote for the same ticker, showing the gap in basis points. The line is live for TSLAx and QQQx, the two tickers with a Hermes price feed wired in. Every other xStock shows no figure rather than an estimated one.

**Hedge my holdings.** `/hedge?wallet=<address>` reads a wallet's xStock token accounts directly (`getParsedTokenAccountsByOwner`, Token-2022 program), then proposes shorting half of its largest borrowable holding at Kamino's live max LTV, capped by the borrow capacity the reserve has left. `/api/hedge` returns the same holdings and suggestion as JSON. `apps/web/check-hedge.mjs` reads the wallet's raw SPYx balance straight from the RPC and asserts that the API's number and the proposed borrow size both come from it.

**Live positions with dual marks.** `/positions?owner=<address>` reads the owner's Kamino obligation on the xStocks market and shows, per open short: the borrowed amount (raw-mint units and the Token-2022 scaled-UI amount a wallet displays), two independent live marks (Kamino's Scope-oracle value, which drives LTV and liquidation, and a live Jupiter sell quote, what the market pays right now) and the gap between them, LTV against liquidation LTV, the liquidation price, interest accrued on the borrow, the time of the last on-chain borrow or repay, and the Pyth fair-value line for TSLAx and QQQx. `apps/web/check-positions.mjs` decodes the owner's obligation account with klend-sdk's own layout and asserts the API's borrow amount matches, then asserts that a freshly generated owner gets the named empty state.

**Autonomous short agent.** `/agent` runs one tick of a decision loop on live data and prints every step as observed, decision, reason: it reads the Kamino reserves, checks the Pyth market state, measures the Pyth-versus-Jupiter gap for each borrowable ticker, drops any ticker 150 bps or more off fair value, and picks the one with the most live borrow capacity. Given a wallet address, it hands back one unsigned open transaction for that wallet to sign. `/api/agent` returns the same decision log as JSON. The agent holds no key and signs nothing.

## Why it is hard

- **Four programs, one message.** Compute Budget, Scope, Kamino klend, Jupiter and Lighthouse instructions share a single v0 message. Scope requires its refresh immediately after the compute-budget instruction, allows one refresh per transaction, and every reserve in the transaction has to share one Scope feed. The builder enforces all three.
- **Oracle freshness is a property of the leaves.** A derived Scope entry can be recomputed by anyone; a Chainlink or Pyth Lazer leaf only moves when its provider posts a report. The builder walks the chain post-order and checks leaf age per reserve, so it refuses early instead of failing on-chain.
- **Token-2022 scaled-UI amounts.** xStock mints carry a `scaledUiAmountConfig` multiplier. Contra reads it from the parsed mint and prices one displayed share, so the positions page and the fair-value line agree with what a wallet shows.
- **The checkers cannot share the builder's blind spots.** Every proof is checked by a script that never imports the code that built the transaction.

## Evidence

Two mainnet `simulateTransaction` runs, each checked by a script that re-decodes the raw account bytes with klend-sdk's on-chain layout instead of importing the builder:

| | Open (`packages/short/check.mjs`) | Close (`packages/short/check-close.mjs`) |
|---|---|---|
| Request | deposit 0.5 USDC, borrow 0.001 SPYx | repay 0.01 SPYx, withdraw 5 USDC |
| Route | Whirlpool | measured against a live Jupiter quote |
| Post-conditions checked | obligation USDC deposit increases; obligation SPYx borrow increases by exactly the requested raw amount; the owner's xStock account nets to ~0 (borrowed then sold in the same transaction); the owner's USDC delta matches collateral-out plus sale proceeds within 3% | borrow decreases by the repaid amount after accruing interest to the post-refresh rate; USDC collateral decreases by the withdrawn amount at the post-refresh exchange rate; the xStock account nets to a bounded surplus, never negative; USDC delta matches withdrawn minus buy-back cost |
| Result, rerun 2026-09-25 | `GREEN: all post-conditions held` (`simulation returned err: null`) | `GREEN: all post-conditions held` on the artifact in the repo |

The open run is a live rerun of `npx tsx src/simulate.ts` followed by `node check.mjs`: five `PASS` lines, as recorded in `packages/short/artifacts/sim-open.json`.

Every check has a red counterpart in `packages/short/artifacts/`, which is what makes each `GREEN` mean something:

| Artifact | Request | Result |
|---|---|---|
| `sim-open-red.json` | borrow 1 whole TSLAx | reverts with klend custom error 6009 (`ReserveStale`); `check.mjs` reports `RED` |
| `sim-close-red.json` | withdraw $4,000 of USDC collateral against a 0.01 SPYx repay | reverts with custom error 6011 (`WithdrawTooLarge`); `check-close.mjs` reports `RED` |
| `sim-guard-pass.json` | normal open with the Lighthouse bound | `err: null`, `Program L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95 invoke` in the logs |
| `sim-guard-fail.json` | impossible USDC bound | `Custom: 6001`, the failure attributed to the Lighthouse program in the logs |

`check-web.mjs` builds the Next.js app, boots it, and asserts against live routes: `/api/reserves` returns exactly the borrowable set, the home page states the live "N of M xStocks can be shorted" figure and the US market open or closed state, and `/api/open` returns a transaction that invokes both the Kamino program and Jupiter's router. `apps/web/check-open-gate.mjs`, `check-hedge.mjs`, `check-positions.mjs` and `check-pyth.mjs` each re-read the relevant state directly (Hermes, raw token accounts, a raw obligation decode) instead of trusting the app's own arithmetic. Walkthrough: [docs/how-to/run-the-mainnet-proofs.md](docs/how-to/run-the-mainnet-proofs.md).

## How it works

```
wallet --POST /api/open--> apps/web --buildOpenShort--> packages/short
                                                          |  load Kamino xStocks market, read reserves
                                                          |  walk Scope chain, build refresh_price_list
                                                          |  quote + swap-instructions from Jupiter
                                                          |  compile v0 message with the market lookup table
                                                          |  append Lighthouse AssertTokenAccount
wallet <--unsigned base64 v0 transaction-----------------+
wallet signs (Wallet Standard), sends, confirms
```

- `packages/short` is the protocol layer. It returns unsigned transactions and never touches a key.
- `apps/web` is the Next.js interface: the ticket, the blotter, `/positions`, `/hedge`, `/agent`, `/pitch`, `/docs`, and the API routes. The browser signs through the Wallet Standard.
- Components, sequence diagrams and the byte-budget argument: [ARCHITECTURE.md](ARCHITECTURE.md).
- Security model, what each guard guarantees: [docs/explanation/security-model.md](docs/explanation/security-model.md).

## Run it

```
pnpm install
pnpm --filter @contra/web dev            # web app on :3000
cd packages/short
npx tsx src/reserves.ts                  # print live reserve facts
npx tsx src/simulate.ts                  # build + simulate an open short, write artifacts/sim-open.json
node check.mjs                           # independently verify the artifact
npx tsx src/simulate-close.ts && node check-close.mjs
npx tsx src/simulate-guard.ts pass && npx tsx src/simulate-guard.ts fail && node check-guard.mjs
cd ../../apps/web
node check-open-gate.mjs                 # /api/open agrees with Hermes market hours, ticker by ticker
node check-hedge.mjs                     # independent hedge check, builds and boots the app
node check-positions.mjs                 # on-chain decode vs API vs page, builds and boots the app
```

Environment: `SOLANA_RPC_URL` (or `RPC_URL`) selects the Solana RPC endpoint. `PYTH_API_KEY`, placed in `.env`, turns on the live Hermes price behind the fair-value line.

## Built on / tracks

**Pyth.** The live `Equity.US.<TICKER>/USD` Hermes feed gates every open on market-open state before a transaction is built, and supplies the fair-value line against Jupiter's price, in addition to Kamino's own Scope oracle.

**Composed programs.** Kamino klend and the xStocks Market, Scope, Jupiter, Lighthouse, Token-2022, Compute Budget and the Associated Token Account program. Contra deploys no program of its own: the transaction is the protocol.
