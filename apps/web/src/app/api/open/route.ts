import { NextResponse } from "next/server";
import { web3Connection, loadMarket, findUsdcReserve, findXstockReserve, buildOpenShort, resolveEquityFeed, MarketClosedError } from "@contra/short";

export const dynamic = "force-dynamic";

interface OpenBody {
  owner: string;
  ticker: string;
  usdcCollateral: string; // raw USDC base units, e.g. "500000" = 0.5 USDC
  borrowRaw: string; // raw xStock base units to borrow
}

function baseTicker(ticker: string): string {
  return /x$/i.test(ticker) ? ticker.slice(0, -1) : ticker;
}

/** POST /api/open {owner, ticker, usdcCollateral, borrowRaw} -> {transactions:[base64,...]}
 * Builds the deposit+borrow+sell transaction via packages/short's buildOpenShort.
 * Never signs or sends: the wallet does that in the browser. */
export async function POST(req: Request) {
  let body: OpenBody;
  try {
    body = (await req.json()) as OpenBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { owner, ticker, usdcCollateral, borrowRaw } = body;
  if (!owner || !ticker || !usdcCollateral || !borrowRaw) {
    return NextResponse.json({ error: "owner, ticker, usdcCollateral, borrowRaw are required" }, { status: 400 });
  }
  try {
    const feed = await resolveEquityFeed(baseTicker(ticker));
    if (!feed.isOpen) throw new MarketClosedError(baseTicker(ticker), feed.nextOpenUnix);
    const market = await loadMarket();
    const usdcReserve = findUsdcReserve(market);
    const xstockReserve = findXstockReserve(market, baseTicker(ticker));
    const usdcDecimals = Number(usdcReserve.state.liquidity.mintDecimals.toString());
    const xstockDecimals = Number(xstockReserve.state.liquidity.mintDecimals.toString());

    const built = await buildOpenShort(web3Connection(), {
      owner,
      ticker: baseTicker(ticker),
      usdcCollateral: Number(usdcCollateral) / 10 ** usdcDecimals,
      borrowAmount: Number(borrowRaw) / 10 ** xstockDecimals,
    });

    const transactions = [Buffer.from(built.transaction.serialize()).toString("base64")];
    if (built.secondTransaction) {
      transactions.push(Buffer.from(built.secondTransaction.serialize()).toString("base64"));
    }
    return NextResponse.json({ transactions, route: built.route, reason: built.reason });
  } catch (err) {
    const status = err instanceof MarketClosedError ? 409 : 502;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
