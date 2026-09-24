// Scan the xStocks market for obligations that already borrow an xStock AND hold a USDC deposit,
// then read each owner's USDC ATA and SOL balance. Candidates for a close-short simulation.
import { address, createSolanaRpc } from "@solana/kit";
import { KaminoMarket, DEFAULT_RECENT_SLOT_DURATION_MS, getCurrentLedgerInstant } from "@kamino-finance/klend-sdk";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

const RPC = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const rpc = createSolanaRpc(RPC);
const conn = new Connection(RPC, "confirmed");
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const market = await KaminoMarket.load(rpc, address("5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua"), DEFAULT_RECENT_SLOT_DURATION_MS);
const obligations = await market.getAllObligationsForMarket(await getCurrentLedgerInstant(rpc));
console.log("total obligations:", obligations.length);
const sym = (a) => market.getReserveByAddress(a)?.getTokenSymbol();
const cands = obligations.filter((o) =>
  o.getBorrows().some((b) => /x$/.test(sym(b.reserveAddress) ?? "")) &&
  o.getDeposits().some((d) => sym(d.reserveAddress) === "USDC"));
console.log("xStock-borrow + USDC-deposit obligations:", cands.length);
const retry = async (f, n = 5) => { for (let i = 0; ; i++) { try { return await f(); } catch (e) { if (i >= n) throw e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); } } };
const rows = [];
for (let i = 0; i < cands.length; i += 100) {
  const chunk = cands.slice(i, i + 100);
  const atas = chunk.map((o) => getAssociatedTokenAddressSync(new PublicKey(USDC), new PublicKey(o.state.owner.toString()), true));
  const infos = await retry(() => conn.getMultipleAccountsInfo(atas));
  const sols = await retry(() => conn.getMultipleAccountsInfo(chunk.map((o) => new PublicKey(o.state.owner.toString()))));
  chunk.forEach((o, j) => {
    const usdc = infos[j] ? Number(infos[j].data.readBigUInt64LE(64)) / 1e6 : 0;
    const sol = sols[j] ? sols[j].lamports / 1e9 : 0;
    rows.push({ owner: o.state.owner.toString(), obligation: o.obligationAddress.toString(), usdc, sol, ltv: o.loanToValue().toFixed(3), maxLtv: o.refreshedStats.borrowLimit.div(o.refreshedStats.userTotalDeposit).toFixed(3),
      borrows: o.getBorrows().map((b) => `${sym(b.reserveAddress)}:${b.amount.div(10 ** 8).toFixed(6)}`).join(","),
      deposits: o.getDeposits().map((d) => `${sym(d.reserveAddress)}:${d.marketValueRefreshed.toFixed(2)}$`).join(","), tag: o.state.tag.toString() });
  });
}
rows.sort((a, b) => b.usdc - a.usdc);
for (const r of rows.filter((r) => r.usdc >= 2 && r.sol >= 0.01).slice(0, 15)) console.log(JSON.stringify(r));
