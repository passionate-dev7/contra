import { writeFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { web3Connection } from "./rpc.js";
import { buildOpenShort } from "./build.js";
import { loadMarket, findUsdcReserve, findXstockReserve, vanillaObligationAddress } from "./market.js";
import { USDC_MINT } from "./constants.js";
import { address } from "@solana/kit";

/**
 * Mainnet proof: builds a real open-short for a real, funded, active Kamino
 * user and simulateTransaction's it (sigVerify:false, replaceRecentBlockhash:
 * true). Never sends, never signs, never touches a private key. The owner
 * below is a real wallet discovered by scanning this market's live
 * obligations for one that already holds a USDC deposit and enough SOL for
 * fees (packages/short/spikes/find_owner.mjs), not a generated address.
 *
 * Writes the pre-state and the simulation's post-state of the obligation and
 * both token accounts to an artifact JSON that check.mjs independently
 * decodes and re-verifies — this script only builds and simulates, it does
 * not assert the post-conditions itself.
 */
const OWNER = process.env["SHORT_OWNER"] ?? "sadmBTQm5HJsyzWHEjV4YwG9CiahZKVDVqAyS4Wx1zH";
const TICKER = process.env["SHORT_TICKER"] ?? "SPY";
const USDC_COLLATERAL = Number(process.env["SHORT_USDC"] ?? "0.5");
const BORROW_AMOUNT = Number(process.env["SHORT_BORROW"] ?? "0.001");
const ARTIFACT_PATH = process.env["SHORT_ARTIFACT"] ?? "./artifacts/sim-open.json";

async function main(): Promise<void> {
  const conn = web3Connection();
  const market = await loadMarket();
  const usdcReserve = findUsdcReserve(market);
  const xstockReserve = findXstockReserve(market, TICKER);
  const ownerPk = new PublicKey(OWNER);

  const obligationAddr = await vanillaObligationAddress(market, address(OWNER));
  const obligationPk = new PublicKey(obligationAddr.toString());
  const usdcAta = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), ownerPk, true);
  const xstockAta = getAssociatedTokenAddressSync(
    new PublicKey(xstockReserve.getLiquidityMint().toString()),
    ownerPk,
    true,
    TOKEN_2022_PROGRAM_ID,
  );

  console.log(`owner ${OWNER}`);
  console.log(`obligation ${obligationPk.toString()}`);
  console.log(`usdcAta ${usdcAta.toString()}`);
  console.log(`xstockAta ${xstockAta.toString()}`);

  const [preObligation, preUsdc, preXstock] = await Promise.all([
    conn.getAccountInfo(obligationPk, "confirmed"),
    conn.getAccountInfo(usdcAta, "confirmed"),
    conn.getAccountInfo(xstockAta, "confirmed"),
  ]);

  console.log(`\nBuilding open short: owner=${OWNER} ticker=${TICKER}x usdcCollateral=${USDC_COLLATERAL} borrow=${BORROW_AMOUNT}`);
  const built = await buildOpenShort(conn, {
    owner: OWNER,
    ticker: TICKER,
    usdcCollateral: USDC_COLLATERAL,
    borrowAmount: BORROW_AMOUNT,
  });

  console.log(`route: ${built.route}`);
  console.log(`reason: ${built.reason}`);
  console.log(`instruction count: ${built.instructions.length}`);
  console.log(`split: ${built.secondTransaction !== undefined}`);
  console.log(`lookup tables: ${built.lookupTables.length}`);

  const sim = await conn.simulateTransaction(built.transaction, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
    accounts: { encoding: "base64", addresses: [obligationPk.toString(), usdcAta.toString(), xstockAta.toString()] },
  });

  console.log("\n--- simulation result ---");
  console.log("err:", JSON.stringify(sim.value.err));
  console.log("unitsConsumed:", sim.value.unitsConsumed);
  console.log("logs (last 25):");
  for (const line of (sim.value.logs ?? []).slice(-25)) {
    console.log("  " + line);
  }

  const artifact = {
    request: { owner: OWNER, ticker: TICKER, usdcCollateral: USDC_COLLATERAL, borrowAmount: BORROW_AMOUNT },
    usdcDecimals: Number(usdcReserve.state.liquidity.mintDecimals.toString()),
    xstockDecimals: Number(xstockReserve.state.liquidity.mintDecimals.toString()),
    xstockMint: xstockReserve.getLiquidityMint().toString(),
    usdcReserveAddress: usdcReserve.address.toString(),
    xstockReserveAddress: xstockReserve.address.toString(),
    quoteOutAmount: built.quote.outAmount,
    addresses: { obligation: obligationPk.toString(), usdcAta: usdcAta.toString(), xstockAta: xstockAta.toString() },
    pre: {
      obligation: preObligation ? preObligation.data.toString("base64") : null,
      usdcAta: preUsdc ? preUsdc.data.toString("base64") : null,
      xstockAta: preXstock ? preXstock.data.toString("base64") : null,
    },
    simulation: {
      err: sim.value.err,
      unitsConsumed: sim.value.unitsConsumed ?? null,
      accounts: sim.value.accounts ?? null, // [obligation, usdcAta, xstockAta] in request order
      addressOrder: ["obligation", "usdcAta", "xstockAta"],
    },
  };
  writeFileSync(ARTIFACT_PATH, JSON.stringify(artifact, null, 2));
  console.log(`\nartifact written to ${ARTIFACT_PATH}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
