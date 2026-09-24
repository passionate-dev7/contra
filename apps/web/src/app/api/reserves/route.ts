import { NextResponse } from "next/server";
import { readReserveRows, toPublicRow } from "@/lib/reserves";

export const dynamic = "force-dynamic";

/** GET /api/reserves. Live reserve config for every reserve in the xStocks
 * market, borrowable computed from the deployed borrowLimit/available
 * liquidity, not hardcoded. Returns the bare array the ticket and blotter
 * both read directly. */
export async function GET() {
  try {
    const rows = await readReserveRows();
    return NextResponse.json(rows.map(toPublicRow));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
