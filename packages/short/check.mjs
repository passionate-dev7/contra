#!/usr/bin/env node
// Independent post-condition checker for a contra open-short simulation.
//
// Deliberately does NOT import packages/short/src/build.ts or trust its return
// values. It reads only:
//   1. the raw account bytes simulateTransaction returned (pre-state read
//      separately via getAccountInfo, post-state from the simulation's
//      `accounts` response), and
//   2. the request parameters (deposit/borrow amounts, quote) that were sent.
// Everything else -- the obligation's deposit and borrow deltas, the token
// account balance deltas -- is recomputed here from those bytes using the
// on-chain program's own account layout (imported from klend-sdk's codegen,
// the schema the Kamino program itself defines, not this repo's business
// logic) and plain u64 token-account decoding.
//
// Usage: node check.mjs [artifact.json]
// Exit code 0 = every post-condition held. Exit code 1 = at least one failed.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { Obligation } = await import(
  new URL(
    "./node_modules/@kamino-finance/klend-sdk/dist/@codegen/klend/accounts/Obligation.js",
    import.meta.url,
  ).href
);

const artifactPath = resolve(process.argv[2] ?? "./artifacts/sim-open.json");
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const SF_SCALE = 2n ** 60n; // Kamino's fixed-point scale for *Sf fields (Fraction.FRACTIONS)
const TOLERANCE_BPS = 300n; // 3%: quote-to-simulation price drift tolerance, not a fudge on the identity itself

function tokenAccountAmount(base64OrNull) {
  if (base64OrNull === null) return 0n;
  const buf = Buffer.from(base64OrNull, "base64");
  // SPL Token / Token-2022 base layout: mint(32) owner(32) amount(u64 LE)...
  return buf.readBigUInt64LE(64);
}

function decodeObligation(base64OrNull) {
  if (base64OrNull === null) return null;
  return Obligation.decode(Buffer.from(base64OrNull, "base64"));
}

function findDeposit(obligation, reserveAddress) {
  if (obligation === null) return 0n;
  const entry = obligation.deposits.find((d) => d.depositReserve === reserveAddress);
  return entry === undefined ? 0n : BigInt(entry.depositedAmount.toString());
}

function findBorrowSf(obligation, reserveAddress) {
  if (obligation === null) return 0n;
  const entry = obligation.borrows.find((b) => b.borrowReserve === reserveAddress);
  return entry === undefined ? 0n : BigInt(entry.borrowedAmountSf.toString());
}

function fail(reasons, msg) {
  reasons.push(msg);
  console.log(`  FAIL  ${msg}`);
}

function pass(msg) {
  console.log(`  PASS  ${msg}`);
}

function absBigInt(x) {
  return x < 0n ? -x : x;
}

function main() {
  const reasons = [];

  console.log(`checking ${artifactPath}`);
  console.log(`request: deposit ${artifact.request.usdcCollateral} USDC, borrow ${artifact.request.borrowAmount} ${artifact.request.ticker}x\n`);

  const sim = artifact.simulation;
  if (sim.err !== null && sim.err !== undefined) {
    fail(reasons, `simulation itself failed: ${JSON.stringify(sim.err)}`);
    // Still attempt the account-level checks below: a reverted simulation's
    // `accounts` response should show no state change, which is itself a
    // useful assertion that the guard rails held (no partial-apply).
  } else {
    pass("simulation returned err: null");
  }

  const order = sim.addressOrder; // ["obligation", "usdcAta", "xstockAta"]
  const postByName = {};
  if (Array.isArray(sim.accounts)) {
    order.forEach((name, i) => {
      const acc = sim.accounts[i];
      postByName[name] = acc === null ? null : acc.data[0];
    });
  } else {
    order.forEach((name) => {
      postByName[name] = null;
    });
  }

  const preObligation = decodeObligation(artifact.pre.obligation);
  const postObligation = decodeObligation(postByName.obligation);

  const depositAmountRaw = BigInt(Math.round(artifact.request.usdcCollateral * 10 ** artifact.usdcDecimals));
  const borrowAmountRaw = BigInt(Math.round(artifact.request.borrowAmount * 10 ** artifact.xstockDecimals));

  // 1. Obligation gets the deposit (USDC collateral, cToken-denominated; any
  // increase proves the deposit landed -- the exact USD value needs the
  // reserve's collateral exchange rate, which is a separate, slower-moving
  // fact this check does not need to re-derive).
  const preDepositCTokens = findDeposit(preObligation, artifact.usdcReserveAddress);
  const postDepositCTokens = findDeposit(postObligation, artifact.usdcReserveAddress);
  if (postObligation !== null && postDepositCTokens > preDepositCTokens) {
    pass(`obligation USDC deposit increased: ${preDepositCTokens} -> ${postDepositCTokens} cTokens`);
  } else {
    fail(reasons, `obligation USDC deposit did not increase: ${preDepositCTokens} -> ${postDepositCTokens} cTokens`);
  }

  // 2. Obligation gets the borrow, for exactly the requested raw amount
  // (borrows are liquidity-denominated, not cToken-denominated, and no
  // interest has accrued within the same transaction, so this must be exact).
  const preBorrowSf = findBorrowSf(preObligation, artifact.xstockReserveAddress);
  const postBorrowSf = findBorrowSf(postObligation, artifact.xstockReserveAddress);
  const borrowDeltaRaw = (postBorrowSf - preBorrowSf) / SF_SCALE;
  if (postObligation !== null && absBigInt(borrowDeltaRaw - borrowAmountRaw) <= 1n) {
    pass(`obligation ${artifact.request.ticker}x borrow increased by ${borrowDeltaRaw} raw units (requested ${borrowAmountRaw})`);
  } else {
    fail(
      reasons,
      `obligation ${artifact.request.ticker}x borrow delta ${borrowDeltaRaw} does not match requested ${borrowAmountRaw}`,
    );
  }

  // 3. The borrowed xStock is sold in the same transaction: the owner's
  // xStock token account should show ~no net change (received, then spent).
  const preXstock = tokenAccountAmount(artifact.pre.xstockAta);
  const postXstock = tokenAccountAmount(postByName.xstockAta);
  const xstockNet = postXstock - preXstock;
  const xstockDustTolerance = 2n;
  if (postByName.xstockAta !== null && absBigInt(xstockNet) <= xstockDustTolerance) {
    pass(`xStock account net change ${xstockNet} raw units (borrowed then sold, ~0 expected)`);
  } else {
    fail(reasons, `xStock account net change ${xstockNet} raw units exceeds dust tolerance of ${xstockDustTolerance} (borrow was not fully sold)`);
  }

  // 4. The owner's USDC delta equals collateral out (the deposit) plus sale
  // proceeds in (the Jupiter quote's outAmount), within a price-drift
  // tolerance. This is the one figure that must net correctly for the whole
  // "borrow and sell" loop to be real money movement, not just accepted
  // instructions.
  const preUsdc = tokenAccountAmount(artifact.pre.usdcAta);
  const postUsdc = tokenAccountAmount(postByName.usdcAta);
  const usdcDelta = postUsdc - preUsdc;
  const quoteOutRaw = BigInt(artifact.quoteOutAmount);
  const expectedUsdcDelta = quoteOutRaw - depositAmountRaw;
  const toleranceRaw = (absBigInt(expectedUsdcDelta) * TOLERANCE_BPS) / 10000n || 1n;
  if (postByName.usdcAta !== null && absBigInt(usdcDelta - expectedUsdcDelta) <= toleranceRaw) {
    pass(
      `owner USDC delta ${usdcDelta} raw matches collateral-out(-${depositAmountRaw}) + proceeds-in(+${quoteOutRaw}) = ${expectedUsdcDelta} within ${TOLERANCE_BPS}bps`,
    );
  } else {
    fail(
      reasons,
      `owner USDC delta ${usdcDelta} raw does not match expected ${expectedUsdcDelta} (collateral-out ${depositAmountRaw} + proceeds-in ${quoteOutRaw}) within ${TOLERANCE_BPS}bps`,
    );
  }

  console.log(`\n${reasons.length === 0 ? "GREEN: all post-conditions held" : `RED: ${reasons.length} post-condition(s) failed`}`);
  process.exit(reasons.length === 0 ? 0 : 1);
}

main();
