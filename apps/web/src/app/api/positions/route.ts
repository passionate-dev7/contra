import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { readObligation } from "@/lib/obligation";

export const dynamic = "force-dynamic";

/** GET /api/positions?owner=<address>. Live obligation for that owner on the
 * xStocks market: deposits, borrows, and the per-short entry-context/live-mark
 * view the positions page renders. Returns `null` (not an error) when the
 * owner has no obligation here yet -- a genuinely empty state. */
export async function GET(request: Request) {
  const owner = new URL(request.url).searchParams.get("owner")?.trim() ?? "";
  if (owner === "") {
    return NextResponse.json({ error: "owner is required" }, { status: 400 });
  }
  try {
    new PublicKey(owner);
  } catch {
    return NextResponse.json({ error: `"${owner}" is not a valid Solana address` }, { status: 400 });
  }
  try {
    const view = await readObligation(owner);
    return NextResponse.json(view);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
