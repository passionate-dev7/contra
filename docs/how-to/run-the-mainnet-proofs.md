# Run the mainnet proofs

The repo proves its transactions with `simulateTransaction` against mainnet, then checks the result with a second script that does not import the builder. Nothing here signs or sends.

Each proof has two halves:

| Builder (writes an artifact) | Checker (reads the artifact) |
|---|---|
| `packages/short/src/simulate.ts` | `packages/short/check.mjs` |
| `packages/short/src/simulate-close.ts` | `packages/short/check-close.mjs` |
| `packages/short/src/simulate-guard.ts pass` and `fail` | `packages/short/check-guard.mjs` (runs both builders itself) |

The web-app checks (`check-web.mjs`, `check-bf.mjs`, `apps/web/check-hedge.mjs`, `apps/web/check-positions.mjs`, `apps/web/check-pyth.mjs`) build and boot the Next.js app, then compare its routes against independent reads.

## Setup

```bash
pnpm install
export SOLANA_RPC_URL=<your mainnet RPC>   # optional; public endpoint otherwise
```

Put `PYTH_API_KEY` in `.env` yourself if you run `check-pyth.mjs`. The shell running the check must have it exported.

## Open short

```bash
cd packages/short
npx tsx src/simulate.ts
node check.mjs
```

`simulate.ts` builds an open for a real funded owner (default `sadmBTQm5HJsyzWHEjV4YwG9CiahZKVDVqAyS4Wx1zH`, found by `packages/short/spikes/find_owner.mjs`), simulates it with `sigVerify: false` and `replaceRecentBlockhash: true`, and writes `packages/short/artifacts/sim-open.json` with the pre-state and the simulated post-state of the obligation, the owner's USDC ATA, and the owner's xStock ATA.

Environment overrides: `SHORT_OWNER`, `SHORT_TICKER` (default `SPY`), `SHORT_USDC` (default `0.5`), `SHORT_BORROW` (default `0.001`), `SHORT_ARTIFACT` (default `./artifacts/sim-open.json`).

`check.mjs [artifact]` decodes the raw bytes with klend-sdk's generated `Obligation` layout and asserts:

1. simulation `err` is `null`
2. the obligation's USDC deposit (cTokens) increased
3. the obligation's xStock borrow increased by the requested raw amount, within 1 raw unit
4. the owner's xStock ATA net change is within 2 raw units of zero (borrowed, then sold)
5. the owner's USDC delta equals `quote.outAmount - deposit` within 300 bps

Exit 0 prints `GREEN: all post-conditions held`; exit 1 prints `RED: N post-condition(s) failed`.

## Close short

```bash
cd packages/short
npx tsx src/simulate-close.ts
node check-close.mjs
```

Default owner `DK7iCr4uSjKQF7qYTnygrrZuAc2hFNaKPrYDV2UKikWC` (from `packages/short/spikes/find_close_owner.mjs`). Overrides: `CLOSE_OWNER`, `CLOSE_TICKER` (`SPY`), `CLOSE_REPAY` (`0.01`), `CLOSE_WITHDRAW` (`5`), `CLOSE_MAX_USDC_IN` (`15`), `CLOSE_ARTIFACT` (`./artifacts/sim-close.json`).

`check-close.mjs [artifact]` asserts:

1. simulation `err` is `null`
2. the xStock borrow fell by exactly the repay after accruing interest from the obligation's cumulative borrow rate to the reserve's post-refresh rate (drift at most 1 raw unit)
3. USDC collateral fell by the cTokens that the withdrawn amount is worth at the post-refresh exchange rate (within 2)
4. the xStock ATA net is between 0 and the buy-back surplus bound (`outAmount - repay + outAmount/100`)
5. the owner's USDC delta equals `withdraw - quote.inAmount` within 2 raw units

## Red cases

The checkers are only meaningful because they also go red. Two committed artifacts are expected to fail:

```bash
cd packages/short
node check.mjs artifacts/sim-open-red.json         # borrow 1 TSLAx: klend reverts with Custom 6009 (ReserveStale)
node check-close.mjs artifacts/sim-close-red.json  # withdraw 4000 USDC: klend reverts with Custom 6011 (WithdrawTooLarge)
```

Both exit 1. The error codes are in the artifacts' `simulation.err`: `{"InstructionError":[8,{"Custom":6009}]}` and `{"InstructionError":[11,{"Custom":6011}]}`. To regenerate them, rerun the builders with overrides, for example:

```bash
SHORT_TICKER=TSLA SHORT_BORROW=1 SHORT_ARTIFACT=./artifacts/sim-open-red.json npx tsx src/simulate.ts
CLOSE_WITHDRAW=4000 CLOSE_ARTIFACT=./artifacts/sim-close-red.json npx tsx src/simulate-close.ts
```

A regenerated red artifact only reverts if the chain state still makes the request invalid. Read `simulation.err` before trusting it.

## Lighthouse guard

```bash
cd packages/short
node check-guard.mjs
```

`check-guard.mjs` runs `npx tsx src/simulate-guard.ts pass` and `... fail` itself (with the `timeout` command, 300 s each), then reads `packages/short/artifacts/sim-guard-pass.json` and `packages/short/artifacts/sim-guard-fail.json`. It asserts:

- the pass run has `err: null` and a `Program L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95 invoke` log line
- the fail run has a non-null `err`, and its logs contain `Program L2TEx... failed`, or a Lighthouse `consumed` line alongside failure text elsewhere in the logs (`check-guard.mjs:10`). The second branch is looser than the first; read the fail artifact's last log lines if you need the exact attribution

The fail run rebuilds the same instructions with the Lighthouse bound raised by 10^12 raw USDC (`simulate-guard.ts:100`). The committed fail artifact reverted with `{"InstructionError":[11,{"Custom":6001}]}`, and its last log line is `Program L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95 failed: custom program error: 0x1771` (0x1771 = 6001).

`simulate-guard.ts` retries up to 5 times when the build splits or the Jupiter leg fails on a stale quote.

## Web app checks

Each script runs `pnpm --filter @contra/web build`, starts `next start` on its own port, and kills it when done.

```bash
node check-web.mjs                 # repo root, port 3131
node check-bf.mjs                  # repo root, port 3141
cd apps/web
node check-hedge.mjs               # port 3171
node check-positions.mjs           # port 3173
PYTH_API_KEY=... node check-pyth.mjs   # port 3172
```

| Script | Asserts |
|---|---|
| `check-web.mjs` | `DESIGN.md` exists; `~/.config/agent-rules/frontend/design-log.jsonl` has a contra entry (a local-machine file, so this fails on other machines); `/api/reserves` borrowable set is exactly `NVDAx,QQQx,SPYx,TSLAx`; MSTRx is blocked with a reason mentioning "limit"; the home page states "N of M" and "market open/closed"; `/api/open` returns a transaction that invokes both klend and Jupiter |
| `check-bf.mjs` | SPYx borrow factor above 1 and TSLAx above SPYx in `/api/reserves`; the home page shows both as percents |
| `apps/web/check-hedge.mjs` | `/api/hedge?owner=DrAR2ZNC5KYZps7NJyYHfzeZTaqbMUaGM3CBUWfpbCUs` reports the same raw SPYx balance as a direct `getTokenAccountsByOwner`; the suggestion is SPYx and no larger than the holding; `/hedge?wallet=...` renders it |
| `apps/web/check-positions.mjs` | a random new keypair gets `null` from `/api/positions` and the empty-state text on `/positions` (red case); the default owner's SPYx borrow from `/api/positions` matches a direct `Obligation.decode` of the obligation account; the page renders SPYx, an LTV between 1% and 100%, and the health wording. Owner override: `POSITIONS_OWNER` |
| `apps/web/check-pyth.mjs` | `/api/pyth` for TSLAx and QQQx is within 0.5% of Hermes read directly; it carries a Jupiter price, gap and publish time; SPYx returns `pythPrice: null` with a plan reason; the home page mentions Pyth and bps |

The hardcoded borrowable set in `check-web.mjs` reflects Kamino's caps when it was written. It goes red if Kamino changes a borrow limit, which is a real change and not a bug in Contra.

## Blind spots

- Simulation is not execution. No script here sends a transaction, so nothing proves a signed short landed.
- The fixed owners must keep their state (a USDC deposit, an SPYx borrow, an SPYx balance). If they close out, the checks throw with a message naming the owner.
- The close path has no Lighthouse guard, so there is no guard-style red test for it.
