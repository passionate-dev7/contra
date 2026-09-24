import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { ArrowSquareOut, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { readObligation } from "@/lib/obligation";
import { fmtUsd, fmtPct, fmtNum, shortAddr } from "@/lib/format";
import { OwnerForm } from "@/components/OwnerForm";
import { CloseButton } from "@/components/CloseButton";

export const revalidate = 0;

export default async function PositionsPage({ searchParams }: { searchParams: Promise<{ owner?: string }> }) {
  const { owner } = await searchParams;

  return (
    <div className="min-h-[100dvh] bg-[var(--paper)]">
      <header className="border-b border-[var(--rule)]">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between px-6 py-6">
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold">
            <Link href="/">Contra</Link> · Position
          </h1>
          <Link href="/" className="press-scale text-sm text-[var(--accent)] underline underline-offset-2">
            Open a short
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-6 py-8">
        <div className="mb-6">
          <OwnerForm initial={owner} />
        </div>

        {!owner ? (
          <p className="rounded-[var(--radius-ticket)] border border-[var(--rule-strong)] p-8 text-center text-sm text-[var(--ink-dim)]">
            Enter a wallet address to view its obligation on the xStocks market.
          </p>
        ) : (
          <ObligationSection owner={owner} />
        )}
      </main>
    </div>
  );
}

async function ObligationSection({ owner }: { owner: string }) {
  try {
    new PublicKey(owner);
  } catch {
    return (
      <div className="flex items-start gap-2 rounded-[var(--radius-ticket)] border border-[var(--negative)] bg-[var(--negative)]/5 p-4 text-sm text-[var(--negative)]">
        <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0" />
        <span>&quot;{owner}&quot; is not a valid Solana address.</span>
      </div>
    );
  }

  let view;
  try {
    view = await readObligation(owner);
  } catch (err) {
    return (
      <div className="flex items-start gap-2 rounded-[var(--radius-ticket)] border border-[var(--negative)] bg-[var(--negative)]/5 p-4 text-sm text-[var(--negative)]">
        <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0" />
        <span>
          Could not read the obligation for {shortAddr(owner)}: {err instanceof Error ? err.message : String(err)}
        </span>
      </div>
    );
  }

  const solscanOwner = `https://solscan.io/account/${owner}`;

  if (view === null) {
    return (
      <div className="rounded-[var(--radius-ticket)] border border-[var(--rule-strong)] bg-[var(--paper-raised)] p-8 text-center">
        <p className="text-sm text-[var(--ink-dim)]">
          No obligation for{" "}
          <a href={solscanOwner} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--accent)] underline">
            {shortAddr(owner)}
            <ArrowSquareOut size={11} weight="bold" />
          </a>{" "}
          on the xStocks market yet.
        </p>
      </div>
    );
  }

  const primaryBorrow = view.borrows.find((b) => /x$/.test(b.symbol));
  const usdcDeposit = view.deposits.find((d) => d.symbol === "USDC");

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
      <section className="border border-[var(--rule-strong)] bg-[var(--paper-raised)] rounded-[var(--radius-ticket)] p-5">
        <p className="text-sm text-[var(--ink-dim)]">
          Owner{" "}
          <a href={solscanOwner} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-[family-name:var(--font-mono)] text-[var(--accent)] underline">
            {shortAddr(owner)}
            <ArrowSquareOut size={11} weight="bold" />
          </a>
        </p>

        <h2 className="mt-4 font-[family-name:var(--font-display)] text-lg">Deposits</h2>
        <PositionTable lines={view.deposits} />

        <h2 className="mt-6 font-[family-name:var(--font-display)] text-lg">Borrows</h2>
        <PositionTable lines={view.borrows} />

        <dl className="mt-6 grid grid-cols-2 gap-y-1.5 border-t border-[var(--rule)] pt-4 text-sm font-[family-name:var(--font-mono)] tabular sm:grid-cols-4">
          <dt className="text-[var(--ink-dim)]">Deposits</dt>
          <dd className="text-right">{fmtUsd(view.totalDepositUsd)}</dd>
          <dt className="text-[var(--ink-dim)]">Borrows</dt>
          <dd className="text-right">{fmtUsd(view.totalBorrowUsd)}</dd>
          <dt className="text-[var(--ink-dim)]">LTV</dt>
          <dd className={`text-right ${view.healthy ? "" : "text-[var(--negative)]"}`}>{fmtPct(view.loanToValuePct)}</dd>
          <dt className="text-[var(--ink-dim)]">Liquidation LTV</dt>
          <dd className="text-right">{fmtPct(view.liquidationLtvPct)}</dd>
        </dl>
      </section>

      <aside className="border border-[var(--rule-strong)] bg-[var(--paper-raised)] rounded-[var(--radius-ticket)] p-5 lg:sticky lg:top-6 lg:self-start">
        <h2 className="font-[family-name:var(--font-display)] text-lg">Health</h2>
        <div className={`mt-3 rounded-[var(--radius-ticket)] border p-3 text-sm ${view.healthy ? "border-[var(--positive)] text-[var(--positive)]" : "border-[var(--negative)] text-[var(--negative)]"}`}>
          {view.healthy ? "Position is above its liquidation LTV." : "Position is at or past its liquidation LTV."}
        </div>
        {view.liquidationPriceUsd !== null && view.liquidationTicker !== null && (
          <p className="mt-3 font-[family-name:var(--font-mono)] text-sm tabular">
            Liquidation price ({view.liquidationTicker}): {fmtUsd(view.liquidationPriceUsd)}
          </p>
        )}
        <div className="mt-5 border-t border-[var(--rule)] pt-4">
          {primaryBorrow && usdcDeposit ? (
            <CloseButton owner={owner} borrow={primaryBorrow} deposit={usdcDeposit} />
          ) : (
            <p className="text-sm text-[var(--ink-dim)]">No xStock borrow against USDC collateral to close here.</p>
          )}
        </div>
      </aside>
    </div>
  );
}

function PositionTable({ lines }: { lines: { symbol: string; amount: number; marketValueUsd: number }[] }) {
  if (lines.length === 0) {
    return <p className="mt-2 text-sm text-[var(--ink-dim)]">None.</p>;
  }
  return (
    <table className="mt-2 w-full text-sm font-[family-name:var(--font-mono)] tabular">
      <tbody>
        {lines.map((l) => (
          <tr key={l.symbol} className="border-b border-[var(--rule)] last:border-0">
            <td className="py-1.5 font-[family-name:var(--font-body)]">{l.symbol}</td>
            <td className="py-1.5 text-right">{fmtNum(l.amount, 6)}</td>
            <td className="py-1.5 text-right text-[var(--ink-dim)]">{fmtUsd(l.marketValueUsd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
