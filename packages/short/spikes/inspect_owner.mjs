import { address } from "@solana/kit";
import { KaminoMarket, DEFAULT_RECENT_SLOT_DURATION_MS, getCurrentLedgerInstant } from "@kamino-finance/klend-sdk";
import { createSolanaRpc } from "@solana/kit";
import { Connection, PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";

const RPC = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const rpc = createSolanaRpc(RPC);
const conn = new Connection(RPC, "confirmed");
const MARKET = "5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua";
const OWNER = process.argv[2];

const market = await KaminoMarket.load(rpc, address(MARKET), DEFAULT_RECENT_SLOT_DURATION_MS);
const instant = await getCurrentLedgerInstant(rpc);
const obligations = await market.getAllObligationsForMarket(instant);
const o = obligations.find(x => x.state.owner.toString() === OWNER);
console.log("owner", OWNER);
console.log("obligation address", o.obligationAddress.toString());
for (const d of o.getDeposits()) {
  const r = market.getReserveByAddress(d.reserveAddress);
  const dec = Number(r.state.liquidity.mintDecimals.toString());
  console.log("deposit", r.getTokenSymbol(), new Decimal(d.amount.toString()).div(new Decimal(10).pow(dec)).toFixed(4));
}
for (const b of o.getBorrows()) {
  const r = market.getReserveByAddress(b.reserveAddress);
  console.log("borrow", r.getTokenSymbol(), b.amount.toString());
}
console.log("stats loanToValue", o.refreshedStats.loanToValue.toString());
console.log("stats liquidationLtv", o.refreshedStats.liquidationLtv.toString());
console.log("stats userTotalDeposit", o.refreshedStats.userTotalDeposit.toString());

const bal = await conn.getTokenAccountsByOwner(new PublicKey(OWNER), { mint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") });
console.log("USDC ATAs:", bal.value.length);
for (const v of bal.value) {
  const info = await conn.getParsedAccountInfo(v.pubkey);
  console.log(v.pubkey.toString(), info.value.data.parsed.info.tokenAmount.uiAmountString);
}
