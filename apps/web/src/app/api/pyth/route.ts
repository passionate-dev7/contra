import { NextResponse } from "next/server";
import { readPythFair } from "@/lib/pyth-fair";

export const dynamic = "force-dynamic";

/** GET /api/pyth?ticker=<xStock>. Live Pyth fair value for the entitled
 * equity feeds (TSLAx, QQQx) plus the small-size Jupiter sell price per
 * displayed share and the gap in bps. Tickers without an entitled feed
 * return nulls with the plan stated, never a fabricated price. */
export async function GET(request: Request) {
  const ticker = new URL(request.url).searchParams.get("ticker")?.trim() ?? "";
  if (ticker === "") {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }
  try {
    return NextResponse.json(await readPythFair(ticker));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
