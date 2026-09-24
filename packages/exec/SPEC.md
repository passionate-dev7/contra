# @fineprint/exec implementation spec

TypeScript ESM. Node 24, "type": "module". Deps already installed: @solana/web3.js v1,
@solana/spl-token 0.4.x, vitest, typescript. Import shared types with `import type` from
"@fineprint/core" (tsconfig path + vitest alias map it to ../core/src/types.ts; it is
types-only so it must never be a runtime import).

Every number below was MEASURED against mainnet, do not re-derive or "correct" them.

## Measured ground truth (2026-09-20, slot ~448717230, epoch 1038)

- PreStocks mints are Token-2022 (TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb).
  SPACEX PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh
  OPENAI PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF
  ANTHROPIC Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw
- transferFeeConfig holds TWO tiers: olderTransferFee {epoch 1032, 50 bps} and
  newerTransferFee {epoch 1039, 100 bps}. Current epoch is 1038. THE FEE IN FORCE TODAY IS
  50 BPS, NOT 100. The newer tier only applies once currentEpoch >= newerTransferFee.epoch.
  Selecting the tier by epoch is mandatory. Hardcoding 100 is wrong today; hardcoding 50 is
  wrong from epoch 1039.
- maximumFee is u64 max (18446744073709551615) = uncapped, but the cap must still be applied
  in the arithmetic because the issuer can lower it.
- Token-2022 charges the fee on the DESTINATION account: after a transfer the destination's
  `amount` grows by the NET and the account's TransferFeeAmount extension `withheldAmount`
  grows by the fee. So net + withheldDelta == gross, exactly.
- Jupiter quote `outAmount` semantics DEPEND ON THE TERMINAL AMM and cannot be assumed:
  route ending in "Manifest" quoted GROSS (ANTHROPIC quoteOut 105363629 == simulated gross
  105363629, simulated net 104836810, withheld 526819);
  route ending in "Meteora DLMM" quoted NET (SPACEX quoteOut 44305083 == simulated net
  44305083, simulated gross 44527722, withheld 222639).
  Therefore the package MUST determine gross-vs-net empirically by simulating, never assume.

## Modules

### src/fee.ts  (pure, no I/O, all bigint)

```ts
export interface FeeTier { epoch: number; transferFeeBasisPoints: number; maximumFee: bigint }
export function inForceTier(older: FeeTier, newer: FeeTier, currentEpoch: number): FeeTier
export function transferFeeOf(gross: bigint, bps: number, maximumFee: bigint): bigint
export function netAfterTransferFee(gross: bigint, bps: number, maximumFee: bigint): bigint
export function grossForNet(net: bigint, bps: number, maximumFee: bigint): bigint
export function roundTripBps(bps: number): number
```

- `inForceTier`: return newer when currentEpoch >= newer.epoch, else older. Throw on
  currentEpoch < older.epoch (impossible state, do not silently pick one).
- `transferFeeOf`: Token-2022 rounds the fee UP. fee = ceil(gross * bps / 10000) =
  (gross * bps + 9999n) / 10000n, then clamp to maximumFee. bps 0 -> 0. bps 10000 -> gross.
  Validate 0 <= bps <= 10000 and gross >= 0, throw RangeError otherwise.
- `netAfterTransferFee` = gross - transferFeeOf(gross, ...).
- `grossForNet`: smallest gross g such that netAfterTransferFee(g) >= net. Start from
  ceil(net * 10000 / (10000 - bps)) then walk up while netAfterTransferFee(g) < net and
  down while netAfterTransferFee(g - 1n) >= net, so it is exact, not approximate. When the
  fee is capped the linear inverse is wrong, so the walk matters. bps 10000 -> throw.
- `roundTripBps(bps)`: the compounded two-leg cost in bps =
  round((1 - (1 - bps/10000)^2) * 10000). For 50 -> 100 (99.75 rounds to 100), for 100 -> 199.

### src/mint.ts

```ts
export interface ExecMintFacts {
  mint: string; decimals: number; ownerProgram: string;
  inForceBps: number; inForceMaximumFee: bigint; currentEpoch: number;
  tiers: { older: FeeTier; newer: FeeTier };
  paused: boolean; pausableAuthority: string | null;
  permanentDelegate: string | null;
  transferHookProgramId: string | null;
  defaultAccountState: string | null;
  slot: number;
}
export async function readExecMintFacts(conn: Connection, mint: string): Promise<ExecMintFacts>
export function execFactsFromMintFacts(f: MintFacts, currentEpoch: number): ExecMintFacts
```

- Read with `getAccountInfo(mint, {commitment:"finalized"})`, unpack with spl-token
  `unpackMint(pubkey, info, TOKEN_2022_PROGRAM_ID)` and the extension getters
  (`getTransferFeeConfig`, `getPausableConfig`, `getPermanentDelegate`, `getTransferHook`,
  `getDefaultAccountState`). If the mint is not owned by TOKEN_2022_PROGRAM_ID throw
  `NotToken2022Error`. If there is no transferFeeConfig throw `NoTransferFeeConfigError`.
  Get the epoch from `conn.getEpochInfo()`.
- `execFactsFromMintFacts` adapts a core `MintFacts` (whose transferFee.current/.previous are
  TransferFeeTier with string maximumFee) so a caller that already decoded the mint does not
  pay for a second RPC. previous === null -> use current as both tiers.
- Getter names/shapes in @solana/spl-token 0.4.x must be verified against node_modules, not
  guessed. `getPausableConfig` may be exported as `getPausableConfig`; if the extension
  helper does not exist in this version, decode the tlv via the exported `getExtensionData`
  + `ExtensionType.Pausable` and read the single boolean byte. Do not invent an API.

### src/jupiter.ts

`QUOTE_URL = https://lite-api.jup.ag/swap/v1/quote`, `SWAP_URL = https://lite-api.jup.ag/swap/v1/swap`.
`USDC_MINT = EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (6 decimals).

```ts
export interface JupQuote { inputMint, inAmount, outputMint, outAmount, otherAmountThreshold,
  swapMode, slippageBps, priceImpactPct, routePlan: Array<{swapInfo:{label:string,...}}>,
  contextSlot?: number, [k:string]: unknown }
export async function getQuote(p: {inputMint,outputMint,amount:bigint,slippageBps,signal?}): Promise<JupQuote>
export async function getSwapTransaction(p: {quote:JupQuote, userPublicKey:string, signal?}): Promise<{swapTransaction:string, lastValidBlockHeight:number, [k:string]:unknown}>
```
POST body for swap: `{quoteResponse, userPublicKey, wrapAndUnwrapSol:true,
dynamicComputeUnitLimit:true}`. Non-2xx or a body with `error` -> throw `JupiterApiError`
carrying status and body text. 15s AbortController timeout on both calls.
`routeLabel(quote)` helper returns routePlan.map(r=>r.swapInfo.label).join(" -> ").

### src/build.ts

```ts
export interface UnsignedSwap {
  transaction: VersionedTransaction;      // UNSIGNED. signatures array is all zeroes.
  request: SwapRequest;
  facts: ExecMintFacts;
  quote: JupQuote;
  destinationAta: string;
  route: string;
  lastValidBlockHeight: number;
  quoteSemantics: "gross" | "net";        // measured, see below
  expectedGrossRaw: bigint;
  expectedNetRaw: bigint;                 // = netAfterTransferFee(expectedGrossRaw, inForceBps, cap)
  minimumNetRaw: bigint;                  // slippage floor, net of fee
  transferFeeRaw: bigint;
  preNetRaw: bigint;                      // destination ATA amount BEFORE (0 when ATA absent)
  preWithheldRaw: bigint;
  simulation: { err: unknown; unitsConsumed?: number; logs: string[];
                simulatedGrossRaw: bigint; simulatedNetRaw: bigint; simulatedWithheldRaw: bigint };
}
export async function buildUnsignedSwap(conn: Connection, req: SwapRequest,
  opts?: { facts?: ExecMintFacts; simulate?: boolean }): Promise<UnsignedSwap>
```

Order of operations, all of it load-bearing:
1. facts = opts.facts ?? await readExecMintFacts. If `facts.paused` throw `MintPausedError`
   with message naming the mint, the pausable authority and "issuer has halted transfers".
   This happens BEFORE any network call to Jupiter.
2. If `facts.defaultAccountState === "frozen"` and the destination ATA does not exist, throw
   `FrozenByDefaultError`: tokens would land in a frozen account.
3. amount = BigInt(Math.round(req.notionalUsd * 1e6)) USDC in, ExactIn, req.slippageBps.
   Reject notionalUsd <= 0 and slippageBps outside 1..5000.
4. quote, then swap transaction for req.userPublicKey.
5. `VersionedTransaction.deserialize(Buffer.from(swapTransaction,"base64"))`. Assert every
   signature slot is still all-zero (nothing is signed), else throw.
6. destinationAta = getAssociatedTokenAddressSync(mint, userPublicKey, true, TOKEN_2022_PROGRAM_ID).
7. preNetRaw / preWithheldRaw from getAccountInfo(destinationAta, "finalized"): 0/0 if absent,
   else unpackAccount + getTransferFeeAmount(account).withheldAmount.
8. Resolve address lookup tables (`tx.message.addressTableLookups` ->
   `conn.getAddressLookupTable`) and build the full account key list; assert
   TOKEN_2022_PROGRAM_ID appears. NOTE: it is NOT in staticAccountKeys, it is in the LUTs,
   so a naive staticAccountKeys check fails. Also expose `accountKeys(unsigned)` helper.
9. simulate (unless opts.simulate === false):
   `conn.simulateTransaction(tx, {sigVerify:false, replaceRecentBlockhash:true,
   commitment:"confirmed", accounts:{encoding:"base64", addresses:[destinationAta]}})`.
   Decode the returned destination account to simulatedNetRaw/simulatedWithheldRaw; gross =
   net + withheld. Deltas are versus preNetRaw/preWithheldRaw.
   If `sim.value.err` is non-null throw `SimulationFailedError` with err + last 20 log lines.
10. quoteSemantics: compare BigInt(quote.outAmount) against the simulated gross delta and the
    simulated net delta; whichever is closer in absolute terms wins ("gross" on a tie).
    expectedGrossRaw = semantics === "gross" ? BigInt(quote.outAmount)
                                             : grossForNet(BigInt(quote.outAmount), bps, cap).
    When simulation is disabled, default to "gross" and record it.
11. expectedNetRaw = netAfterTransferFee(expectedGrossRaw, bps, cap);
    transferFeeRaw = expectedGrossRaw - expectedNetRaw;
    thresholdGross = semantics === "gross" ? BigInt(quote.otherAmountThreshold)
                                           : grossForNet(BigInt(quote.otherAmountThreshold), bps, cap);
    minimumNetRaw = netAfterTransferFee(thresholdGross, bps, cap).

### src/execute.ts

```ts
export type SignTransaction = (tx: VersionedTransaction) => Promise<VersionedTransaction>;
export interface ExecuteOptions { facts?: ExecMintFacts; toleranceBps?: number;  // default 25
  finalizeTimeoutMs?: number; // default 180_000
  pollIntervalMs?: number;    // default 2_000
  onStatus?: (s: {phase:string; detail?: string}) => void; }
export async function executeSwap(conn, req: SwapRequest, signTransaction: SignTransaction,
  opts?: ExecuteOptions): Promise<SwapResult>
export async function confirmFinalized(conn, signature: string, lastValidBlockHeight: number,
  o?: {timeoutMs?:number; pollIntervalMs?:number; onStatus?}): Promise<{slot:number; err:unknown}>
export function evaluatePostCondition(p: {expectedNetRaw, actualNetRaw, minimumNetRaw,
  grossRaw, withheldDeltaRaw, bps, maximumFee, toleranceBps}): {held:boolean; reasons:string[]}
```

- NO KEYPAIR ANYWHERE. `signTransaction` is the browser wallet adapter's method. The package
  never imports Keypair for signing, never reads a file, never touches process.env for a
  secret. It is a hard review criterion.
- executeSwap: build -> onStatus("built") -> signTransaction(tx) -> assert the returned tx has
  a non-zero signature at index 0 and that its message serializes identically to the built one
  (the wallet must not have mutated the message) -> `conn.sendRawTransaction(signed.serialize(),
  {skipPreflight:false, maxRetries:3, preflightCommitment:"confirmed"})`.
- confirmFinalized: poll `getSignatureStatuses([sig], {searchTransactionHistory:true})` every
  pollIntervalMs until `confirmationStatus === "finalized"`. `processed` and `confirmed` are
  NOT terminal and must not end the loop. If status.err is set, stop and surface it. If
  `conn.getBlockHeight("finalized") > lastValidBlockHeight` and the status is still null, throw
  `TransactionExpiredError`. Throw `FinalizationTimeoutError` on timeout. Never return success
  on a null status.
- After finalization read the destination ATA again at commitment "finalized"; actualNetRaw =
  postAmount - preNetRaw, withheldDeltaRaw = postWithheld - preWithheldRaw,
  grossRaw = actualNetRaw + withheldDeltaRaw.
- evaluatePostCondition, all must hold:
  1. actualNetRaw > 0
  2. withheldDeltaRaw === transferFeeOf(grossRaw, bps, maximumFee)   // exact, no tolerance.
     This is the assertion only a real Token-2022 transfer can produce.
  3. actualNetRaw >= minimumNetRaw                                    // slippage floor, net of fee
  4. abs(actualNetRaw - expectedNetRaw) <= ceil(expectedNetRaw * toleranceBps / 10000)
  Each failed check appends a human sentence to `reasons`.
- Return SwapResult exactly as typed in @fineprint/core: signature, confirmed (true only at
  finalized with err === null), expectedNetDelta and actualNetDelta as Number(raw)/10**decimals,
  postConditionHeld, slot, explorerUrl `https://solscan.io/tx/<sig>`.
- If confirmation fails or the post-condition fails, STILL return a SwapResult with the real
  signature and postConditionHeld:false. Never throw away the signature, never report success.

### src/index.ts
Re-export everything public plus the error classes. Export `RPC_URL` resolution helper
`defaultConnection(commitment = "confirmed")` reading `process.env.RPC_URL ??
"https://api.mainnet-beta.solana.com"`.

### src/errors.ts
`ExecError` base with `code`, subclasses: NotToken2022Error, NoTransferFeeConfigError,
MintPausedError, FrozenByDefaultError, JupiterApiError, SimulationFailedError,
TransactionExpiredError, FinalizationTimeoutError, PostConditionError, WalletMutatedTransactionError.

## Tests (vitest)

test/fee.test.ts  — pure, offline, must pass with no network:
 - hand-computed: transferFeeOf(1_000_000n, 50, MAX) === 5_000n;
   transferFeeOf(1_000_000n, 100, MAX) === 10_000n;
   transferFeeOf(105_363_629n, 50, MAX) === 526_819n  (mainnet-measured ANTHROPIC value);
   netAfterTransferFee(105_363_629n, 50, MAX) === 104_836_810n (mainnet-measured);
   transferFeeOf(44_527_722n, 50, MAX) === 222_639n and net === 44_305_083n (mainnet SPACEX);
   ceiling rounding: transferFeeOf(1n, 50, MAX) === 1n; transferFeeOf(199n, 50, MAX) === 1n;
   transferFeeOf(201n, 50, MAX) === 2n.
 - cap: transferFeeOf(10_000_000n, 100, 1_000n) === 1_000n.
 - grossForNet round trip: for bps in [1,50,100,999] and a spread of nets, assert
   netAfterTransferFee(grossForNet(net,bps,MAX),bps,MAX) >= net and that gross-1 undershoots.
 - inForceTier: epoch 1038 -> 50 bps tier, epoch 1039 -> 100 bps tier, epoch 1040 -> 100.
 - roundTripBps(50) === 100, roundTripBps(100) === 199.

test/mint.test.ts — live mainnet read (getAccountInfo only, no signing):
 - readExecMintFacts for SPACEX: ownerProgram === TOKEN_2022, decimals > 0, tiers.older.bps
   === 50 and tiers.newer.bps === 100, inForceBps matches inForceTier(tiers, currentEpoch),
   paused === false, permanentDelegate non-null, transferHookProgramId === null.
 - paused path: `execFactsFromMintFacts` with a MintFacts whose powers.paused is true, then
   buildUnsignedSwap must reject with MintPausedError and must NOT have called Jupiter
   (assert by timing/flag: pass opts.facts so no RPC is needed, and assert the thrown error
   is MintPausedError).

test/build.test.ts — live mainnet, no key, generous timeouts (120s), and it must skip with a
 clear message (not a silent pass) if the RPC or Jupiter is unreachable:
 - build an unsigned swap for SPACEX, notionalUsd 250, slippageBps 100, userPublicKey
   "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9" (a well-known funded mainnet account used
   ONLY as a simulation subject; no key, nothing is signed, nothing is sent).
 - assert: the tx round-trips through deserialize(serialize()); every signature slot is zero;
   the resolved account keys include TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb; the
   staticAccountKeys alone do NOT (documents the LUT trap).
 - assert simulation.err === null and unitsConsumed > 0.
 - assert simulatedWithheldRaw === transferFeeOf(simulatedGrossRaw, facts.inForceBps, cap)
   EXACTLY. This is the fee-arithmetic assertion against the live program.
 - assert expectedNetRaw is within 10 bps of simulatedNetRaw, and that expectedNetRaw <
   expectedGrossRaw by exactly transferFeeRaw.
 - assert minimumNetRaw <= expectedNetRaw.

test/postcondition.test.ts — pure:
 - held true on exact expected values;
 - false when withheldDelta is one lamport off (fee identity);
 - false when actualNet is below minimumNet;
 - false when actualNet is outside toleranceBps;
 - false when actualNet is 0.

test/nokey.test.ts — source-level guard that reads every file in src/ and asserts none of
 them contains `Keypair.fromSecretKey`, `fromSeed`, `bip39`, `PRIVATE_KEY`, `SECRET_KEY`,
 `readFileSync` of a keypair, or `signTransaction` being implemented locally. Assert
 `sign(` is never called on a transaction inside src/.

Write a `vitest.config.ts` with `test.testTimeout: 120000`, `resolve.alias` mapping
"@fineprint/core" -> "../core/src/types.ts", and `tsconfig.json` with `moduleResolution:
"bundler"`, `strict: true`, `paths` for @fineprint/core.

## Hard rules
- No mocks, no stubs, no TODO, no placeholder, no fake signature, no sample data.
- bigint everywhere for raw amounts; Number only at the final SwapResult boundary.
- Never `any`. Narrow unknown explicitly.
- Every exported function needs its error path implemented, not commented.
