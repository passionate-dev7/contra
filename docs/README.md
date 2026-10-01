# Contra developer documentation

Contra builds a one-signature short on a tokenized US stock (an xStock) on Solana. One unsigned v0 transaction deposits USDC into Kamino's xStocks market, borrows the xStock, and sells it through Jupiter. Closing buys the xStock back through Jupiter, repays, and withdraws. The browser wallet signs; the server never holds a key.

## What Contra is

- **A composer of programs other teams run.** Contra deploys nothing. It builds the instruction graph for Kamino klend, Scope, Jupiter, Lighthouse, the Associated Token Account program, and ComputeBudget. There is no IDL and no Contra account type: the "protocol" is the ordered instruction graph described in [explanation/transaction-anatomy.md](explanation/transaction-anatomy.md).
- **Non-custodial.** `buildOpenShort` and `buildCloseShort` take a read-only signer and return unsigned transactions (`packages/short/src/kit.ts:37`).
- **Stateless.** The positions view reads the current obligation account at the current slot. Every figure it shows is verifiable on-chain.
- **Proven on mainnet state.** Every proof in this repo is a `simulateTransaction` run against live mainnet accounts, checked by a script that does not import the builder.

## Who each section is for

| Section | Read it if you want to |
|---|---|
| [tutorials/](tutorials/open-and-close-a-short.md) | open and close one short in the web app, end to end |
| [how-to/](how-to/build-a-short-with-the-package.md) | call the builder from your own TypeScript, or rerun the mainnet proofs |
| [explanation/](explanation/transaction-anatomy.md) | understand why the transaction is shaped the way it is, how prices are checked, and what each guard guarantees |
| [reference/](reference/http-api.md) | look up a route, an export, an address, or an error |

## HTTP API or package?

| | HTTP API (`apps/web/src/app/api`) | Package (`@contra/short`, `packages/short/src`) |
|---|---|---|
| Runtime | any HTTP client | Node with TypeScript (tsx or a bundler); the package ships `.ts` source |
| Amounts | raw base units as strings (`"500000"` = 0.5 USDC) | UI numbers (`0.5`) |
| Output | `{ transactions: string[] }`, base64 v0 transactions | `BuiltShort` with `VersionedTransaction` objects, the instruction list, lookup tables, the Jupiter quote, and Scope tokens refreshed |
| Slippage | the builder default, 100 bps | `slippageBps` on the request, default 100 |
| Read-side views | `/api/reserves`, `/api/positions`, `/api/hedge`, `/api/pyth`, `/api/agent` | `readReserveFacts`; positions, hedge, Pyth fair value and the agent live in `apps/web/src/lib` |
| Needs | a running `@contra/web` | an RPC URL in `SOLANA_RPC_URL` or `RPC_URL` |

Pick the HTTP API if you only need a transaction to hand to a wallet. Pick the package if you need to inspect or extend the instruction list, simulate before signing, or run without the web app.

## Repository map

| Path | Role |
|---|---|
| `packages/short` (`@contra/short`) | transaction builder: market load, Scope refresh, Jupiter leg, Lighthouse guard, v0 compile |
| `apps/web` (`@contra/web`) | Next.js app: order ticket, blotter, `/positions`, `/hedge`, `/agent`, `/pitch`, `/docs`, and the seven API routes |
| `packages/core` (`@fineprint/core`) | `operativeMultiplier`, the Token-2022 scaled-UI multiplier, imported by `apps/web/src/lib/xstock-price.ts:2` |

## Page index

Tutorials
- [Open and close a short](tutorials/open-and-close-a-short.md)

How-to
- [Build a short with the package](how-to/build-a-short-with-the-package.md)
- [Run the mainnet proofs](how-to/run-the-mainnet-proofs.md)

Explanation
- [Transaction anatomy](explanation/transaction-anatomy.md)
- [Oracle and pricing](explanation/oracle-and-pricing.md)
- [Security model](explanation/security-model.md)

Reference
- [HTTP API](reference/http-api.md)
- [Package API](reference/package-api.md)
- [Addresses](reference/addresses.md)
- [Errors](reference/errors.md)
