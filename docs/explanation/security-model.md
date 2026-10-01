# Risk and trust

## What Contra holds: nothing

- **No keys.** Kamino actions are built with `readOnlySigner(owner)`, whose `signTransactions` throws (`packages/short/src/kit.ts:37`). The API routes return unsigned base64 transactions. The browser signs through the Wallet Standard `solana:signAndSendTransaction` feature (`apps/web/src/lib/wallet.ts:35`).
- **No program.** Contra deploys nothing, so there is no Contra upgrade authority, no Contra vault, and no Contra account holding user funds.
- **No state.** No database, no indexer. Every view is a live RPC, Hermes, or Jupiter read.

After a short is open, the position is an ordinary Kamino obligation owned by the user's wallet. It can be managed or closed through Kamino's own interface without Contra.

## What you are trusting

| Component | Trusted for | Pinned where |
|---|---|---|
| Kamino klend `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` | holding collateral, lending the xStock, liquidation | `packages/short/src/constants.ts:3` |
| Scope `HFn8GnPADiny6XqUoWE8uRPPxb29ikn4yTuPa9MF2fWJ` | the price klend uses | resolved by `@kamino-finance/scope-sdk` (version pinned at `10.2.6` in `packages/short/package.json`) |
| Jupiter router `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` and the AMMs it routes through | executing the sell and the buy-back | returned by `lite-api.jup.ag/swap/v1/swap-instructions`, not pinned in `packages/short` |
| Lighthouse `L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95` | enforcing the USDC balance postcondition on open | `packages/short/src/guard.ts:4` |
| `@kamino-finance/klend-sdk` | building correct Kamino instructions | `^12.0.0` in `packages/short/package.json` |
| Jupiter's HTTP API | returning instructions that match the quote | `packages/short/src/constants.ts:14` |
| Your RPC | honest account reads, and the blockhash | `SOLANA_RPC_URL` / `RPC_URL` |

Jupiter's swap instructions arrive over HTTP and are placed into the message as-is (`jupiter.ts:40`). Contra does not check which program they call. The Lighthouse guard is the on-chain backstop for the open. The wallet's own simulation preview is the other check.

## Borrow caps

Kamino, not Contra, decides which xStocks can be borrowed. A reserve is borrowable in Contra only when `borrowLimit > 0`, `borrowLimit - borrowed > 0`, and available liquidity is above zero (`apps/web/src/lib/reserves.ts:61`).

Read with `npx tsx src/reserves.ts` in `packages/short` on 2026-09-25 06:24 UTC:

| xStock | Borrow limit | Borrowed | Borrowable |
|---|---|---|---|
| SPYx | 5000 | 125.2222 | yes |
| QQQx | 1000 | 61.8953 | yes |
| TSLAx | 2500 | 12.6514 | yes |
| NVDAx | 500 | 43.3960 | yes |
| HOODx, GOOGLx, CRCLx, METAx, AAPLx, MSTRx | 0 | 0 | no, `borrow limit 0 on Kamino` |

Units are UI tokens of each xStock (raw mint units / 10^decimals). These change whenever Kamino changes reserve config or users borrow. Rerun the command for current values.

## Liquidation

A short is a borrow of the xStock against USDC collateral. If the xStock's Scope price rises, the weighted LTV rises: `borrowValue * borrowFactor / collateralValue`. Past the pair's liquidation LTV, anyone can liquidate the obligation on Kamino under Kamino's rules. Contra does not monitor positions, send alerts, or top up collateral.

Read on 2026-09-25 06:24 UTC, per-reserve config for the four borrowable xStocks: borrow factor 166% for SPYx and QQQx, 225% for TSLAx and NVDAx. USDC collateral: max LTV 80%, liquidation LTV 90%. The ticket and `/api/reserves` use the pair values from `market.getMaxAndLiquidationLtvAndBorrowFactorForPair(usdc, xstock)`, which can differ from the per-reserve config. Rerun `/api/reserves` for the live pair values.

The ticket blocks an open whose computed LTV is above the pair's max LTV. It does not add any safety margin under that.

## What the Lighthouse guard catches

On open, the last instruction asserts `usdcAta.amount >= preUsdc - collateral + quote.otherAmountThreshold` (`packages/short/src/build.ts:173`). It catches, on-chain, before anything is committed:

- a Jupiter sell that returns less than the quoted minimum out
- USDC leaving the owner's USDC ATA through any instruction in the same transaction beyond the deposited collateral
- proceeds landing somewhere other than that ATA

It does not catch:

- **Anything on close.** `buildCloseShort` adds no Lighthouse instruction. The close relies on Jupiter's own slippage check and klend's repay and withdraw checks. The pre-trade guards are off-chain only: the quote must cover the repay and must be under `maxUsdcIn`.
- **Balance changes between build and landing.** `preUsdc` is read when the transaction is built. If the USDC balance drops before it lands (another transaction spends USDC), the bound can fail an honest trade. If the balance rises, the bound becomes loose by that amount.
- **A missing USDC ATA at build time.** `preUsdc` falls back to 0 on any read error (`build.ts:168`), which makes the bound `quote.otherAmountThreshold - collateral`, floored at 0.
- **The xStock side.** Nothing asserts the xStock ATA or the obligation. klend's own checks cover the borrow.
- **The split case's first transaction.** When the open splits, the guard is in tx2. tx1 (deposit and borrow) has no postcondition.
- **Price quality.** Selling at a poor price that is still within 100 bps of Jupiter's quote passes. The Pyth line shows the gap to fair value but does not block anything.

The web ticket's guard text shows `size * 0.99`. That is a display approximation of the bound, not the value in the instruction (`apps/web/src/components/Ticket.tsx:216`).

## Oracle staleness

If a Scope leaf is older than the reserve's `maxAgePriceSeconds`, the builder throws `MarketClosedError` instead of producing a transaction klend would reject with 6009. See [oracle-and-pricing](oracle-and-pricing.md#the-scope-chain-walk). The builder does not check Pyth market hours; only the web ticket does.

## Non-atomic splits

When a message exceeds 1232 bytes the result is two transactions, and they are not atomic. See [transaction-anatomy](transaction-anatomy.md#the-1232-byte-limit-and-the-two-transaction-fallback) for what state each half leaves behind if the second fails.

## Not verified by this repo

- No signed mainnet transaction from Contra is recorded here. All evidence is `simulateTransaction`.
- The HTTP routes have no authentication or rate limiting, and `/api/open` and `/api/close` accept any `owner`. They only return unsigned transactions, so the owner's wallet still has to sign.
- The site footer says "Non-US use only" (`apps/web/src/app/page.tsx`). Nothing in the code enforces it.
