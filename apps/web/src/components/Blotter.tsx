"use client";

import { useMemo, useState } from "react";
import { ArrowClockwise, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { fmtPct, fmtNum, fmtUsd } from "@/lib/format";
import type { PublicReserveRow } from "@/lib/types";

type FetchState = "idle" | "loading" | "error";

/** Snapshot stats derived entirely from already-fetched reserve rows: the
 * borrow APY spread and the total available liquidity across borrowable
 * xStocks, priced at each reserve's own oracle. Nothing here is a separate
 * fetch or a fabricated figure. */
function snapshot(xstocks: PublicReserveRow[]) {
  const borrowable = xstocks.filter((r) => r.borrowable);
  if (borrowable.length === 0) return null;
  const apys = borrowable.map((r) => r.borrowApy * 100);
  const liquidityUsd = borrowable.reduce((sum, r) => {
    if (r.priceUsd === null) return sum;
    return sum + (Number(r.availableRaw) / 10 ** r.decimals) * r.priceUsd;
  }, 0);
  return { minApy: Math.min(...apys), maxApy: Math.max(...apys), liquidityUsd };
}

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
  const stats = useMemo(() => snapshot(xstocks), [xstocks]);

  return (
    <section aria-busy={state === "loading"} className="order-2 rounded-[var(--radius-ticket)] border border-[var(--rule-strong)] bg-[var(--paper-raised)] lg:order-1">
      <div className="flex items-center justify-between border-b border-[var(--rule)] px-4 py-3">
        <h2 className="font-[family-name:var(--font-display)] text-lg">The blotter</h2>
        <button
          type="button"
          onClick={refresh}
          disabled={state === "loading"}
          className="press-scale flex items-center gap-1.5 text-sm text-[var(--ink-dim)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ArrowClockwise size={14} aria-hidden="true" className={state === "loading" ? "animate-spin motion-reduce:animate-none" : undefined} weight="bold" />
          Refresh
        </button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 divide-x divide-[var(--rule)] border-b border-[var(--rule)] font-[family-name:var(--font-mono)] tabular sm:grid-cols-2">
          <div className="px-4 py-3">
            <div className="text-base font-medium">{fmtPct(stats.minApy)} - {fmtPct(stats.maxApy)}</div>
            <div className="mt-0.5 text-[11px] uppercase tracking-[0.08em] text-[var(--ink-dim)] font-[family-name:var(--font-body)]">Borrow APY range</div>
          </div>
          <div className="px-4 py-3">
            <div className="text-base font-medium">{fmtUsd(stats.liquidityUsd, 0)}</div>
            <div className="mt-0.5 text-[11px] uppercase tracking-[0.08em] text-[var(--ink-dim)] font-[family-name:var(--font-body)]">Available to borrow</div>
          </div>
        </div>
      )}

      {state === "error" && (
        <div role="alert" className="flex items-start gap-2 border-b border-[var(--rule)] bg-[var(--negative)]/5 px-4 py-3 text-sm text-[var(--negative)]">
          <WarningCircle size={16} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>Could not refresh the reserve table: {error}</span>
        </div>
      )}

      {state === "loading" ? (
        <div role="status" aria-live="polite" className="border-b border-[var(--rule)] px-4 py-3">
          <span className="sr-only">Refreshing reserve table</span>
          <div className="space-y-3" aria-hidden="true">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="h-5 w-full bg-[var(--rule)]" />
            ))}
          </div>
        </div>
      ) : xstocks.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-[var(--ink-dim)]">
          No xStock reserves were returned by the market. The RPC endpoint may be unreachable.
        </p>
      ) : (
        <div>
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="border-b border-[var(--rule)] text-left text-xs uppercase tracking-wide text-[var(--ink-dim)]">
                <th scope="col" className="w-[12%] px-2 py-2 font-medium sm:px-4">Symbol</th>
                <th scope="col" className="hidden w-[12%] px-4 py-2 text-right font-medium sm:table-cell">Mark</th>
                <th scope="col" className="w-[14%] px-2 py-2 text-right font-medium sm:px-4">Borrow factor</th>
                <th scope="col" className="hidden w-[13%] px-4 py-2 text-right font-medium sm:table-cell">Borrow APY</th>
                <th scope="col" className="hidden w-[13%] px-4 py-2 text-right font-medium md:table-cell">Available</th>
                <th scope="col" className="w-[36%] px-2 py-2 text-right font-medium sm:px-4">Status</th>
              </tr>
            </thead>
            <tbody className="font-[family-name:var(--font-mono)] tabular">
              {xstocks.map((r) => (
                <tr key={r.symbol} className="border-b border-[var(--rule)] last:border-0">
                  <th scope="row" className="min-w-0 px-2 py-2.5 text-left font-[family-name:var(--font-body)] font-medium sm:px-4">{r.symbol}</th>
                  <td className="hidden px-4 py-2.5 text-right sm:table-cell">
                    {r.priceUsd !== null ? fmtUsd(r.priceUsd) : "-"}
                    {!r.oracleValid && (
                      <WarningCircle size={12} weight="fill" aria-hidden="true" className="ml-1 inline text-[var(--negative)]" />
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-right sm:px-4">{r.borrowFactor !== null ? `${Math.round(r.borrowFactor * 100)}%` : "-"}</td>
                  <td className="hidden px-4 py-2.5 text-right sm:table-cell">{fmtPct(r.borrowApy * 100)}</td>
                  <td className="hidden px-4 py-2.5 text-right md:table-cell">{fmtNum(Number(r.availableRaw) / 10 ** r.decimals, 2)}</td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right sm:px-4">
                    {r.borrowable ? (
                      <span className="inline-flex items-center gap-1 text-[var(--positive)]">
                        <CheckCircle size={14} weight="fill" aria-hidden="true" />
                        <span className="hidden sm:inline">borrowable</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[var(--negative)]" title={r.reason} aria-label={r.reason}>
                        <WarningCircle size={14} weight="fill" aria-hidden="true" />
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
