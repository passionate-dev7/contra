# Addresses

All mainnet. "Live read" rows were read on 2026-09-25 between 06:24 and 06:26 UTC.

## Programs

| Name | Address | Source |
|---|---|---|
| Kamino klend | `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` | `packages/short/src/constants.ts:3`; executable, owner `BPFLoaderUpgradeab1e11111111111111111111111` (live read, `getMultipleAccounts` at slot 450270932) |
| Scope | `HFn8GnPADiny6XqUoWE8uRPPxb29ikn4yTuPa9MF2fWJ` | top-level invoke at index 1 in `packages/short/artifacts/sim-guard-pass.json`; executable (same live read) |
| Jupiter v6 router | `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` | `check-web.mjs:7`; invoke at index 10 in `sim-guard-pass.json`; executable (same live read) |
| Lighthouse | `L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95` | `packages/short/src/guard.ts:4`; executable (same live read) |
| Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | `packages/short/src/constants.ts:5` |
| Associated Token Account | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | invoke at index 2 in `sim-guard-pass.json` |
| ComputeBudget | `ComputeBudget111111111111111111111111111111` | invoke at index 0 in `sim-guard-pass.json` |

## Market, lookup table, oracle feed

| Name | Address | Source |
|---|---|---|
| Kamino xStocks market | `5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua` | `packages/short/src/constants.ts:2`; owner klend (live read) |
| xStocks market lookup table | `8ofreL6hKfEet1DnhHVGvCTnSdz4pg85PpbuCUHnEcKm` | `packages/short/src/constants.ts:8`; owner `AddressLookupTab1e1111111111111111111111111`, 3096 bytes = 95 entries (live read) |
| Scope price feed for every reserve | `3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH` | `reserve.state.config.tokenInfo.scopeConfiguration.priceFeed` for all 13 reserves (live read via klend-sdk) |

## Reserves and mints

Live read via klend-sdk `loadMarket()`. `maxAge` is `tokenInfo.maxAgePriceSeconds`.

| Symbol | Mint | Reserve | maxAge (s) |
|---|---|---|---|
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | `97zoywd8mPZsGTg8q1wdD2Wgkdrs2tqusp1Qqcxbyj7E` | 180 |
| SPYx | `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` | `UvXjBuC7YZYaGB9Rn1PpBD1GySmjzunXgE8Zev9ua8d` | 300 |
| QQQx | `Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ` | `2jerdAXR8r2B6z3P7P6VgSiePQX7wqcpbEqdDbm8mgeB` | 300 |
| TSLAx | `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` | `5iTiczqgUegqA3PpoNpotizMbY9n1sRWr3oL6igKvWuf` | 300 |
| NVDAx | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` | `7B66Az3tJhAo4bLkX8PzTixQ9ZGyHkkjxfVLhF26sP5q` | 300 |
| HOODx | `XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg` | `4UBJu5Xp1aziV9frBQBhc1RnKrgXHAWHYejQytkYr8gq` | 300 |
| GOOGLx | `XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN` | `4wg6rEkGgHaEuxMduP46C1xFZ24Lnp5YgdNkZAHxFzsN` | 300 |
| CRCLx | `XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1` | `57qagnQFuWw1seEqi6Z5JBvkm5xH5svdmq9dtqxG1rYy` | 300 |
| METAx | `Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu` | `AJPrye7NZGex2rUZhRwiAPJYxai1Ptb7DNWR3yYjtk3G` | 300 |
| AAPLx | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` | `CKJbqakbPGyhziowm19LPYz636UszuezfkitmpRtcLSH` | 300 |
| MSTRx | `XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ` | `Cwy2WJoswCMyfPtWTrmiaDLXC3phz3qwr1TaT4kaSAyD` | 300 |
| cbBTC | `cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij` | `5AWpVYJvNASoUM8toSDQRcVyA9dvoUuFj5qNx9v32bjj` | 120 |
| USDG | `2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH` | `F1xMZ8em6SrQkCnKQR1pzcxQieSUth35sYDQ2kK6o8tX` | 180 |

`USDC_MINT` is also pinned in `packages/short/src/constants.ts:4`. The code finds xStock reserves by symbol at runtime (`findXstockReserve`) and does not pin their mints or reserve addresses.

## Pyth feed ids

| Feed | Id | Source |
|---|---|---|
| `Equity.US.TSLA/USD` | `16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1` | `apps/web/src/lib/pyth-fair.ts:16` |
| `Equity.US.QQQ/USD` | `9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d` | `apps/web/src/lib/pyth-fair.ts:20` |

Other tickers are resolved at runtime by symbol through Hermes `/v2/price_feeds` (`packages/short/src/pyth.ts:52`).

## Off-chain endpoints

| Name | URL | Source |
|---|---|---|
| Jupiter quote | `https://lite-api.jup.ag/swap/v1/quote` | `packages/short/src/constants.ts:14` |
| Jupiter swap instructions | `https://lite-api.jup.ag/swap/v1/swap-instructions` | `packages/short/src/constants.ts:15` |
| Pyth Hermes | `https://hermes.pyth.network` | `packages/short/src/constants.ts:17` |
| Kamino reserve metrics | `https://api.kamino.finance/kamino-market/<market>/reserves/metrics` | `packages/short/src/constants.ts:10` (exported, unused) |
| Default RPC | `https://api.mainnet-beta.solana.com` | `packages/short/src/rpc.ts:4` |

## Proof owners

Wallets the proof scripts simulate against. They are real accounts found by scanning the market, not Contra accounts.

| Used by | Address |
|---|---|
| `simulate.ts`, `simulate-guard.ts`, `check-web.mjs` | `sadmBTQm5HJsyzWHEjV4YwG9CiahZKVDVqAyS4Wx1zH` |
| `simulate-close.ts`, `apps/web/check-positions.mjs` | `DK7iCr4uSjKQF7qYTnygrrZuAc2hFNaKPrYDV2UKikWC` |
| `apps/web/check-hedge.mjs` | `DrAR2ZNC5KYZps7NJyYHfzeZTaqbMUaGM3CBUWfpbCUs` |
