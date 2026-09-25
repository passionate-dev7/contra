import { NextResponse } from "next/server";
import { isValidHedgeOwner, readHedge, toPublicHedge } from "@/lib/hedge";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const owner = new URL(request.url).searchParams.get("owner")?.trim() ?? "";
  if (!owner) return NextResponse.json({ error: "owner is required" }, { status: 400 });
  if (!isValidHedgeOwner(owner)) return NextResponse.json({ error: "owner must be a valid Solana address" }, { status: 400 });

  try {
    const analysis = await readHedge(owner);
    return NextResponse.json(toPublicHedge(analysis));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
