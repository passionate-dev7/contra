import { address } from "@solana/kit";
import { KaminoMarket, DEFAULT_RECENT_SLOT_DURATION_MS, getCurrentLedgerInstant } from "@kamino-finance/klend-sdk";
import { createSolanaRpc } from "@solana/kit";
import { Connection, PublicKey } from "@solana/web3.js";

const RPC = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const rpc = createSolanaRpc(RPC);
const conn = new Connection(RPC, "confirmed");
const MARKET = "5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua";

const market = await KaminoMarket.load(rpc, address(MARKET), DEFAULT_RECENT_SLOT_DURATION_MS);
const instant = await getCurrentLedgerInstant(rpc);
const obligations = await market.getAllObligationsForMarket(instant);
console.log("total obligations:", obligations.length);

const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
let checked = 0;
for (const o of obligations) {
  const deposits = o.getDeposits();
  const borrows = o.getBorrows();
  if (deposits.length === 0) continue;
  const hasUsdcDeposit = deposits.some(d => market.getReserveByAddress(d.reserveAddress)?.getLiquidityMint().toString() === usdcMint);
  if (!hasUsdcDeposit) continue;
  const owner = o.state.owner.toString();
  const bal = await conn.getBalance(new PublicKey(owner));
  checked++;
  console.log(owner, "SOL:", bal / 1e9, "deposits:", deposits.length, "borrows:", borrows.length);
  if (checked >= 15) break;
}
