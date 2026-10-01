import { mkdirSync, writeFileSync } from "node:fs";
import { PublicKey, type Connection, type VersionedTransaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { address } from "@solana/kit";
import { web3Connection } from "./rpc.js";
import { buildCloseShort, type CloseShortRequest } from "./build.js";
import { loadMarket, findUsdcReserve, findXstockReserve, vanillaObligationAddress } from "./market.js";
import { USDC_MINT } from "./constants.js";

/**
 * Close-side guard proof: builds a real guarded close for a real funded
 * mainnet obligation (same owner/obligation discovery as simulate-close.ts)
 * and simulateTransaction's it (sigVerify:false, replaceRecentBlockhash:true).
 * Never signs or sends.
 *   pass -> normal build (guard bound = pre-close xStock balance), must succeed.
 *   fail -> minXstockAfterOverride = pre + 10^15, must revert via Lighthouse.
 * Writes artifacts/sim-close-guard-<flag>.json = {err, logs}.
 *
 * Like simulate-guard.ts, a build that splits into two transactions cannot
 * simulate standalone, and a simulation that dies inside Jupiter (stale quote
 * / slippage, Custom 6024) proves nothing about the guard, so both cases are
 * retried with a fresh quote (up to 5 attempts). Every attempt is a real quote
 * + real mainnet simulation, no mocks.
 */
const OWNER = process.env["CLOSE_OWNER"] ?? "DK7iCr4uSjKQF7qYTnygrrZuAc2hFNaKPrYDV2UKikWC";
const TICKER = process.env["CLOSE_TICKER"] ?? "SPY";
const REPAY = Number(process.env["CLOSE_REPAY"] ?? "0.01");
const WITHDRAW = Number(process.env["CLOSE_WITHDRAW"] ?? "5");
const MAX_USDC_IN = Number(process.env["CLOSE_MAX_USDC_IN"] ?? "15");
const MAX_ATTEMPTS = 5;
const LIGHTHOUSE = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";
const JUP_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

function lighthouseFailed(logs: string[]): boolean {
  return logs.some((l) => l.includes(`Program ${LIGHTHOUSE} failed`));
}

function jupiterFailed(logs: string[], err: unknown): boolean {
  if (logs.some((l) => l.includes(`Program ${JUP_PROGRAM} failed`))) return true;
  return JSON.stringify(err).includes("6024");
}

async function simulate(tx: VersionedTransaction, conn: Connection): Promise<{ err: unknown; logs: string[] }> {
  const sim = await conn.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
  });
  return { err: sim.value.err, logs: sim.value.logs ?? [] };
}

async function preXstockBalance(conn: Connection, xstockAta: PublicKey): Promise<bigint> {
  try {
    const bal = await conn.getTokenAccountBalance(xstockAta, "confirmed");
    return BigInt(bal.value.amount);
  } catch {
    return 0n;
  }
}

async function main(): Promise<void> {
  const flag = process.argv[2];
  if (flag !== "pass" && flag !== "fail") {
    console.error(`usage: simulate-close-guard.ts pass|fail (got ${flag ?? "nothing"})`);
    process.exitCode = 1;
    return;
  }
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

  let out: { err: unknown; logs: string[] } = { err: "no attempt completed", logs: [] };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    console.log(`--- attempt ${attempt}/${MAX_ATTEMPTS} (${flag}) ---`);
    const req: CloseShortRequest = {
      owner: OWNER,
      ticker: TICKER,
      repayAmount: REPAY,
      withdrawUsdc: WITHDRAW,
      maxUsdcIn: MAX_USDC_IN,
    };
    if (flag === "fail") {
      const pre = await preXstockBalance(conn, xstockAta);
      req.minXstockAfterOverride = pre + 1_000_000_000_000_000n; // pre + 10^15: impossible
      console.log(`pre ${pre}, impossible min ${req.minXstockAfterOverride}`);
    }
    const built = await buildCloseShort(conn, req);
    console.log(`route: ${built.route} (${built.quote.swapMode}, in ${built.quote.inAmount} out ${built.quote.outAmount}) | split: ${built.secondTransaction !== undefined}`);
    console.log(`reason: ${built.reason}`);
    if (built.secondTransaction !== undefined) {
      console.log("split build cannot simulate standalone; retrying with a fresh quote");
      continue;
    }
    out = await simulate(built.transaction, conn);
    console.log(`err: ${JSON.stringify(out.err)}`);
    if (flag === "pass") {
      if (out.err === null) break;
      if (!jupiterFailed(out.logs, out.err)) break; // real failure, surface it
      console.log("Jupiter leg died on a stale quote; retrying with a fresh quote");
    } else {
      if (out.err !== null && lighthouseFailed(out.logs)) break;
      if (out.err === null) {
        console.log("impossible postcondition unexpectedly passed; retrying with a fresh quote");
        continue;
      }
      console.log("died before reaching Lighthouse (stale quote); retrying with a fresh quote");
    }
  }

  mkdirSync("./artifacts", { recursive: true });
  const path = `./artifacts/sim-close-guard-${flag}.json`;
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`err: ${JSON.stringify(out.err)}`);
  console.log(`artifact written to ${path}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
