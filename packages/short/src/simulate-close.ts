import { writeFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { address } from "@solana/kit";
import { web3Connection } from "./rpc.js";
import { buildCloseShort } from "./build.js";
import { loadMarket, findUsdcReserve, findXstockReserve, vanillaObligationAddress } from "./market.js";
import { USDC_MINT } from "./constants.js";

/**
 * Mainnet proof for buildCloseShort: builds a partial close for a real
 * obligation that already borrows the xStock against a USDC deposit, and
 * simulateTransaction's it (sigVerify:false, replaceRecentBlockhash:true).
 * Never signs or sends. The default owner was found by scanning all of this
 * market's obligations (spikes/find_close_owner.mjs) for an xStock borrow +
 * USDC deposit whose wallet holds USDC for the buy-back and SOL for fees.
 * check-close.mjs independently decodes the artifact this writes.
 */
const OWNER = process.env["CLOSE_OWNER"] ?? "DK7iCr4uSjKQF7qYTnygrrZuAc2hFNaKPrYDV2UKikWC";
const TICKER = process.env["CLOSE_TICKER"] ?? "SPY";
const REPAY = Number(process.env["CLOSE_REPAY"] ?? "0.01");
const WITHDRAW = Number(process.env["CLOSE_WITHDRAW"] ?? "5");
const MAX_USDC_IN = Number(process.env["CLOSE_MAX_USDC_IN"] ?? "15");
const ARTIFACT_PATH = process.env["CLOSE_ARTIFACT"] ?? "./artifacts/sim-close.json";

async function main(): Promise<void> {
  const conn = web3Connection();
  const market = await loadMarket();
  const usdcReserve = findUsdcReserve(market);
  const xstockReserve = findXstockReserve(market, TICKER);
  const ownerPk = new PublicKey(OWNER);
  const obligationPk = new PublicKey((await vanillaObligationAddress(market, address(OWNER))).toString());
  const usdcAta = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), ownerPk, true);
  const xstockAta = getAssociatedTokenAddressSync(
    new PublicKey(xstockReserve.getLiquidityMint().toString()),
    ownerPk,
    true,
    TOKEN_2022_PROGRAM_ID,
  );
  const names = ["obligation", "usdcAta", "xstockAta", "usdcReserve", "xstockReserve"] as const;
  const keys = [obligationPk, usdcAta, xstockAta, new PublicKey(usdcReserve.address), new PublicKey(xstockReserve.address)];
  names.forEach((n, i) => console.log(`${n} ${keys[i]!.toString()}`));

  const pre = await conn.getMultipleAccountsInfo(keys, "confirmed");
  console.log(`\nBuilding close: owner=${OWNER} repay=${REPAY} ${TICKER}x withdraw=${WITHDRAW} USDC maxUsdcIn=${MAX_USDC_IN}`);
  const built = await buildCloseShort(conn, {
    owner: OWNER,
    ticker: TICKER,
    repayAmount: REPAY,
    withdrawUsdc: WITHDRAW,
    maxUsdcIn: MAX_USDC_IN,
  });
  console.log(`route: ${built.route} (${built.quote.swapMode}, in ${built.quote.inAmount} out ${built.quote.outAmount})`);
  console.log(`scope tokens refreshed: ${built.scopeTokens.join(",")}`);
  console.log(`reason: ${built.reason}`);
  if (built.secondTransaction !== undefined) {
    throw new Error("close was split into two transactions; a single simulateTransaction cannot prove the combined post-state");
  }

  const sim = await conn.simulateTransaction(built.transaction, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
    accounts: { encoding: "base64", addresses: keys.map((k) => k.toString()) },
  });
  console.log("\n--- simulation result ---");
  console.log("err:", JSON.stringify(sim.value.err));
  console.log("unitsConsumed:", sim.value.unitsConsumed);
  const logs = sim.value.logs ?? [];
  for (const line of logs.filter((l) => /tk \d+|Price skipped|Error|failed|Instruction: (Repay|Withdraw|RefreshPriceList)/.test(l)).slice(0, 30)) {
    console.log("  " + line);
  }

  const b64 = (a: { data: Buffer } | null) => (a ? a.data.toString("base64") : null);
  const artifact = {
    request: { owner: OWNER, ticker: TICKER, repayAmount: REPAY, withdrawUsdc: WITHDRAW, maxUsdcIn: MAX_USDC_IN },
    usdcDecimals: Number(usdcReserve.state.liquidity.mintDecimals.toString()),
    xstockDecimals: Number(xstockReserve.state.liquidity.mintDecimals.toString()),
    usdcReserveAddress: usdcReserve.address.toString(),
    xstockReserveAddress: xstockReserve.address.toString(),
    quote: { swapMode: built.quote.swapMode, inAmount: built.quote.inAmount, outAmount: built.quote.outAmount },
    scopeTokens: built.scopeTokens,
    addressOrder: names,
    pre: Object.fromEntries(names.map((n, i) => [n, b64(pre[i] ?? null)])),
    simulation: { err: sim.value.err, unitsConsumed: sim.value.unitsConsumed ?? null, accounts: sim.value.accounts ?? null, logs },
  };
  writeFileSync(ARTIFACT_PATH, JSON.stringify(artifact, null, 2));
  console.log(`\nartifact written to ${ARTIFACT_PATH}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
