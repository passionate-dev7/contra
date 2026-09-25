# Contra developer documentation

Contra builds a one-signature short on a tokenized US stock (an xStock) on Solana. One unsigned v0 transaction deposits USDC into Kamino's xStocks market, borrows the xStock, and sells it through Jupiter. Closing buys the xStock back through Jupiter, repays, and withdraws. The browser wallet signs; the server never holds a key.

## What Contra is not

- **Not an on-chain program.** Contra deploys nothing. It composes instructions for programs other teams run: Kamino klend, Scope, Jupiter, Lighthouse, the Associated Token Account program, and ComputeBudget. There is no IDL and no Contra account type. The "protocol" is the ordered instruction graph described in [explanation/transaction-anatomy.md](explanation/transaction-anatomy.md).
- **Not custodial.** `buildOpenShort` and `buildCloseShort` take a read-only signer and return unsigned transactions (`packages/short/src/kit.ts:37`).
- **Not an indexer.** The positions view reads the current obligation account. It does not know the entry price or open date of a short.
- **Not a sender.** Every proof in this repo is `simulateTransaction`. The repo contains no record of a signed mainnet short.

## Who each section is for

| Section | Read it if you want to |
|---|---|
| [tutorials/](tutorials/open-and-close-a-short.md) | open and close one short in the web app, end to end |
| [how-to/](how-to/build-a-short-with-the-package.md) | call the builder from your own TypeScript, or rerun the mainnet proofs |
| [explanation/](explanation/transaction-anatomy.md) | understand why the transaction is shaped the way it is, how prices are checked, and what you are trusting |
| [reference/](reference/http-api.md) | look up a route, an export, an address, or an error |

## HTTP API or package?

| | HTTP API (`apps/web/src/app/api`) | Package (`@contra/short`, `packages/short/src`) |
|---|---|---|
| Runtime | any HTTP client | Node with TypeScript (tsx or a bundler); the package ships `.ts` source, no build output |
| Amounts | raw base units as strings (`"500000"` = 0.5 USDC) | UI numbers (`0.5`) |
| Output | `{ transactions: string[] }`, base64 v0 transactions | `BuiltShort` with `VersionedTransaction` objects, the instruction list, lookup tables, the Jupiter quote, and Scope tokens refreshed |
| Slippage | fixed at 100 bps (the route does not pass `slippageBps`) | `slippageBps` on the request, default 100 |
| Read-side views | `/api/reserves`, `/api/positions`, `/api/hedge`, `/api/pyth` | `readReserveFacts` only; positions, hedge and Pyth fair value live in `apps/web/src/lib`, not in the package |
| Needs | a running `@contra/web` | an RPC URL in `SOLANA_RPC_URL` or `RPC_URL` |

Pick the HTTP API if you only need a transaction to hand to a wallet. Pick the package if you need to inspect or extend the instruction list, simulate before signing, or run without the web app.

## Repository map

| Path | Role |
|---|---|
| `packages/short` (`@contra/short`) | transaction builder: market load, Scope refresh, Jupiter leg, Lighthouse guard, v0 compile |
| `apps/web` (`@contra/web`) | Next.js app: order ticket, blotter, `/positions`, `/hedge`, and the six API routes |
| `packages/core` (`@fineprint/core`) | used for one function: `operativeMultiplier`, the Token-2022 scaled-UI multiplier, imported by `apps/web/src/lib/xstock-price.ts:2` |
| `packages/exec` (`@fineprint/exec`) | leftover from an earlier project. Listed in `apps/web/package.json` and `transpilePackages`, but no file under `apps/web/src` imports it. `check-web.mjs` only uses its `package.json` to resolve `@solana/web3.js` |
| `packages/convert`, `packages/sponsor` (`@lastcall/*`) | leftover from an earlier project. Nothing in `packages/short` or `apps/web` imports them |

## Page index

Tutorials
- [Open and close a short](tutorials/open-and-close-a-short.md)

How-to
- [Build a short with the package](how-to/build-a-short-with-the-package.md)
- [Run the mainnet proofs](how-to/run-the-mainnet-proofs.md)

Explanation
- [Transaction anatomy](explanation/transaction-anatomy.md)
- [Oracle and pricing](explanation/oracle-and-pricing.md)
- [Risk and trust](explanation/risk-and-trust.md)

Reference
- [HTTP API](reference/http-api.md)
- [Package API](reference/package-api.md)
- [Addresses](reference/addresses.md)
- [Errors](reference/errors.md)
