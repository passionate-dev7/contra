import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import { readReserveRows, readMarketOpenState, toPublicRow } from "@/lib/reserves";
import { readPythFair, type PythFair } from "@/lib/pyth-fair";
import { Blotter } from "@/components/Blotter";
import { Ticket } from "@/components/Ticket";

export const revalidate = 0;
export const dynamic = "force-dynamic";

type HomeSearchParams = {
  ticker?: string | string[];
  borrowRaw?: string | string[];
  usdcCollateralRaw?: string | string[];
  usdcCollateral?: string | string[];
  sizeUsd?: string | string[];
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveNumberParam(value: string | string[] | undefined): string | undefined {
  const raw = firstParam(value);
  if (raw === undefined || !/^\d+(?:\.\d+)?$/.test(raw)) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? raw : undefined;
}

function rawAmountParam(value: string | string[] | undefined): string | undefined {
  const raw = firstParam(value);
  return raw !== undefined && /^\d+$/.test(raw) && BigInt(raw) > 0n ? raw : undefined;
}

export default async function HomePage({ searchParams }: { searchParams: Promise<HomeSearchParams> }) {
  const params = await searchParams;
  const initialTicker = firstParam(params.ticker);
  const initialSizeUsd = positiveNumberParam(params.sizeUsd);
  const initialCollateralUsdc = positiveNumberParam(params.usdcCollateral);
  const initialBorrowRaw = rawAmountParam(params.borrowRaw);
  const initialCollateralRaw = rawAmountParam(params.usdcCollateralRaw);
  let rows: ReturnType<typeof toPublicRow>[] = [];
  let marketOpen = false;
  let marketError: string | null = null;
  let loadError: string | null = null;

  try {
    const reserveRows = await readReserveRows();
    rows = reserveRows.map(toPublicRow);
    const market = await readMarketOpenState();
    marketOpen = market.isOpen;
    marketError = market.error;
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  const xstocks = rows.filter((r) => r.isXstock);
  const borrowableCount = xstocks.filter((r) => r.borrowable).length;
  const pythKeyPresent = Boolean(process.env.PYTH_API_KEY?.trim());

  // Server-render the fair-value line for the ticket's default ticker so the
  // first paint already shows the Pyth price and the gap in bps. Bounded so a
  // slow quote never holds the page; the ticket refetches on ticker change.
  const ssrTicker =
    initialTicker ?? xstocks.find((r) => r.borrowable)?.symbol ?? xstocks[0]?.symbol ?? null;
  let initialPyth: PythFair | null = null;
  if (ssrTicker !== null) {
    try {
      initialPyth = await Promise.race([
        readPythFair(ssrTicker),
        new Promise<PythFair | null>((resolve) => setTimeout(() => resolve(null), 12_000)),
      ]);
    } catch {
      initialPyth = null;
    }
  }

  return (
    <div className="min-h-[100dvh] bg-[var(--paper)]">
      <header className="border-b border-[var(--rule)] bg-[var(--paper-raised)]">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-5 px-6 py-5 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
          <div className="min-w-0">
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">Contra</h1>
            <p className="mt-1 max-w-md text-sm text-[var(--ink-dim)]">
              Short a tokenized US stock in one transaction: deposit USDC on Kamino, borrow the xStock, sell it through Jupiter.
            </p>
          </div>

          <div className="flex items-stretch divide-x divide-[var(--rule)] border-y border-[var(--rule)] py-3 lg:border-y-0 lg:border-x lg:px-8 lg:py-1">
            <div className="flex flex-1 flex-col justify-center px-4 first:pl-0 lg:px-6">
              <span className="font-[family-name:var(--font-display)] text-2xl font-semibold tabular leading-none">
                {`${borrowableCount} of ${xstocks.length}`}
              </span>
              <span className="mt-1 text-[11px] uppercase tracking-[0.08em] text-[var(--ink-dim)]">xStocks shortable now</span>
            </div>
            <div className="flex flex-1 flex-col justify-center px-4 last:pr-0 lg:px-6">
              <span className="inline-flex items-center gap-1.5 font-[family-name:var(--font-display)] text-2xl font-semibold leading-none">
                <span className={`pulse-dot h-2 w-2 shrink-0 rounded-full ${marketOpen ? "bg-[var(--positive)]" : "bg-[var(--negative)]"}`} />
                {`US market ${marketOpen ? "open" : "closed"}`}
              </span>
              <span className="mt-1 block text-[11px] uppercase tracking-[0.08em] text-[var(--ink-dim)]">
                {marketError ? "state unavailable" : "SPY feed, live"}
              </span>
            </div>
          </div>

        </div>
        {marketError && (
          <div className="border-t border-[var(--rule)] bg-[var(--negative)]/5 px-6 py-2 text-center text-xs text-[var(--negative)]">
            Market state unavailable: {marketError}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1180px] px-6 py-8">
        {loadError ? (
          <div className="rounded-[var(--radius-ticket)] border border-[var(--negative)] bg-[var(--negative)]/5 p-4 text-sm text-[var(--negative)]">
            Could not read the xStocks market from the configured RPC: {loadError}
          </div>
        ) : xstocks.length === 0 ? (
          <div className="rounded-[var(--radius-ticket)] border border-[var(--rule-strong)] p-8 text-center text-sm text-[var(--ink-dim)]">
            No reserves were found in the xStocks market.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
            <Blotter initialRows={rows} />
            <Ticket
              rows={rows}
              marketOpen={marketOpen}
              pythKeyPresent={pythKeyPresent}
              initialPyth={initialPyth}
              initialTicker={initialTicker}
              initialSizeUsd={initialSizeUsd}
              initialCollateralUsdc={initialCollateralUsdc}
              initialBorrowRaw={initialBorrowRaw}
              initialCollateralRaw={initialCollateralRaw}
            />
          </div>
        )}
      </main>

      <footer className="border-t border-[var(--rule)] px-6 py-4 text-center text-xs text-[var(--ink-dim)]">
        Kamino market{" "}
        <a
          href="https://solscan.io/account/5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 underline"
        >
          5wJe…Lsua
          <ArrowSquareOut size={11} weight="bold" />
        </a>
        . Non-US use only.
      </footer>
    </div>
  );
}
