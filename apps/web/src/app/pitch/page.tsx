import type { Metadata } from "next";
import Link from "next/link";
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import { readReserveRows, toPublicRow } from "@/lib/reserves";
import { fmtPct } from "@/lib/format";
import type { PublicReserveRow } from "@/lib/types";
import { DeckNav } from "@/components/DeckNav";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contra: pitch",
  description: "One signature to short a tokenized US stock on Solana. What is built, what is proven, what is not.",
};

const TOTAL = 10;

function Sheet({ n, slug, title, children }: { n: number; slug: string; title: string; children: React.ReactNode }) {
  return (
    <section
      data-slide={n}
      aria-label={`Sheet ${n}: ${title}`}
      className="flex min-h-[100dvh] flex-col border-b border-[var(--rule-strong)] px-6 py-10 lg:px-12 lg:py-14"
    >
      <div className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col">
        <div className="flex items-baseline justify-between gap-4 border-b border-[var(--rule)] pb-3 font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.14em]">
          <span className="text-[var(--accent)]">{slug}</span>
          <span className="tabular text-[var(--ink-dim)]">{`Sheet ${String(n).padStart(2, "0")} of ${TOTAL}`}</span>
        </div>
        <h2 className="mt-8 max-w-[22ch] font-[family-name:var(--font-display)] text-3xl font-semibold leading-tight sm:text-5xl">{title}</h2>
        <div className="mt-8 flex-1">{children}</div>
      </div>
    </section>
  );
}

function Stamp({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block rounded-[var(--radius-ticket)] border px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[11px] tracking-[0.08em] ${
        ok ? "border-[var(--positive)] text-[var(--positive)]" : "border-[var(--negative)] text-[var(--negative)]"
      }`}
    >
      {ok ? "BORROWABLE" : "LIMIT 0"}
    </span>
  );
}

const OPEN_TRACE: [string, string, string][] = [
  ["00", "Compute Budget", "set_compute_unit_limit"],
  ["01", "Scope", "refresh_price_list, every derived entry the reserves touch"],
  ["02", "Kamino", "deposit_reserve_liquidity_and_obligation_collateral (USDC in)"],
  ["03", "Kamino", "borrow_obligation_liquidity (the xStock)"],
  ["04", "Jupiter", "swap xStock to USDC, composed from swap-instructions"],
  ["05", "Lighthouse", "AssertTokenAccount: owner USDC at or above the quoted minimum"],
];

export default async function PitchPage() {
  let xstocks: PublicReserveRow[] = [];
  let loadError: string | null = null;
  try {
    xstocks = (await readReserveRows()).map(toPublicRow).filter((r) => r.isXstock);
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }
  const open = xstocks.filter((r) => r.borrowable);
  const figure = `${open.length} of ${xstocks.length}`;

  return (
    <div className="min-h-[100dvh] bg-[var(--paper)] pb-16">
      <DeckNav total={TOTAL} />

      <Sheet n={1} slug="Contra" title="One signature to short a tokenized US stock on Solana.">
        <div className="grid gap-10 lg:grid-cols-[1fr_380px]">
          <p className="max-w-xl text-lg text-[var(--ink-dim)]">
            Pick a ticker, deposit USDC. One transaction deposits it as collateral on Kamino, borrows the xStock, and sells it
            through Jupiter. Closing is the same message in reverse.
          </p>
          <div className="border border-[var(--rule-strong)] bg-[var(--paper-raised)] p-5">
            {loadError ? (
              <p className="text-sm text-[var(--negative)]">Could not read the xStocks market: {loadError}</p>
            ) : (
              <>
                <p className="font-[family-name:var(--font-display)] text-5xl font-semibold tabular leading-none">{figure}</p>
                <p className="mt-2 text-[11px] uppercase tracking-[0.08em] text-[var(--ink-dim)]">
                  xStock reserves borrowable right now
                </p>
                <p className="mt-4 border-t border-[var(--rule)] pt-3 font-[family-name:var(--font-mono)] text-xs text-[var(--ink-dim)]">
                  Read from Kamino reserve config at page load, not typed in.
                </p>
              </>
            )}
          </div>
        </div>
        <p className="mt-10 font-[family-name:var(--font-mono)] text-sm">
          <a href="https://contra-sol.vercel.app" className="text-[var(--accent)] underline underline-offset-2">contra-sol.vercel.app</a>
        </p>
      </Sheet>

      <Sheet n={2} slug="The problem" title="The rails exist. Almost nobody borrows on them.">
        <table className="w-full max-w-2xl border-t border-[var(--rule-strong)] font-[family-name:var(--font-mono)] text-sm tabular">
          <tbody>
            <tr className="border-b border-[var(--rule)]">
              <td className="py-3 pr-4 text-[var(--ink-dim)]">xStock collateral supplied</td>
              <td className="py-3 text-right">$22,689,278.56</td>
            </tr>
            <tr className="border-b border-[var(--rule)]">
              <td className="py-3 pr-4 text-[var(--ink-dim)]">xStock currently borrowed</td>
              <td className="py-3 text-right">$157,203.77</td>
            </tr>
            <tr className="border-b border-[var(--rule-strong)]">
              <td className="py-3 pr-4 font-medium">Utilization</td>
              <td className="py-3 text-right font-[family-name:var(--font-display)] text-3xl font-semibold text-[var(--accent)]">0.69%</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-6 max-w-2xl text-[var(--ink-dim)]">
          Six of ten tickers have never had a dollar borrowed: GOOGLx, CRCLx, AAPLx, MSTRx, HOODx, METAx. Every one of them already
          carries a live borrow rate.
        </p>
        <p className="mt-6 font-[family-name:var(--font-mono)] text-xs text-[var(--ink-dim)]">
          Source: api.kamino.finance reserves/metrics for market 5wJe…Lsua, read 2026-09-25.
        </p>
      </Sheet>

      <Sheet n={3} slug="Why" title="Shorting an xStock today is four instructions across two protocols.">
        <ol className="max-w-3xl divide-y divide-[var(--rule)] border-y border-[var(--rule-strong)]">
          {[
            ["Refresh the Scope oracle", "and it must sit right after the compute-budget instruction, every time"],
            ["Deposit USDC on Kamino", "as obligation collateral"],
            ["Borrow the xStock", "against it, inside Kamino's live caps"],
            ["Sell it on Jupiter", "with a fresh quote, before the price moves"],
          ].map(([what, detail], i) => (
            <li key={what} className="flex gap-4 py-4">
              <span className="font-[family-name:var(--font-mono)] text-sm tabular text-[var(--accent)]">{String(i + 1).padStart(2, "0")}</span>
              <span>
                <span className="font-medium">{what}</span> <span className="text-[var(--ink-dim)]">{detail}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-6 max-w-2xl text-lg">Nobody had wired that into one thing a wallet signs once. What is missing is not liquidity. It is the transaction.</p>
      </Sheet>

      <Sheet n={4} slug="The product" title="Contra builds that transaction.">
        <div className="max-w-3xl border border-[var(--rule-strong)] bg-[var(--paper-raised)]">
          <p className="border-b border-[var(--rule)] px-4 py-2 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.1em] text-[var(--ink-dim)]">
            Open short, one versioned transaction
          </p>
          <ol className="divide-y divide-[var(--rule)] font-[family-name:var(--font-mono)] text-sm">
            {OPEN_TRACE.map(([ix, program, what]) => (
              <li key={ix} className="grid grid-cols-[2rem_1fr] gap-x-3 px-4 py-2.5 sm:grid-cols-[2rem_9rem_1fr]">
                <span className="tabular text-[var(--ink-dim)]">{ix}</span>
                <span className="text-[var(--accent)]">{program}</span>
                <span className="col-start-2 min-w-0 break-words sm:col-start-3">{what}</span>
              </li>
            ))}
          </ol>
        </div>
        <p className="mt-6 max-w-2xl text-[var(--ink-dim)]">
          Close runs the same shape backwards: buy back on Jupiter, repay, withdraw. Jupiter has no exact-out route for these mints, so
          the close buys exact-in with a buffer and checks the quote covers the repay before it builds anything.
        </p>
      </Sheet>

      <Sheet n={5} slug="Live now" title="It only offers what Kamino will actually lend.">
        {loadError ? (
          <p className="text-sm text-[var(--negative)]">Could not read the xStocks market: {loadError}</p>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
            <table className="w-full border-t border-[var(--rule-strong)] text-sm">
              <thead>
                <tr className="border-b border-[var(--rule)] text-left text-[11px] uppercase tracking-[0.08em] text-[var(--ink-dim)]">
                  <th className="py-2 pr-3 font-medium">Ticker</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="hidden py-2 pr-3 text-right font-medium sm:table-cell">Borrow APY</th>
                  <th className="hidden py-2 font-medium md:table-cell">Why</th>
                </tr>
              </thead>
              <tbody className="font-[family-name:var(--font-mono)] tabular">
                {xstocks.map((r) => (
                  <tr key={r.mint} className="border-b border-[var(--rule)]">
                    <td className="py-2 pr-3">{r.symbol}</td>
                    <td className="py-2 pr-3"><Stamp ok={r.borrowable} /></td>
                    <td className="hidden py-2 pr-3 text-right sm:table-cell">{fmtPct(r.borrowApy * 100)}</td>
                    <td className="hidden py-2 text-xs text-[var(--ink-dim)] md:table-cell">{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div>
              <p className="font-[family-name:var(--font-display)] text-5xl font-semibold tabular leading-none">{figure}</p>
              <p className="mt-2 text-sm text-[var(--ink-dim)]">
                borrowable xStock reserves, computed from each reserve&apos;s deployed borrow limit and available liquidity when this page
                loaded. A blocked ticker cannot be selected on the ticket, and the reason is printed next to it.
              </p>
            </div>
          </div>
        )}
      </Sheet>

      <Sheet n={6} slug="Guard rails" title="A bad outcome reverts on chain, not just off screen.">
        <dl className="max-w-3xl divide-y divide-[var(--rule)] border-y border-[var(--rule-strong)]">
          <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-6">
            <dt className="font-medium">Lighthouse assertion</dt>
            <dd className="text-[var(--ink-dim)]">
              Every open ends by asserting the owner&apos;s USDC balance is at or above the quoted minimum. Ask for a balance the
              transaction cannot produce and the whole message reverts with Lighthouse&apos;s own error{" "}
              <code className="font-[family-name:var(--font-mono)] text-[var(--negative)]">Custom 6001</code>.
            </dd>
          </div>
          <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-6">
            <dt className="font-medium">Stale price</dt>
            <dd className="text-[var(--ink-dim)]">
              Contra measures how old the upstream Chainlink and Pyth Lazer leaves are before building. Too old to fix in-transaction, it
              stops with <code className="font-[family-name:var(--font-mono)]">MarketClosedError</code> instead of sending something Kamino
              rejects as <code className="font-[family-name:var(--font-mono)]">ReserveStale</code>.
            </dd>
          </div>
          <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-6">
            <dt className="font-medium">Pyth fair value</dt>
            <dd className="text-[var(--ink-dim)]">
              The ticket compares Hermes&apos; live Equity.US price with a live Jupiter sell quote and shows the gap in basis points.
            </dd>
          </div>
        </dl>
      </Sheet>

      <Sheet n={7} slug="Evidence" title="Every proof is a mainnet simulation, checked by code that did not build it.">
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-0 border-t border-[var(--rule-strong)] text-sm">
            <thead>
              <tr className="border-b border-[var(--rule)] text-left text-[11px] uppercase tracking-[0.08em] text-[var(--ink-dim)]">
                <th className="py-2 pr-3 font-medium">Run</th>
                <th className="py-2 pr-3 font-medium">Asked for</th>
                <th className="py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="font-[family-name:var(--font-mono)] text-xs sm:text-sm">
              {[
                ["open", "deposit 0.5 USDC, borrow 0.001 SPYx", "GREEN, err: null", true],
                ["close", "repay 0.01 SPYx, withdraw 5 USDC", "GREEN", true],
                ["guard pass", "normal open with Lighthouse bound", "GREEN, err: null", true],
                ["open red", "borrow 1 whole TSLAx", "reverts 6009 ReserveStale", false],
                ["close red", "withdraw $4,000 against 0.01 SPYx", "reverts 6011 WithdrawTooLarge", false],
                ["guard red", "impossible USDC bound", "reverts 6001 in Lighthouse", false],
              ].map(([run, ask, result, green]) => (
                <tr key={run as string} className="border-b border-[var(--rule)] align-top">
                  <td className="py-2 pr-3 whitespace-nowrap">{run}</td>
                  <td className="py-2 pr-3 text-[var(--ink-dim)]">{ask}</td>
                  <td className={`py-2 ${green ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-6 max-w-2xl text-[var(--ink-dim)]">
          The checkers re-decode raw obligation bytes with klend-sdk&apos;s own layout. The red runs exist so the green ones mean
          something: each checker reports RED on them. Open and guard reran live on 2026-09-25; close is checked against the artifact in packages/short/artifacts.
        </p>
      </Sheet>

      <Sheet n={8} slug="Why Solana" title="Four programs, one atomic message, or none of it happens.">
        <p className="max-w-2xl text-lg">
          The deposit, the borrow, the swap, the oracle refresh and the balance assertion all land in one versioned transaction. Address
          lookup tables from the Kamino market and from Jupiter&apos;s route compress the account list so it fits Solana&apos;s packet
          limit. If any step fails, the collateral never moves.
        </p>
        <p className="mt-6 max-w-2xl text-[var(--ink-dim)]">
          The simulated open fit in one message. When a Jupiter route pushes it past 1232 bytes, Contra splits it into two
          transactions sent in order, Kamino leg then Jupiter leg with the guard, and that case is not atomic.
        </p>
      </Sheet>

      <Sheet n={9} slug="Honest status" title="What is not proven yet.">
        <ul className="max-w-3xl divide-y divide-[var(--rule)] border-y border-[var(--rule-strong)]">
          {[
            "No signed mainnet short has been sent from Contra. Sending one spends real USDC; every proof so far is simulateTransaction.",
            "Opens only work during US market hours, when Kamino's Scope crank for these reserves refreshes.",
            `Kamino's caps allow ${figure} xStock reserves to be borrowed right now. Contra surfaces that, it cannot override it.`,
            "Pyth's trial plan covers two equity feeds, TSLA and QQQ. Every other ticker says no feed is in the plan.",
            "A route too large for one 1232-byte message splits into two transactions. That path is not atomic.",
            "Positions show live marks, not P&L since entry. There is no indexer, so the entry price is unknown and the UI says so.",
          ].map((line) => (
            <li key={line} className="py-3 text-[var(--ink-dim)]">
              {line}
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-[var(--ink-dim)]">Non-US use only. A short against tokenized equities, not the underlying security.</p>
      </Sheet>

      <Sheet n={10} slug="Next" title="Once real shorts go out, Contra takes a basis-point cut on the close.">
        <p className="max-w-2xl text-lg text-[var(--ink-dim)]">
          The way a prime broker charges for a borrow it is already carrying. First step: the first signed mainnet short, during market
          hours.
        </p>
        <div className="mt-10 flex flex-col gap-2 font-[family-name:var(--font-mono)] text-sm">
          <a href="https://contra-sol.vercel.app" className="inline-flex items-center gap-1 text-[var(--accent)] underline underline-offset-2">
            contra-sol.vercel.app <ArrowSquareOut size={12} />
          </a>
          <a href="https://github.com/passionate-dev7/contra" className="inline-flex items-center gap-1 text-[var(--accent)] underline underline-offset-2">
            github.com/passionate-dev7/contra <ArrowSquareOut size={12} />
          </a>
          <Link href="/" className="text-[var(--accent)] underline underline-offset-2">Open the ticket</Link>
        </div>
      </Sheet>
    </div>
  );
}
