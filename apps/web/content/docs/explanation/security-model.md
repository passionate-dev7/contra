# Security model

Contra is a transaction builder. It holds no keys, no funds and no state, and every guard it adds runs either before the transaction is built or on-chain inside the transaction itself. This page states what each part guarantees.

## What Contra holds: nothing

- **No keys.** Kamino actions are built with `readOnlySigner(owner)`, whose `signTransactions` throws (`packages/short/src/kit.ts:37`). The API routes return unsigned base64 transactions. The browser signs through the Wallet Standard `solana:signAndSendTransaction` feature (`apps/web/src/lib/wallet.ts:35`).
- **No program.** Contra deploys nothing, so there is no Contra upgrade authority, no Contra vault, and no Contra account holding user funds.
- **No state.** No database, no indexer. Every view is a live RPC, Hermes, or Jupiter read.

After a short is open, the position is an ordinary Kamino obligation owned by the user's wallet. It can be managed or closed through Kamino's own interface without Contra.

## What each component guarantees

| Component | Guarantees | Pinned where |
|---|---|---|
| Kamino klend `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` | holds collateral, lends the xStock, enforces LTV and liquidation | `packages/short/src/constants.ts:3` |
| Scope `HFn8GnPADiny6XqUoWE8uRPPxb29ikn4yTuPa9MF2fWJ` | the price klend checks on-chain | resolved by `@kamino-finance/scope-sdk` (version pinned at `10.2.6` in `packages/short/package.json`) |
| Jupiter router `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` and the AMMs it routes through | executes the sell and the buy-back at the quoted route | returned by `lite-api.jup.ag/swap/v1/swap-instructions` |
| Lighthouse `L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95` | enforces the USDC balance postcondition on open, inside the transaction | `packages/short/src/guard.ts:4` |
| `@kamino-finance/klend-sdk` | builds the Kamino instructions, which the checkers re-decode with the same layouts | `^12.0.0` in `packages/short/package.json` |
| Your RPC | account reads and the blockhash | `SOLANA_RPC_URL` / `RPC_URL` |

Jupiter's swap instructions go into the message exactly as the router returns them (`packages/short/src/jupiter.ts`), and the outcome is enforced on-chain: the Lighthouse postcondition checks the owner's USDC balance after every instruction has run, whichever AMMs the route crosses. The wallet's own simulation preview shows the final message before anything is signed.

## Borrowable set, read live

Kamino decides which xStocks can be borrowed, and Contra reads that decision from the chain on every request. A reserve is offered only when `borrowLimit > 0`, `borrowLimit - borrowed > 0`, and available liquidity is above zero (`apps/web/src/lib/reserves.ts:61`). A blocked ticker is not selectable and shows the reason beside it.

Read with `npx tsx src/reserves.ts` in `packages/short` on 2026-09-25 06:24 UTC:

| xStock | Borrow limit | Borrowed | Borrowable |
|---|---|---|---|
| SPYx | 5000 | 125.2222 | yes |
| QQQx | 1000 | 61.8953 | yes |
| TSLAx | 2500 | 12.6514 | yes |
| NVDAx | 500 | 43.3960 | yes |
| HOODx, GOOGLx, CRCLx, METAx, AAPLx, MSTRx | 0 | 0 | `borrow limit 0 on Kamino` |

Units are UI tokens of each xStock (raw mint units / 10^decimals). Rerun the command for current values.

## Liquidation transparency

A short is a borrow of the xStock against USDC collateral. If the xStock's Scope price rises, the weighted LTV rises: `borrowValue * borrowFactor / collateralValue`. Past the pair's liquidation LTV the obligation is liquidatable under Kamino's rules. Contra shows every input to that arithmetic before and after the short opens:

- The ticket computes live LTV and the liquidation price from the pair's borrow factor and liquidation LTV, and blocks an open whose computed LTV is above the pair's max LTV.
- `/positions` shows LTV against liquidation LTV, the liquidation price per short, and turns the health banner red within 5 LTV points of liquidation.

Read on 2026-09-25 06:24 UTC, per-reserve config for the four borrowable xStocks: borrow factor 166% for SPYx and QQQx, 225% for TSLAx and NVDAx. USDC collateral: max LTV 80%, liquidation LTV 90%. The ticket and `/api/reserves` use the pair values from `market.getMaxAndLiquidationLtvAndBorrowFactorForPair(usdc, xstock)`; rerun `/api/reserves` for the live pair values.

## What the Lighthouse guard enforces

On open, the last instruction asserts `usdcAta.amount >= preUsdc - collateral + quote.otherAmountThreshold` (`packages/short/src/build.ts`). On-chain, before anything is committed, it catches:

- a Jupiter sell that returns less than the quoted minimum out
- USDC leaving the owner's USDC ATA through any instruction in the same transaction beyond the deposited collateral
- proceeds landing somewhere other than that ATA

The bound comes from the owner's USDC balance at build time and Jupiter's post-slippage minimum out. The ticket shows the floor as your size less the 1% slippage allowance, and the instruction carries the exact figure computed at build time. When a wide route forces the open to split, the guard rides in the transaction that performs the sale.

`packages/short/check-guard.mjs` proves the guard can fire: the impossible-bound run reverts with Lighthouse `Custom: 6001`. See [run-the-mainnet-proofs](../how-to/run-the-mainnet-proofs.md#lighthouse-guard).

## Oracle staleness

If a Scope leaf is older than the reserve's `maxAgePriceSeconds`, the builder throws `MarketClosedError` instead of producing a transaction klend would reject with 6009. See [oracle-and-pricing](oracle-and-pricing.md#the-scope-chain-walk). On top of that, `/api/open` and the ticket gate opens on the ticker's own Pyth market-hours state.

## Ordered transactions

When a message exceeds 1232 bytes the builder emits two transactions in a fixed order, and the web client sends the second only after the first is `confirmed`. See [transaction-anatomy](transaction-anatomy.md#the-1232-byte-limit-and-the-two-transaction-fallback) for the contents of each half.

## Public endpoints, unsigned output

`/api/open` and `/api/close` accept any `owner` and return only unsigned transactions, so the owner's own wallet is always the signer and the only party that can move funds.