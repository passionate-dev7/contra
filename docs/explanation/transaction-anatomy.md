# Transaction anatomy

Contra has no program of its own, so the transaction is the protocol. This page describes the instructions `buildOpenShort` and `buildCloseShort` put in the message, which program owns each one, and why they are in that order.

## Open short, single transaction

Instruction order, as assembled in `packages/short/src/build.ts:156` and appended to at `build.ts:174`:

```
lead         = [ComputeBudget setComputeUnitLimit(1_400_000), Scope refresh_price_list?]
kaminoIxs    = KaminoAction.buildDepositAndBorrowTxns(...) -> actionToIxs
swap         = Jupiter setupInstructions..., swapInstruction, cleanupInstruction?
guard        = Lighthouse AssertTokenAccount(usdcAta, amount >= minUsdcAfter)
message      = lead + kaminoIxs + swap + guard
```

What that produced in a live build. The first column is the top-level index in `packages/short/artifacts/sim-guard-pass.json` (`logs`, lines containing `invoke [1]` and the following `Instruction:` log). A build run on 2026-09-25 06:25 UTC for the same owner and size produced the same program sequence (1024 bytes, route `Byreal`).

| # | Program | Instruction | Comes from |
|---|---|---|---|
| 0 | `ComputeBudget111111111111111111111111111111` | SetComputeUnitLimit 1,400,000 | `build.ts:123` |
| 1 | `HFn8GnPADiny6XqUoWE8uRPPxb29ikn4yTuPa9MF2fWJ` (Scope) | RefreshPriceList | `scope.ts:110`, omitted when no derived entry needs it |
| 2 | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | create ATA | klend-sdk, `includeAtaIxs: true` |
| 3 | `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` | RefreshReserve | klend-sdk |
| 4 | klend | RefreshObligation | klend-sdk |
| 5 | klend | DepositReserveLiquidityAndObligationCollateralV2 | klend-sdk (`useV2Ixs: true`) |
| 6 | klend | RefreshReserve | klend-sdk |
| 7 | klend | RefreshReserve | klend-sdk |
| 8 | klend | RefreshObligation | klend-sdk |
| 9 | klend | BorrowObligationLiquidityV2 | klend-sdk |
| 10 | `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` | Route (xStock to USDC) | Jupiter `/swap/v1/swap-instructions` |
| 11 | `L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95` (Lighthouse) | AssertTokenAccount | `guard.ts:28` |

The exact klend instruction count depends on the owner. For an owner with no obligation yet, klend-sdk also adds user-metadata and obligation init instructions (`initUserMetadata: { skipInitialization: false }`, `build.ts:141`). For an owner with other positions, klend refreshes every reserve the obligation touches.

Jupiter's response also contains `computeBudgetInstructions` and an optional `tokenLedgerInstruction`. `jupiter.ts:100` drops both: the single compute-budget instruction at index 0 covers the whole message.

## Why this order

- **Compute budget first, Scope second.** Scope's `refresh_price_list` checks that every instruction before it is a ComputeBudget instruction (comment at `scope.ts:21`, citing `handler_refresh_prices.rs check_execution_ctx`). So it must be at index 1. For the same reason only one `refresh_price_list` can be in the transaction. `buildScopeRefresh` throws if the reserves involved use more than one Scope price feed (`scope.ts:54`). All 13 reserves in the market used the same feed, `3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH`, when read on 2026-09-25.
- **Kamino before Jupiter on open.** The sell spends the xStock the borrow just transferred into the owner's ATA.
- **Jupiter before Kamino on close.** The repay spends the xStock the buy-back just delivered (`build.ts:272`).
- **Lighthouse last.** The assertion reads the owner's USDC balance after every other instruction has run.

## The Lighthouse bound

`build.ts:163` reads the owner's USDC ATA balance at build time (0 if the account does not exist) and sets:

```
minUsdcAfter = max(0, preUsdc - usdcCollateral + quote.otherAmountThreshold)
```

`otherAmountThreshold` is Jupiter's post-slippage minimum out for the sell. If the balance at the end of the transaction is lower, Lighthouse fails with custom error 6001 and the whole transaction reverts. See [risk-and-trust](risk-and-trust.md#what-the-lighthouse-guard-catches) for what that does and does not cover.

The instruction data is 12 bytes: `u8 9` (AssertTokenAccount) | `u8 0` (log level silent) | `u8 2` (Amount) | `u64 LE` bound | `u8 4` (greater than or equal). The only account is the USDC ATA, read-only (`guard.ts:32`).

## Close short, single transaction

```
lead      = [ComputeBudget setComputeUnitLimit(1_400_000), Scope refresh_price_list?]
swap      = Jupiter setup..., swap (USDC to xStock, ExactIn, maxAccounts 20), cleanup?
kaminoIxs = KaminoAction.buildRepayAndWithdrawTxns(...) -> actionToIxs
message   = lead + swap + kaminoIxs
```

There is no Lighthouse instruction on the close.

## Address lookup tables

Every message compiles against:

1. Kamino's published lookup table for the xStocks market, `8ofreL6hKfEet1DnhHVGvCTnSdz4pg85PpbuCUHnEcKm` (`constants.ts:8`). Read on 2026-09-25 at slot 450270932: owner `AddressLookupTab1e1111111111111111111111111`, 3096 bytes of data, which is a 56-byte header plus 95 addresses of 32 bytes.
2. Whatever tables Jupiter's `addressLookupTableAddresses` names for that route.

`resolveLookupTables` skips any table the RPC cannot find instead of failing (`build.ts:93`).

## The 1232-byte limit and the two-transaction fallback

A Solana transaction is at most 1232 bytes on the wire. The builder compiles the combined message and measures `tx.serialize().length`. If serialization throws (web3.js overruns its fixed buffer before it can report a length), it treats that as "does not fit" (`build.ts:85`).

If it fits, `BuiltShort.transaction` is the only transaction and `reason` records the byte count. If not:

| | `transaction` (send first) | `secondTransaction` (send after the first confirms) |
|---|---|---|
| Open | compute budget, Scope refresh, Kamino deposit + borrow | compute budget, Jupiter sell, Lighthouse guard |
| Close | compute budget, Jupiter buy-back | compute budget, Scope refresh, Kamino repay + withdraw |

In the split case the two halves are not atomic. On an open, if tx1 lands and tx2 fails, the owner holds a Kamino borrow and the unsold xStock. On a close, if tx1 lands and tx2 fails, the owner holds the bought xStock and the borrow is still open. The web client sends tx2 only after tx1 is `confirmed` (`apps/web/src/lib/wallet.ts:55`).

Measured sizes recorded in code: a Byreal route pushed the close over 1232 bytes and a Riptide route fit at 1165 (`build.ts:25`). That is why the close quote passes `maxAccounts: 20`. The open quote passes no `maxAccounts`. The 2026-09-25 06:25 UTC open build above was 1024 bytes on a Byreal route.

## Account owners at a glance

| Account | Owner program |
|---|---|
| xStocks market, reserves, obligation, user metadata | Kamino klend |
| Scope price feed, oracle mappings, configuration | Scope |
| Owner's USDC ATA | SPL Token |
| Owner's xStock ATA | Token-2022 (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`) |
| Swap pool accounts | whichever AMM Jupiter routes through |
| Lookup tables | Address Lookup Table program |

Lighthouse owns no account in the transaction. It only reads the USDC ATA.
