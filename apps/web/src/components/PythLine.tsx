/* Hallmark · component: fair-value line · genre: editorial · theme: clearinghouse ledger (DESIGN.md locked)
 * states: default · hover · focus · active · disabled · loading · error · success — text-only line: loading and error rendered, hover/focus/active/disabled n/a (no interaction)
 * contrast: pass (40-41) — ink-dim and negative on paper-raised, same pairs as the ticket body
 */
"use client";

import { useEffect, useState } from "react";
import { fmtUsd } from "@/lib/format";
import { canonicalXstockSymbol, type PythFair } from "@/lib/pyth-shared";

const ENTITLED = new Set(["TSLAX", "QQQX"]);
const WARN_GAP_BPS = 100;

type FetchState =
  | { status: "loading" }
  | { status: "ready"; data: PythFair }
  | { status: "error"; message: string };

function equityLabel(canonical: string): string {
  return canonical.endsWith("x") ? canonical.slice(0, -1).toUpperCase() : canonical.toUpperCase();
}

function formatGap(gapBps: number): string {
  const rounded = Math.round(gapBps);
  return `${rounded >= 0 ? "+" : ""}${rounded} bps`;
}

/** One fair-value line inside the order ticket: live Pyth price with its
 * confidence and publish time, the Jupiter sell price per share, and the gap
 * in bps. Tickers outside the Pyth plan get the plan note in muted text.
 * Every fetch renders loading and error states, never a blank gap. */
export function PythLine({ ticker, initial }: { ticker: string; initial: PythFair | null }) {
  const canonical = canonicalXstockSymbol(ticker);
  const entitled = ENTITLED.has(canonical.toUpperCase());
  const [state, setState] = useState<FetchState>(() =>
    initial !== null && initial.ticker === canonical && initial.pythPrice !== null
      ? { status: "ready", data: initial }
      : { status: "loading" },
  );

  useEffect(() => {
    if (!entitled) return;
    if (initial !== null && initial.ticker === canonical && initial.pythPrice !== null) {
      setState({ status: "ready", data: initial });
      return;
    }
    let live = true;
    setState({ status: "loading" });
    fetch(`/api/pyth?ticker=${encodeURIComponent(canonical)}`)
      .then(async (res) => {
        const body = (await res.json()) as PythFair & { error?: string };
        if (!res.ok) throw new Error(body.error ?? `fair value request failed: ${res.status}`);
        return body;
      })
      .then((data) => {
        if (live) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      live = false;
    };
  }, [canonical, entitled, initial]);

  if (!entitled) {
    return (
      <p className="font-[family-name:var(--font-mono)] text-xs tabular text-[var(--ink-dim)]">
        No Pyth feed for {canonical} in the current plan (TSLAx and QQQx only), so no fair-value gap in bps is
        shown.
      </p>
    );
  }

  if (state.status === "loading") {
    return (
      <p aria-live="polite" className="font-[family-name:var(--font-mono)] text-xs tabular text-[var(--ink-dim)]">
        Reading Pyth fair value…
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <p className="font-[family-name:var(--font-mono)] text-xs tabular text-[var(--ink-dim)]">
        Pyth cross-check unavailable: {state.message}
      </p>
    );
  }

  const data = state.data;
  if (data.pythPrice === null || data.jupiterSellPrice === null || data.gapBps === null || data.publishTime === null) {
    return (
      <p className="font-[family-name:var(--font-mono)] text-xs tabular text-[var(--ink-dim)]">
        {data.reason ?? `No Pyth feed for ${canonical} in the current plan (TSLAx and QQQx only).`}
      </p>
    );
  }

  const warn = Math.abs(data.gapBps) > WARN_GAP_BPS;
  const published = new Date(data.publishTime * 1000).toISOString().slice(11, 16);
  const confidence = data.confidence !== null ? ` ±${fmtUsd(data.confidence)}` : "";

  return (
    <p
      className={`font-[family-name:var(--font-mono)] text-xs tabular ${
        warn ? "text-[var(--negative)]" : "text-[var(--ink-dim)]"
      }`}
    >
      Pyth {equityLabel(canonical)} {fmtUsd(data.pythPrice)}
      {confidence} (published {published} UTC) · you sell at {fmtUsd(data.jupiterSellPrice)},{" "}
      {formatGap(data.gapBps)} from Pyth{warn ? ". Selling far below fair value." : ""}
    </p>
  );
}
