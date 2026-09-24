"use client";

import { useState } from "react";
import { ArrowClockwise, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { fmtPct, fmtNum } from "@/lib/format";
import type { PublicReserveRow } from "@/lib/types";

type FetchState = "idle" | "loading" | "error";

export function Blotter({ initialRows }: { initialRows: PublicReserveRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [state, setState] = useState<FetchState>("idle");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setState("loading");
    setError(null);
    try {
      const res = await fetch("/api/reserves", { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `reserves fetch failed: ${res.status}`);
      }
      const next = (await res.json()) as PublicReserveRow[];
      setRows(next);
      setState("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }

  const xstocks = rows.filter((r) => r.isXstock);

  return (
    <section className="border border-[var(--rule-strong)] bg-[var(--paper-raised)] rounded-[var(--radius-ticket)]">
      <div className="flex items-center justify-between border-b border-[var(--rule)] px-4 py-3">
        <h2 className="font-[family-name:var(--font-display)] text-lg">The blotter</h2>
        <button
          type="button"
          onClick={refresh}
          disabled={state === "loading"}
          className="press-scale flex items-center gap-1.5 text-sm text-[var(--ink-dim)] hover:text-[var(--ink)] disabled:opacity-50"
        >
          <ArrowClockwise size={14} className={state === "loading" ? "animate-spin" : undefined} weight="bold" />
          Refresh
        </button>
      </div>

      {state === "error" && (
        <div className="flex items-start gap-2 border-b border-[var(--rule)] bg-[var(--negative)]/5 px-4 py-3 text-sm text-[var(--negative)]">
          <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0" />
          <span>Could not refresh the reserve table: {error}</span>
        </div>
      )}

      {xstocks.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-[var(--ink-dim)]">
          No xStock reserves were returned by the market. The RPC endpoint may be unreachable.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--rule)] text-left text-xs uppercase tracking-wide text-[var(--ink-dim)]">
                <th className="px-4 py-2 font-medium">Symbol</th>
                <th className="px-4 py-2 font-medium text-right">Max LTV</th>
                <th className="hidden px-4 py-2 font-medium text-right sm:table-cell">Liq. LTV</th>
                <th className="hidden px-4 py-2 font-medium text-right sm:table-cell">Borrow APY</th>
                <th className="hidden px-4 py-2 font-medium text-right md:table-cell">Available</th>
                <th className="px-4 py-2 font-medium text-right">Status</th>
              </tr>
            </thead>
            <tbody className="font-[family-name:var(--font-mono)] tabular">
              {xstocks.map((r) => (
                <tr key={r.symbol} className="border-b border-[var(--rule)] last:border-0">
                  <td className="px-4 py-2.5 font-[family-name:var(--font-body)] font-medium">{r.symbol}</td>
                  <td className="px-4 py-2.5 text-right">{fmtPct(r.maxLtv, 0)}</td>
                  <td className="hidden px-4 py-2.5 text-right sm:table-cell">{fmtPct(r.liqLtv, 0)}</td>
                  <td className="hidden px-4 py-2.5 text-right sm:table-cell">{fmtPct(r.borrowApy * 100)}</td>
                  <td className="hidden px-4 py-2.5 text-right md:table-cell">{fmtNum(Number(r.availableRaw) / 10 ** r.decimals, 2)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {r.borrowable ? (
                      <span className="inline-flex items-center gap-1 text-[var(--positive)]">
                        <CheckCircle size={14} weight="fill" />
                        <span className="hidden sm:inline">borrowable</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[var(--negative)]" title={r.reason}>
                        <WarningCircle size={14} weight="fill" />
                        <span className="hidden sm:inline">{r.reason}</span>
                        <span className="sm:hidden">blocked</span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
