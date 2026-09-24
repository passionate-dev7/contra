import { NextResponse } from "next/server";
import { web3Connection, loadMarket, findUsdcReserve, findXstockReserve, buildCloseShort } from "@contra/short";

export const dynamic = "force-dynamic";

interface CloseBody {
  owner: string;
  ticker: string;
  repayRaw: string; // raw xStock base units to repay (borrowed + accrued interest)
  withdrawRaw: string; // raw USDC base units to withdraw back out
  maxUsdcInRaw: string; // raw USDC base units budget to buy back the xStock
}

function baseTicker(ticker: string): string {
  return /x$/i.test(ticker) ? ticker.slice(0, -1) : ticker;
}

/** POST /api/close {owner, ticker, repayRaw, withdrawRaw, maxUsdcInRaw} ->
 * {transactions:[base64,...]}. Buys back the xStock through Jupiter, repays
 * the Kamino borrow, withdraws the USDC collateral. */
export async function POST(req: Request) {
  let body: CloseBody;
  try {
    body = (await req.json()) as CloseBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { owner, ticker, repayRaw, withdrawRaw, maxUsdcInRaw } = body;
  if (!owner || !ticker || !repayRaw || !withdrawRaw || !maxUsdcInRaw) {
    return NextResponse.json({ error: "owner, ticker, repayRaw, withdrawRaw, maxUsdcInRaw are required" }, { status: 400 });
  }
  try {
    const market = await loadMarket();
    const usdcReserve = findUsdcReserve(market);
    const xstockReserve = findXstockReserve(market, baseTicker(ticker));
    const usdcDecimals = Number(usdcReserve.state.liquidity.mintDecimals.toString());
    const xstockDecimals = Number(xstockReserve.state.liquidity.mintDecimals.toString());

    const built = await buildCloseShort(web3Connection(), {
      owner,
      ticker: baseTicker(ticker),
      repayAmount: Number(repayRaw) / 10 ** xstockDecimals,
      withdrawUsdc: Number(withdrawRaw) / 10 ** usdcDecimals,
      maxUsdcIn: Number(maxUsdcInRaw) / 10 ** usdcDecimals,
    });

    const transactions = [Buffer.from(built.transaction.serialize()).toString("base64")];
    if (built.secondTransaction) {
      transactions.push(Buffer.from(built.secondTransaction.serialize()).toString("base64"));
    }
    return NextResponse.json({ transactions, route: built.route, reason: built.reason });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
