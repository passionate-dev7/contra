import Link from "next/link";
import { ArrowSquareOut, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { fmtNum, fmtPct, fmtUsd, shortAddr } from "@/lib/format";
import { ConnectedWalletLink } from "@/components/ConnectedWalletLink";
import { isValidHedgeOwner, readHedge, type HedgeHolding, type HedgePlan } from "@/lib/hedge";

export const revalidate = 0;
export const dynamic = "force-dynamic";

type HedgeSearchParams = { wallet?: string | string[] };

export default async function HedgePage({ searchParams }: { searchParams: Promise<HedgeSearchParams> }) {
  const params = await searchParams;
  const wallet = Array.isArray(params.wallet) ? params.wallet[0] : params.wallet;

  return (
    <div className="min-h-[100dvh] bg-[var(--paper)]">
      <header className="border-b border-[var(--rule)]">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-3 px-6 py-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.16em] text-[var(--accent)]">Contra hedge desk</p>
            <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold">Hedge a holding</h1>
            <p className="mt-1 max-w-lg text-sm text-[var(--ink-dim)]">Read the wallet&apos;s xStock balances, then size a Kamino short against the largest borrowable position.</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-6 py-8">
        <HedgeContent wallet={wallet?.trim() ?? ""} />
      </main>
    </div>
  );
}

async function HedgeContent({ wallet }: { wallet: string }) {
  if (!wallet) {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        <section className="order-2 border border-[var(--rule-strong)] bg-[var(--paper-raised)] p-5 lg:order-1">
          <h2 className="font-[family-name:var(--font-display)] text-lg">How the hedge desk works</h2>
          <ol className="mt-4 space-y-4 text-sm text-[var(--ink-dim)]">
            <li className="flex gap-3">
              <span className="font-[family-name:var(--font-mono)] text-[var(--accent)]">01</span>
              <span>Read every positive xStock (Token-2022) balance sitting in the wallet, live from the RPC.</span>
            </li>
            <li className="flex gap-3">
              <span className="font-[family-name:var(--font-mono)] text-[var(--accent)]">02</span>
              <span>Rank holdings by market value and size a Kamino short against the largest borrowable one.</span>
            </li>
            <li className="flex gap-3">
              <span className="font-[family-name:var(--font-mono)] text-[var(--accent)]">03</span>
              <span>Hand the sized ticket to <Link href="/" className="press-scale text-[var(--accent)] underline underline-offset-2">the order ticket</Link>, prefilled and ready to open.</span>
            </li>
          </ol>
        </section>

        <section className="order-1 border border-[var(--rule-strong)] bg-[var(--paper-raised)] p-5 lg:order-2">
          <h2 className="font-[family-name:var(--font-display)] text-lg">Read a wallet</h2>
          <p className="mt-1 text-sm text-[var(--ink-dim)]">Paste a Solana address to pull its xStock holdings.</p>
          <form action="/hedge" method="get" className="mt-4 flex flex-col gap-2">
            <label htmlFor="hedge-wallet" className="sr-only">Solana wallet address</label>
            <input
              id="hedge-wallet"
              name="wallet"
              type="text"
              required
              autoComplete="off"
              placeholder="Wallet address"
              className="min-w-0 rounded-[var(--radius-ticket)] border border-[var(--rule-strong)] bg-[var(--paper)] px-3 py-2 font-[family-name:var(--font-mono)] text-sm"
            />
            <button type="submit" className="press-scale rounded-[var(--radius-ticket)] bg-[var(--accent)] px-4 py-2.5 font-medium text-[var(--accent-ink)]">
              Read holdings
            </button>
          </form>
          <div className="mt-3">
            <ConnectedWalletLink path="/hedge" param="wallet" />
          </div>
          <Link href="/" className="press-scale mt-4 inline-flex whitespace-nowrap text-sm text-[var(--accent)] underline underline-offset-2">Open the ticket instead</Link>
        </section>
      </div>
    );
  }

  if (!isValidHedgeOwner(wallet)) {
    return (
      <div role="alert" className="flex items-start gap-2 border border-[var(--negative)] bg-[var(--negative)]/5 p-4 text-sm text-[var(--negative)]">
        <WarningCircle size={16} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
        <span>&quot;{wallet}&quot; is not a valid Solana address.</span>
      </div>
    );
  }

  let analysis;
  try {
    analysis = await readHedge(wallet);
  } catch (err) {
    return (
      <div role="alert" className="flex items-start gap-2 border border-[var(--negative)] bg-[var(--negative)]/5 p-4 text-sm text-[var(--negative)]">
        <WarningCircle size={16} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
        <span>Could not read the wallet&apos;s xStock balances: {err instanceof Error ? err.message : String(err)}</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
      <div className="order-2 space-y-6 lg:order-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--ink-dim)]">
          <span>Wallet</span>
          <a href={`https://solscan.io/account/${wallet}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-[family-name:var(--font-mono)] text-[var(--accent)] underline">
            {shortAddr(wallet, 6, 6)}
            <ArrowSquareOut size={12} weight="bold" aria-hidden="true" />
          </a>
        </div>
        <HoldingsTable holdings={analysis.holdings} />
        <SuggestionCard plan={analysis.plan} fallbackReason={analysis.suggestion.reason} />
      </div>

      <aside className="order-1 space-y-6 lg:order-2 lg:sticky lg:top-6 lg:self-start">
        <section className="border border-[var(--rule-strong)] bg-[var(--paper-raised)] p-5">
          <h2 className="font-[family-name:var(--font-display)] text-base">Check another wallet</h2>
          <form action="/hedge" method="get" className="mt-3 flex flex-col gap-2">
            <label htmlFor="hedge-wallet-2" className="sr-only">Solana wallet address</label>
            <input
              id="hedge-wallet-2"
              name="wallet"
              type="text"
              required
              autoComplete="off"
              defaultValue={wallet}
              className="min-w-0 rounded-[var(--radius-ticket)] border border-[var(--rule-strong)] bg-[var(--paper)] px-3 py-2 font-[family-name:var(--font-mono)] text-sm"
            />
            <button type="submit" className="press-scale rounded-[var(--radius-ticket)] border border-[var(--rule-strong)] px-3 py-2 text-sm font-medium">
              Read holdings
            </button>
          </form>
        </section>
        <section className="border border-[var(--rule-strong)] bg-[var(--paper-raised)] p-5">
          <h2 className="font-[family-name:var(--font-display)] text-base">How this is sized</h2>
          <p className="mt-2 text-sm text-[var(--ink-dim)]">
            The suggested hedge shorts half of the largest borrowable holding, sized to the live Kamino max LTV for that
            pair. Adjust size and collateral freely once it opens in the ticket.
          </p>
        </section>
      </aside>
    </div>
  );
}

function HoldingsTable({ holdings }: { holdings: HedgeHolding[] }) {
  return (
    <section aria-labelledby="holdings-heading" className="border border-[var(--rule-strong)] bg-[var(--paper-raised)]">
      <div className="border-b border-[var(--rule)] px-4 py-3 sm:px-5">
        <h2 id="holdings-heading" className="font-[family-name:var(--font-display)] text-lg">xStock holdings</h2>
        <p className="mt-1 text-sm text-[var(--ink-dim)]">Positive Token-2022 balances for this wallet.</p>
      </div>
      {holdings.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm text-[var(--ink-dim)]">No positive xStock holdings were found for this wallet.</p>
          <Link href="/" className="press-scale mt-4 inline-flex whitespace-nowrap rounded-[var(--radius-ticket)] border border-[var(--rule-strong)] px-3 py-2 text-sm">Review the blotter</Link>
        </div>
      ) : (
        <div className="px-4 py-2 sm:px-5">
          <table className="w-full table-fixed text-sm">
            <caption className="sr-only">xStock balances held by the selected wallet</caption>
            <thead>
              <tr className="border-b border-[var(--rule)] text-left text-xs uppercase tracking-wide text-[var(--ink-dim)]">
                <th scope="col" className="w-[22%] py-2 font-medium">Symbol</th>
                <th scope="col" className="w-[25%] py-2 text-right font-medium">Amount</th>
                <th scope="col" className="w-[23%] py-2 text-right font-medium">Value</th>
                <th scope="col" className="w-[30%] py-2 text-right font-medium">Raw amount</th>
              </tr>
            </thead>
            <tbody className="font-[family-name:var(--font-mono)] tabular">
              {holdings.map((holding) => (
                <tr key={holding.mint} className="border-b border-[var(--rule)] last:border-0">
                  <th scope="row" className="break-words py-2.5 text-left font-[family-name:var(--font-body)] font-medium">{holding.symbol}</th>
                  <td className="py-2.5 text-right">{fmtNum(holding.amountUi, 6)}</td>
                  <td className="py-2.5 text-right">{holding.usd === null ? "-" : fmtUsd(holding.usd)}</td>
                  <td className="break-all py-2.5 text-right text-xs text-[var(--ink-dim)]">{holding.amountRaw}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SuggestionCard({ plan, fallbackReason }: { plan: HedgePlan | null; fallbackReason: string }) {
  if (plan === null) {
    return (
      <section aria-labelledby="suggestion-heading" className="border border-[var(--rule-strong)] bg-[var(--paper-raised)] p-5">
        <h2 id="suggestion-heading" className="font-[family-name:var(--font-display)] text-lg">Suggested hedge</h2>
        <p className="mt-3 text-sm text-[var(--ink-dim)]">{fallbackReason}</p>
        <Link href="/" className="press-scale mt-4 inline-flex whitespace-nowrap rounded-[var(--radius-ticket)] border border-[var(--rule-strong)] px-3 py-2 text-sm">Open the ticket</Link>
      </section>
    );
  }

  const href = `/?ticker=${encodeURIComponent(plan.ticker)}&borrowRaw=${encodeURIComponent(plan.borrowRaw)}&usdcCollateral=${encodeURIComponent(String(plan.collateralUsdc))}&usdcCollateralRaw=${encodeURIComponent(plan.collateralRaw)}&sizeUsd=${encodeURIComponent(String(plan.sizeUsd))}`;
  return (
    <section aria-labelledby="suggestion-heading" className="border border-[var(--rule-strong)] bg-[var(--paper-raised)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.16em] text-[var(--accent)]">Suggested hedge</p>
          <h2 id="suggestion-heading" className="mt-1 font-[family-name:var(--font-display)] text-xl">Short {plan.ticker}</h2>
        </div>
        <Link href={href} className="press-scale inline-flex items-center whitespace-nowrap rounded-[var(--radius-ticket)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-ink)]">Open hedge</Link>
      </div>
      <p className="mt-3 max-w-2xl text-sm text-[var(--ink-dim)]">{plan.reason}</p>
      <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3 border-y border-[var(--rule)] py-4 font-[family-name:var(--font-mono)] text-sm tabular sm:grid-cols-4">
        <div>
          <dt className="text-[var(--ink-dim)]">Borrow</dt>
          <dd className="mt-1">{fmtNum(plan.borrowUi, 6)} {plan.ticker}</dd>
        </div>
        <div>
          <dt className="text-[var(--ink-dim)]">Collateral needed</dt>
          <dd className="mt-1">{fmtUsd(plan.collateralUsdc)} USDC</dd>
        </div>
        <div>
          <dt className="text-[var(--ink-dim)]">Safe LTV</dt>
          <dd className="mt-1">{fmtPct(plan.safeLtvPct, 1)}</dd>
        </div>
        <div>
          <dt className="text-[var(--ink-dim)]">Borrow factor</dt>
          <dd className="mt-1">{Math.round(plan.borrowFactor * 100)}%</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-[var(--ink-dim)]">Sized from the live Kamino reserve and the selected holding&apos;s on-chain amount.</p>
    </section>
  );
}
