/* Hallmark · component: short position card · genre: editorial · theme: clearinghouse ledger (DESIGN.md locked)
 * states: default only — a server-rendered summary of already-fetched data; its two interactive children
 * (PythLine, CloseButton) each ship their own full state set.
 * contrast: pass (40-41) — ink-dim/negative/positive on paper-raised, same pairs as the rest of the page.
 */
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { fmtUsd, fmtNum, fmtPct } from "@/lib/format";
import { PythLine } from "@/components/PythLine";
import { CloseButton } from "@/components/CloseButton";
import type { ShortPosition, PositionLine } from "@/lib/obligation";

const WARN_GAP_PCT = 1;

function formatActivity(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return "unknown";
  return new Date(unixSeconds * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

/** One open short on the obligation: the entry context Contra can honestly
 * show (last on-chain borrow/repay activity, since there is no indexer to
 * recover the original open price or date), a live mark from two independent
 * sources (Kamino's own Scope oracle vs a live Jupiter quote), interest
 * accrued since that last activity, the Pyth fair-value cross-check for
 * entitled tickers, and the existing close flow. */
export function ShortCard({ owner, short, usdcDeposit }: { owner: string; short: ShortPosition; usdcDeposit: PositionLine | undefined }) {
  const gapPct = short.jupiterValueUsd !== null && short.kaminoValueUsd > 0 ? (short.jupiterValueUsd / short.kaminoValueUsd - 1) * 100 : null;
  const warn = gapPct !== null && Math.abs(gapPct) > WARN_GAP_PCT;
  const borrowLine: PositionLine = {
    symbol: short.symbol,
    amount: short.rawUnitAmount,
    marketValueUsd: short.kaminoValueUsd,
    decimals: short.decimals,
    reserveAddress: short.reserveAddress,
  };

  return (
    <div className="border-t border-[var(--rule)] pt-4 first:mt-0 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between">
        <h3 className="font-[family-name:var(--font-display)] text-base font-semibold">{short.symbol} short</h3>
        {short.pairBorrowFactor !== null && (
          <span className="font-[family-name:var(--font-mono)] text-xs tabular text-[var(--ink-dim)]">
            borrow factor {(short.pairBorrowFactor * 100).toFixed(0)}%
          </span>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-y-1.5 font-[family-name:var(--font-mono)] text-sm tabular sm:grid-cols-4">
        <dt className="text-[var(--ink-dim)]">Borrowed</dt>
        <dd className="text-right">
          {fmtNum(short.displayedAmount, 6)} {short.symbol}
        </dd>
        <dt className="text-[var(--ink-dim)]">Kamino mark</dt>
        <dd className="text-right">{fmtUsd(short.kaminoValueUsd)}</dd>

        <dt className="text-[var(--ink-dim)]">Jupiter mark</dt>
        <dd className={`text-right ${warn ? "text-[var(--negative)]" : ""}`}>
          {short.jupiterValueUsd !== null ? fmtUsd(short.jupiterValueUsd) : "-"}
        </dd>
        <dt className="text-[var(--ink-dim)]">Mark gap</dt>
        <dd className={`text-right ${warn ? "text-[var(--negative)]" : ""}`}>{gapPct !== null ? fmtPct(gapPct) : "-"}</dd>

        <dt className="text-[var(--ink-dim)]">Liquidation price</dt>
        <dd className="text-right">{short.liquidationPriceUsd !== null ? fmtUsd(short.liquidationPriceUsd) : "-"}</dd>
        <dt className="text-[var(--ink-dim)]">Interest accrued</dt>
        <dd className="text-right">
          {fmtNum(short.accruedInterest, 6)} {short.symbol}
        </dd>
      </dl>

      <p className="mt-2 text-xs text-[var(--ink-dim)]">
        Entry context: last borrow/repay activity on this position was {formatActivity(short.lastBorrowActivityUnix)}. Contra has no
        indexer, so the original open price isn&apos;t tracked; the marks above and the interest above are live reads against the
        current chain state, not P&amp;L since the short was first opened.
      </p>

      {short.jupiterError !== null && (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-[var(--negative)]">
          <WarningCircle size={13} weight="fill" className="mt-0.5 shrink-0" />
          Live Jupiter mark unavailable: {short.jupiterError}
        </p>
      )}

      <div className="mt-2">
        <PythLine ticker={short.symbol} initial={null} />
      </div>

      {usdcDeposit !== undefined && (
        <div className="mt-3 border-t border-[var(--rule)] pt-3">
          <CloseButton owner={owner} borrow={borrowLine} deposit={usdcDeposit} />
        </div>
      )}
    </div>
  );
}
