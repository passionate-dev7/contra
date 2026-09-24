#!/usr/bin/env node
// Independent post-condition checker for a contra close-short simulation.
//
// Does NOT import src/build.ts. Reads only the artifact written by
// src/simulate-close.ts: raw pre-state account bytes (getMultipleAccounts
// before the build) and the post-state bytes simulateTransaction returned,
// plus the request amounts and the Jupiter quote that was sent. Obligation and
// Reserve bytes are decoded with the klend program's own account layouts
// (klend-sdk codegen), token accounts as plain SPL u64 amounts.
//
// Usage: node check-close.mjs [artifact.json]   exit 0 = GREEN, 1 = RED

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const codegen = (name) =>
  import(new URL(`./node_modules/@kamino-finance/klend-sdk/dist/@codegen/klend/accounts/${name}.js`, import.meta.url).href);
const { Obligation } = await codegen("Obligation");
const { Reserve } = await codegen("Reserve");

const artifactPath = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL("./artifacts/sim-close.json", import.meta.url));
const a = JSON.parse(readFileSync(artifactPath, "utf8"));
const SF = 2n ** 60n; // klend *Sf / *Bsf fixed-point scale
const reasons = [];
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => {
  reasons.push(m);
  console.log(`  FAIL  ${m}`);
};
const abs = (x) => (x < 0n ? -x : x);
const big = (bn) => BigInt(bn.toString());
const bsf = (f) => f.value.reduce((acc, limb, i) => acc + (big(limb) << BigInt(64 * i)), 0n); // [u64;4] little-endian
const tokenAmount = (b64) => (b64 === null ? 0n : Buffer.from(b64, "base64").readBigUInt64LE(64));

const post = {};
a.addressOrder.forEach((n, i) => {
  const acc = Array.isArray(a.simulation.accounts) ? a.simulation.accounts[i] : null;
  post[n] = acc === null ? null : acc.data[0];
});
const dec = (Cls, b64) => (b64 === null ? null : Cls.decode(Buffer.from(b64, "base64")));

console.log(`checking ${artifactPath}`);
console.log(`request: repay ${a.request.repayAmount} ${a.request.ticker}x, withdraw ${a.request.withdrawUsdc} USDC, quote in ${a.quote.inAmount} out ${a.quote.outAmount}\n`);

if (a.simulation.err === null) pass("simulation returned err: null");
else fail(`simulation failed: ${JSON.stringify(a.simulation.err)}`);

const preObl = dec(Obligation, a.pre.obligation);
const postObl = dec(Obligation, post.obligation);
const postXRes = dec(Reserve, post.xstockReserve);
const postURes = dec(Reserve, post.usdcReserve);
const repayRaw = BigInt(Math.round(a.request.repayAmount * 10 ** a.xstockDecimals));
const withdrawRaw = BigInt(Math.round(a.request.withdrawUsdc * 10 ** a.usdcDecimals));

// 1. Borrow decreased by exactly the repaid amount, after accruing interest
// from the obligation's last cumulative borrow rate to the reserve's post one.
{
  const pre = preObl?.borrows.find((b) => b.borrowReserve === a.xstockReserveAddress);
  const pst = postObl?.borrows.find((b) => b.borrowReserve === a.xstockReserveAddress);
  if (!pre || !pst || !postXRes) {
    fail(`borrow entry or reserve missing from post-state (pre ${!!pre}, post ${!!pst}, reserve ${!!postXRes})`);
  } else {
    const accrued = (big(pre.borrowedAmountSf) * bsf(postXRes.liquidity.cumulativeBorrowRateBsf)) / bsf(pre.cumulativeBorrowRateBsf);
    const expected = accrued - repayRaw * SF;
    const got = big(pst.borrowedAmountSf);
    const drift = abs(got - expected) / SF;
    const interest = (accrued - big(pre.borrowedAmountSf)) / SF;
    if (drift <= 1n) pass(`${a.request.ticker}x borrow ${big(pre.borrowedAmountSf) / SF} -> ${got / SF} raw: -${repayRaw} repaid, +${interest} accrued interest (drift ${drift})`);
    else fail(`${a.request.ticker}x borrow post ${got / SF} raw, expected ${expected / SF} (pre + ${interest} interest - ${repayRaw} repay), drift ${drift}`);
  }
}

// 2. USDC collateral decreased by the withdrawn amount, in cTokens at the
// reserve's post-refresh exchange rate (mint supply / total liquidity).
{
  const pre = preObl?.deposits.find((d) => d.depositReserve === a.usdcReserveAddress);
  const pst = postObl?.deposits.find((d) => d.depositReserve === a.usdcReserveAddress);
  if (!pre || !pst || !postURes) {
    fail(`USDC deposit entry or reserve missing from post-state`);
  } else {
    const l = postURes.liquidity;
    const totalLiqSf =
      big(l.totalAvailableAmount) * SF + big(l.borrowedAmountSf) - big(l.accumulatedProtocolFeesSf) - big(l.accumulatedReferrerFeesSf) - big(l.pendingReferrerFeesSf);
    const expectedC = (withdrawRaw * big(postURes.collateral.mintTotalSupply) * SF) / totalLiqSf;
    const withdrawnCTokens = big(pre.depositedAmount) - big(pst.depositedAmount);
    if (abs(withdrawnCTokens - expectedC) <= 2n) pass(`USDC collateral -${withdrawnCTokens} cTokens (expected ${expectedC} for ${withdrawRaw} raw USDC at post exchange rate)`);
    else fail(`USDC collateral decreased ${withdrawnCTokens} cTokens, expected ${expectedC} for ${withdrawRaw} raw USDC`);
  }
}

// 3. xStock account: bought then repaid. Net = swap surplus only, bounded by
// the quote's surplus over the repay plus 1% slippage; never negative.
{
  const net = tokenAmount(post.xstockAta) - tokenAmount(a.pre.xstockAta);
  const out = BigInt(a.quote.outAmount);
  const maxSurplus = out - repayRaw + out / 100n;
  if (post.xstockAta !== null && net >= 0n && net <= maxSurplus) pass(`xStock account net +${net} raw (~0: bought ${out}, repaid ${repayRaw}; surplus bound ${maxSurplus})`);
  else fail(`xStock account net ${net} raw outside [0, ${maxSurplus}] (buy-back not repaid, or repay short)`);
}

// 4. Owner USDC delta = withdrawn collateral - buy-back cost (ExactIn spends exactly inAmount).
{
  const delta = tokenAmount(post.usdcAta) - tokenAmount(a.pre.usdcAta);
  const expected = withdrawRaw - BigInt(a.quote.inAmount);
  if (post.usdcAta !== null && abs(delta - expected) <= 2n) pass(`owner USDC delta ${delta} raw = withdrawn ${withdrawRaw} - buy-back ${a.quote.inAmount} (expected ${expected}, tol 2)`);
  else fail(`owner USDC delta ${delta} raw, expected ${expected} (withdrawn ${withdrawRaw} - buy-back ${a.quote.inAmount})`);
}

console.log(`\n${reasons.length === 0 ? "GREEN: all post-conditions held" : `RED: ${reasons.length} post-condition(s) failed`}`);
process.exit(reasons.length === 0 ? 0 : 1);
