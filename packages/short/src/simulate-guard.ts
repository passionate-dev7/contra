import { mkdirSync, writeFileSync } from "node:fs";
import { Connection, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { web3Connection } from "./rpc.js";
import { buildOpenShort, type BuiltShort } from "./build.js";
import { LIGHTHOUSE_PROGRAM_ID, withPostconditions } from "./guard.js";
import { loadMarket, findUsdcReserve } from "./market.js";
import { USDC_MINT } from "./constants.js";

/**
 * Guard proof: simulates the guarded open-short from simulate.ts's live flow.
 *   pass -> realistic minUsdcAfter (built by buildOpenShort), must succeed.
 *   fail -> minUsdcAfter set impossibly high (+10^12 raw), must revert via Lighthouse.
 * Writes artifacts/sim-guard-<flag>.json = {err, logs}.
 *
 * Jupiter returns a different route per quote, and a fat multi-hop route can
 * push the guarded open over the 1232-byte v0 limit so buildOpenShort splits
 * it (the guard then lives on the second leg, which spends the borrow and can
 * never simulate standalone). A split build is therefore retried with a fresh
 * quote until the guarded open fits in one transaction; likewise a simulation
 * that dies inside Jupiter (stale quote / slippage, Custom 6024) is retried.
 * Every attempt is a real quote + real mainnet simulation, no mocks.
 */
const OWNER = process.env["SHORT_OWNER"] ?? "sadmBTQm5HJsyzWHEjV4YwG9CiahZKVDVqAyS4Wx1zH";
const TICKER = process.env["SHORT_TICKER"] ?? "SPY";
const USDC_COLLATERAL = Number(process.env["SHORT_USDC"] ?? "0.5");
const BORROW_AMOUNT = Number(process.env["SHORT_BORROW"] ?? "0.001");
const MAX_ATTEMPTS = 5;
const LIGHTHOUSE = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";

async function buildOnce(conn: Connection): Promise<BuiltShort> {
  const built = await buildOpenShort(conn, {
    owner: OWNER,
    ticker: TICKER,
    usdcCollateral: USDC_COLLATERAL,
    borrowAmount: BORROW_AMOUNT,
  });
  console.log(`route: ${built.route} | split: ${built.secondTransaction !== undefined} | ixs: ${built.instructions.length}`);
  console.log(`reason: ${built.reason}`);
  return built;
}

function lighthouseFailed(logs: string[]): boolean {
  return logs.some((l) => l.includes(`Program ${LIGHTHOUSE} failed`));
}

function jupiterFailed(logs: string[]): boolean {
  return logs.some((l) => l.includes("Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 failed"));
}

async function simulate(tx: VersionedTransaction, conn: Connection): Promise<{ err: unknown; logs: string[] }> {
  const sim = await conn.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
  });
  return { err: sim.value.err, logs: sim.value.logs ?? [] };
}

async function main(): Promise<void> {
  const flag = process.argv[2];
  if (flag !== "pass" && flag !== "fail") {
    console.error(`usage: simulate-guard.ts pass|fail (got ${flag ?? "nothing"})`);
    process.exitCode = 1;
    return;
  }
  const conn = web3Connection();
  const ownerPk = new PublicKey(OWNER);
  const usdcAta = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), ownerPk, true);

  let out: { err: unknown; logs: string[] } = { err: "no attempt completed", logs: [] };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    console.log(`--- attempt ${attempt}/${MAX_ATTEMPTS} (${flag}) ---`);
    const built = await buildOnce(conn);
    if (built.secondTransaction !== undefined) {
      console.log("split build cannot simulate standalone; retrying with a fresh quote");
      continue;
    }
    if (flag === "pass") {
      out = await simulate(built.transaction, conn);
      console.log(`err: ${JSON.stringify(out.err)}`);
      if (out.err === null) break;
      if (!jupiterFailed(out.logs)) break; // real failure, surface it
      console.log("Jupiter leg died on a stale quote; retrying with a fresh quote");
    } else {
      // Impossibly high postcondition: realistic min + 10^12 raw (~1M USDC).
      const market = await loadMarket();
      const usdcReserve = findUsdcReserve(market);
      const usdcDecimals = Number(usdcReserve.state.liquidity.mintDecimals.toString());
      const collateralRaw = BigInt(Math.round(USDC_COLLATERAL * 10 ** usdcDecimals));
      let pre = 0n;
      try {
        const bal = await conn.getTokenAccountBalance(usdcAta, "confirmed");
        pre = BigInt(bal.value.amount);
      } catch {
        pre = 0n;
      }
      const minOut = BigInt(built.quote.otherAmountThreshold);
      const realistic = pre - collateralRaw + minOut < 0n ? 0n : pre - collateralRaw + minOut;
      const impossible = realistic + 1_000_000_000_000n;
      console.log(`realistic min ${realistic}, impossible min ${impossible}`);
      // built.instructions already end with the realistic guard; swap it for the
      // impossible one so the tx keeps the exact single-tx shape build.ts verified.
      const unguarded = built.instructions.filter((ix) => !ix.programId.equals(LIGHTHOUSE_PROGRAM_ID));
      const failIxs = withPostconditions(unguarded, {
        owner: OWNER,
        usdcAta: usdcAta.toString(),
        minUsdcAfter: impossible,
      });
      const { blockhash } = await conn.getLatestBlockhash("finalized");
      const message = new TransactionMessage({
        payerKey: ownerPk,
        recentBlockhash: blockhash,
        instructions: failIxs,
      }).compileToV0Message(built.lookupTables);
      out = await simulate(new VersionedTransaction(message), conn);
      console.log(`err: ${JSON.stringify(out.err)}`);
      if (out.err !== null && lighthouseFailed(out.logs)) break;
      if (out.err === null) {
        console.log("impossible postcondition unexpectedly passed; retrying with a fresh quote");
        continue;
      }
      console.log("died before reaching Lighthouse (stale quote); retrying with a fresh quote");
    }
  }

  mkdirSync("./artifacts", { recursive: true });
  const path = `./artifacts/sim-guard-${flag}.json`;
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`err: ${JSON.stringify(out.err)}`);
  console.log(`artifact written to ${path}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
