// Independent check: /api/positions returns the borrow amount for a real
// obligation matching a direct on-chain decode (klend-sdk's own compiled
// account layout, not this repo's apps/web/src/lib/obligation.ts math), and
// the /positions page renders it. Then proves the check can fail: a fresh,
// never-used owner must report an empty obligation (null + the named empty
// state), not a fabricated match. Needs SOLANA_RPC_URL (falls back to the
// public mainnet endpoint, which works but can be slow/rate-limited).
//
// Deliberately imports only compiled JS (klend-sdk, @solana/kit,
// @solana/web3.js), never "@contra/short" or apps/web's own TypeScript, so
// this runs under plain `node` and never shares code with the thing it's
// checking.
import { withApp, text } from "./serve.mjs";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { createSolanaRpc, address } from "@solana/kit";
import { KaminoMarket, VanillaObligation, DEFAULT_RECENT_SLOT_DURATION_MS, Obligation } from "@kamino-finance/klend-sdk";

const OWNER = process.env.POSITIONS_OWNER ?? "DK7iCr4uSjKQF7qYTnygrrZuAc2hFNaKPrYDV2UKikWC";
const XSTOCKS_MARKET = "5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua";
const TICKER = "SPY";
const PORT = 3173;
const SF_SCALE = 2n ** 60n; // Kamino's fixed-point scale for *Sf fields (Fraction.FRACTIONS)
const rpcUrl = process.env.SOLANA_RPC_URL || process.env.RPC_URL || "https://api.mainnet-beta.solana.com";

async function independentRead() {
  const rpc = createSolanaRpc(rpcUrl);
  const market = await KaminoMarket.load(rpc, address(XSTOCKS_MARKET), DEFAULT_RECENT_SLOT_DURATION_MS);
  if (market === null) throw new Error(`Kamino market ${XSTOCKS_MARKET} not found`);
  const xstock = market.getReserves().find((r) => r.getTokenSymbol() === `${TICKER}x`);
  if (xstock === undefined) throw new Error(`no ${TICKER}x reserve in market ${XSTOCKS_MARKET}`);
  const decimals = Number(xstock.state.liquidity.mintDecimals.toString());
  const obligationPda = (await new VanillaObligation(market.programId).toPda(market.getAddress(), address(OWNER))).toString();

  const conn = new Connection(rpcUrl, "confirmed");
  const info = await conn.getAccountInfo(new PublicKey(obligationPda));
  if (info === null) {
    throw new Error(`no on-chain obligation for ${OWNER} at ${obligationPda}; the default OWNER may need updating`);
  }
  const decoded = Obligation.decode(info.data);
  const entry = decoded.borrows.find((b) => b.borrowReserve.toString() === xstock.address.toString());
  if (entry === undefined) {
    throw new Error(`owner ${OWNER} has no ${TICKER}x borrow on-chain right now; pick a different owner`);
  }
  const rawUnits = BigInt(entry.borrowedAmountSf.toString()) / SF_SCALE;
  return { symbol: `${TICKER}x`, uiAmount: Number(rawUnits) / 10 ** decimals, rawUnits };
}

const onChain = await independentRead();
console.log(`independent on-chain read: ${OWNER} owes ${onChain.uiAmount} ${onChain.symbol} (raw ${onChain.rawUnits})`);

await withApp("@contra/web", PORT, async (get) => {
  // --- red case first: a freshly generated owner has never touched this market ---
  const emptyOwner = Keypair.generate().publicKey.toBase58();
  const emptyBody = await (await get(`/api/positions?owner=${emptyOwner}`)).json();
  if (emptyBody !== null) {
    throw new Error(`RED expected: a fresh owner must return null, got ${JSON.stringify(emptyBody).slice(0, 200)}`);
  }
  const emptyHtml = text(await (await get(`/positions?owner=${emptyOwner}`)).text());
  if (!/No obligation for/i.test(emptyHtml)) {
    throw new Error("RED expected: /positions must show the named empty state for an owner with no obligation");
  }
  console.log(`red case ok: fresh owner ${emptyOwner} correctly reports empty (null + named empty state), not a fabricated match`);

  // --- green case: the real owner's borrow must match the independent decode ---
  const body = await (await get(`/api/positions?owner=${OWNER}`)).json();
  if (body === null) throw new Error(`GREEN expected: /api/positions returned null for a known-funded owner ${OWNER}`);
  const short = (body.shorts ?? []).find((s) => s.symbol === onChain.symbol);
  if (short === undefined) {
    throw new Error(`GREEN expected: /api/positions has no ${onChain.symbol} short for ${OWNER}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  // This owner is a real, actively-traded mainnet wallet: its borrow can move
  // (interest accrual, or the owner's own repay/borrow) in the seconds
  // between the independent read above and the app's build+boot+fetch below.
  // 10% covers that live drift while still catching the bug this check
  // exists for -- the amount was off by 10**decimals (a ~1e8x error) before
  // obligation.ts's toLine() divided by the mint's decimals.
  const diff = Math.abs(short.rawUnitAmount - onChain.uiAmount) / onChain.uiAmount;
  if (diff > 0.1) {
    throw new Error(`GREEN expected: api rawUnitAmount ${short.rawUnitAmount} vs on-chain ${onChain.uiAmount}, diff ${(diff * 100).toFixed(4)}% too large`);
  }
  console.log(`green case ok: /api/positions ${onChain.symbol} amount ${short.rawUnitAmount} matches on-chain read ${onChain.uiAmount} within ${(diff * 100).toFixed(4)}%`);

  const html = text(await (await get(`/positions?owner=${OWNER}`)).text());
  if (!new RegExp(onChain.symbol, "i").test(html)) {
    throw new Error(`GREEN expected: /positions page must render ${onChain.symbol} for ${OWNER}`);
  }
  console.log(`green case ok: /positions page renders the ${onChain.symbol} short for ${OWNER}`);

  // Regression guard: obligation.ts's loanToValuePct/liquidationLtvPct are
  // 0-100 percents, not 0-1 fractions. A caller that forgets to scale renders
  // "0.64%" instead of "64%" -- catch that here, not just eyeball it.
  const ltvMatch = html.match(/\bLTV\s*(\d+(?:\.\d+)?)%/i);
  if (!ltvMatch) throw new Error("GREEN expected: /positions must render an LTV percent");
  const ltvPct = Number(ltvMatch[1]);
  if (!(ltvPct >= 1 && ltvPct <= 100)) {
    throw new Error(`GREEN expected: LTV must render as a real percent between 1 and 100, got ${ltvPct}% (an unscaled 0-1 fraction would show up here as < 1)`);
  }
  console.log(`green case ok: LTV renders as ${ltvPct}%, not a raw 0-1 fraction`);

  if (!/Healthy: LTV \d+(?:\.\d+)?% is below the \d+(?:\.\d+)?% liquidation threshold|Near liquidation: LTV|at or past its liquidation LTV/.test(html)) {
    throw new Error("GREEN expected: /positions must render the health wording (Healthy: LTV .../ Near liquidation: .../ at or past its liquidation LTV)");
  }
  console.log("green case ok: health wording present");
});
