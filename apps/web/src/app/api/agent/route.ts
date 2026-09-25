import { NextResponse } from "next/server";
import { agentTick } from "@/lib/agent";

export const dynamic = "force-dynamic";

/** GET /api/agent?owner=<address optional>. Runs one autonomous short-agent
 * tick live and returns the decision log as JSON. Never signs anything. */
export async function GET(request: Request) {
  const owner = new URL(request.url).searchParams.get("owner")?.trim() || undefined;
  try {
    return NextResponse.json(await agentTick({ owner }), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
