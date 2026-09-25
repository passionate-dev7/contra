import type { Metadata } from "next";
import Link from "next/link";
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import { readReserveRows, toPublicRow } from "@/lib/reserves";
import { fmtPct } from "@/lib/format";
import type { PublicReserveRow } from "@/lib/types";
import { DeckNav } from "@/components/DeckNav";
import { Exhibit, TweetCard, Clipping, LEAD_TWEET, TWEETS, CLIPPINGS } from "./evidence";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contra: pitch",
  description: "One signature to short a tokenized US stock on Solana. What is built, what is proven, what is not.",
};

const TOTAL = 12;

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
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <Exhibit
            letter="A"
            src="/evidence/kamino-xstocks-market.webp"
            width={1200}
            height={882}
            alt="Kamino borrow page, xStocks Market: MSTRx, GOOGLx, CRCLx, HOODx and AAPLx each show millions supplied and $0.00 borrowed, with no borrow button."
            href="https://kamino.com/borrow"
            label="kamino.com/borrow, xStocks filter, xStocks Market"
            note="Nine xStocks, $22.7M supplied. Five show $0.00 borrowed and no Borrow button at all."
          />
          <div>
            <table className="w-full border-t border-[var(--rule-strong)] font-[family-name:var(--font-mono)] text-sm tabular">
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
            <p className="mt-6 text-[var(--ink-dim)]">
              Six of ten tickers have never had a dollar borrowed: GOOGLx, CRCLx, AAPLx, MSTRx, HOODx, METAx. Every one of them already
              carries a live borrow rate.
            </p>
            <p className="mt-6 font-[family-name:var(--font-mono)] text-xs text-[var(--ink-dim)]">
              Source: api.kamino.finance reserves/metrics for market 5wJe…Lsua, read 2026-09-25.
            </p>
          </div>
        </div>
        <div className="mt-8">
          <Exhibit
            letter="B"
            src="/evidence/kamino-tslax-reserve.webp"
            width={1200}
            height={276}
            alt="Kamino TSLAx Reserve page: 7.57K TSLAx supplied, 2.48K liquidity available, 12.65 TSLAx borrowed at 0.17% utilization, 5.81% borrow APY."
            href="https://kamino.com/borrow/reserve/5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua/5iTiczqgUegqA3PpoNpotizMbY9n1sRWr3oL6igKvWuf"
            label="kamino.com/borrow/reserve/5wJe…Lsua/5iTi…vWuf"
            note="TSLAx: 12.65 borrowed out of 7.57K supplied, 0.17% utilization, with a live 5.81% borrow rate."
            sizes="100vw"
          />
        </div>
      </Sheet>

      <Sheet n={3} slug="Said out loud" title="Kamino shipped the short. Its own launch post says so.">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <TweetCard t={LEAD_TWEET} lead />
          <div className="flex flex-col gap-6">
            <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.1em] text-[var(--ink-dim)]">In print</p>
            {CLIPPINGS.map((c) => (
              <Clipping key={c.href} c={c} />
            ))}
          </div>
        </div>
        <p className="mt-10 mb-4 max-w-2xl text-[var(--ink-dim)]">
          Demand to go short xStocks is old news: Loopscale offered a leveraged CRCLx short within days of launch, Wasabi opened a
          long/short venue two weeks later. What those posts announce is a place to do it, not one signature that does it.
        </p>
        <div className="columns-1 gap-4 sm:columns-2 lg:columns-3">
          {TWEETS.map((t) => (
            <TweetCard key={t.id} t={t} />
          ))}
        </div>
        <p className="mt-2 font-[family-name:var(--font-mono)] text-xs text-[var(--ink-dim)]">
          Post text is tweet.text from api.fxtwitter.com, read 2026-09-25. Counts as of that read.
        </p>
      </Sheet>

      <Sheet n={4} slug="Why" title="Kamino's own guide opens a short in three wallet confirmations.">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <ol className="divide-y divide-[var(--rule)] border-y border-[var(--rule-strong)]">
              {[
                ["Supply USDC", "on the xStocks Market, confirm in the wallet"],
                ["Borrow the xStock", "inside Kamino's live caps, confirm again"],
                ["Swap it for USDC", "on a separate screen with a fresh quote, confirm a third time"],
                ["Keep the oracle fresh", "Scope must be refreshed right after the compute-budget instruction, or Kamino rejects the borrow as ReserveStale"],
              ].map(([what, detail], i) => (
                <li key={what} className="flex gap-4 py-4">
                  <span className="font-[family-name:var(--font-mono)] text-sm tabular text-[var(--accent)]">{String(i + 1).padStart(2, "0")}</span>
                  <span>
                    <span className="font-medium">{what}</span> <span className="text-[var(--ink-dim)]">{detail}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-6 text-lg">
              Between confirmation two and three the trader holds a borrowed stock and no short. What is missing is not liquidity. It is
              the transaction.
            </p>
            <p className="mt-4 text-sm text-[var(--ink-dim)]">
              The same guide already offers a one-click close, Repay with Collateral. The open is the part left as three steps.
            </p>
            <div className="mt-8 max-w-sm">
              <Exhibit
                letter="C"
                src="/evidence/jupiter-tslax-swap.webp"
                width={535}
                height={506}
                alt="Jupiter swap: sell 2 TSLAx for 759.89 USDC, button reads Insufficient TSLAx."
                href="https://jup.ag/swap?sell=XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB&buy=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
                label="jup.ag/swap, TSLAx to USDC"
                note="Jupiter quotes the sell. It cannot sell a stock you have not borrowed yet."
                sizes="(min-width: 1024px) 24rem, 100vw"
              />
            </div>
          </div>
          <Exhibit
            letter="D"
            src="/evidence/kamino-docs-short-steps.webp"
            width={730}
            height={670}
            alt="Kamino Docs, How to Short xStocks on Kamino: step 1 supply USDC and confirm, step 2 borrow the xStock and confirm, step 3 swap the borrowed xStock for USDC and confirm."
            href="https://kamino.com/docs/learn/borrow/short-xstocks"
            label="kamino.com/docs/learn/borrow/short-xstocks"
            note="Kamino Docs, How to Short xStocks on Kamino. Each step ends in its own wallet confirmation."
            sizes="(min-width: 1024px) 45vw, 100vw"
          />
        </div>
      </Sheet>

      <Sheet n={5} slug="Elsewhere" title="Traders already short TSLA on chain. Just not on Solana's idle borrow.">
        <Exhibit
          letter="E"
          src="/evidence/hyperliquid-tsla-perp.webp"
          width={1200}
          height={420}
          alt="Hyperliquid TSLA-USDC perp deployed by xyz: 24h volume $22,738,062.34, open interest $43,733,817.08, Sell / Short selected."
          href="https://app.hyperliquid.xyz/trade/xyz:TSLA"
          label="app.hyperliquid.xyz/trade/xyz:TSLA"
          sizes="100vw"
        />
        <dl className="mt-8 grid gap-px border border-[var(--rule-strong)] bg-[var(--rule-strong)] sm:grid-cols-2">
          <div className="bg-[var(--paper-raised)] p-5">
            <dt className="text-[11px] uppercase tracking-[0.08em] text-[var(--ink-dim)]">Hyperliquid TSLA perp, 24h volume</dt>
            <dd className="mt-2 font-[family-name:var(--font-display)] text-4xl font-semibold tabular">$22.74M</dd>
            <dd className="mt-1 text-sm text-[var(--ink-dim)]">$43.73M open interest. One button: Sell / Short. Exhibit E.</dd>
          </div>
          <div className="bg-[var(--paper-raised)] p-5">
            <dt className="text-[11px] uppercase tracking-[0.08em] text-[var(--ink-dim)]">Kamino TSLAx, total borrowed</dt>
            <dd className="mt-2 font-[family-name:var(--font-display)] text-4xl font-semibold tabular text-[var(--accent)]">$4.78K</dd>
            <dd className="mt-1 text-sm text-[var(--ink-dim)]">12.65 TSLAx against a 2.50K TSLAx borrow cap. Exhibit B.</dd>
          </div>
        </dl>
        <p className="mt-6 max-w-2xl text-[var(--ink-dim)]">
          A perp is a different instrument with funding instead of a borrow rate, deployed by a third party on another chain. The point
          is the button, not the venue: where shorting is one action, it trades. Both figures were read off the live pages on 2026-09-25.
        </p>
      </Sheet>

      <Sheet n={6} slug="The product" title="Contra builds that transaction.">
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

      <Sheet n={7} slug="Live now" title="It only offers what Kamino will actually lend.">
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
        <div className="mt-8">
          <Exhibit
            letter="F"
            src="/evidence/solscan-tslax-reserve-vault.webp"
            width={1200}
            height={384}
            alt="Solscan token account AvhRUjab47DCo9efnzmDha8xUeQFEs36Yywv1x8t3T2W, public name Kamino Reserve Liquidity (TSLAx) Supply, balance 7,559.80352294 TSLAx."
            href="https://solscan.io/account/AvhRUjab47DCo9efnzmDha8xUeQFEs36Yywv1x8t3T2W"
            label="solscan.io/account/AvhRUjab47DCo9efnzmDha8xUeQFEs36Yywv1x8t3T2W"
            note="The TSLAx reserve's supply vault: 7,559.80352294 TSLAx sitting idle. getTokenAccountBalance returns the same amount at slot 450,280,178."
            sizes="100vw"
          />
        </div>
      </Sheet>

      <Sheet n={8} slug="Guard rails" title="A bad outcome reverts on chain, not just off screen.">
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

      <Sheet n={9} slug="Evidence" title="Every proof is a mainnet simulation, checked by code that did not build it.">
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

      <Sheet n={10} slug="Why Solana" title="Four programs, one atomic message, or none of it happens.">
        <p className="max-w-2xl text-lg">
          The deposit, the borrow, the swap, the oracle refresh and the balance assertion all land in one versioned transaction. Address
          lookup tables from the Kamino market and from Jupiter&apos;s route compress the account list so it fits Solana&apos;s packet
          limit. If any step fails, the collateral never moves.
        </p>
        <p className="mt-6 max-w-2xl text-[var(--ink-dim)]">
          The simulated open fit in one message. When a Jupiter route pushes it past 1232 bytes, Contra splits it into two
          transactions sent in order, Kamino leg then Jupiter leg with the guard, and that case is not atomic.
        </p>
        <div className="mt-8">
          <Exhibit
            letter="G"
            src="/evidence/xstocks-network.webp"
            width={1200}
            height={326}
            alt="xStocks site: $25B+ total transaction volume, 50+ integrated platforms, 8 of the top 11 tokenized equities; partner logos include Kraken, Bybit, Phantom, Solana, Jupiter, Chainlink."
            href="https://xstocks.fi/us"
            label="xstocks.fi/us"
            note="The asset side is already distributed: xStocks claims $25B+ in transaction volume across 50+ platforms. Issuer figure, cited to a Kraken blog post."
            sizes="100vw"
          />
        </div>
      </Sheet>

      <Sheet n={11} slug="Honest status" title="What is not proven yet.">
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

      <Sheet n={12} slug="Next" title="Once real shorts go out, Contra takes a basis-point cut on the close.">
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
