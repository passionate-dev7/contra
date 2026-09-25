import Link from "next/link";
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import { readReserveRows, readMarketOpenState, toPublicRow } from "@/lib/reserves";
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

  return (
    <div className="min-h-[100dvh] bg-[var(--paper)]">
      <header className="border-b border-[var(--rule)]">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-2 px-6 py-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">Contra</h1>
            <p className="mt-1 max-w-md text-sm text-[var(--ink-dim)]">
              Short a tokenized US stock in one transaction: deposit USDC on Kamino, borrow the xStock, sell it through Jupiter.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/hedge" className="press-scale whitespace-nowrap text-sm text-[var(--accent)] underline underline-offset-2">
              Hedge a holding
            </Link>
            <Link href="/positions" className="press-scale whitespace-nowrap text-sm text-[var(--accent)] underline underline-offset-2">
              View a position
            </Link>
          </div>
        </div>
      </header>

      <div className="border-b border-[var(--rule)] bg-[var(--paper-raised)]">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3 font-[family-name:var(--font-mono)] text-sm tabular">
          <span className="inline-flex items-center gap-2">
            <span className={`pulse-dot h-2 w-2 rounded-full ${marketOpen ? "bg-[var(--positive)]" : "bg-[var(--negative)]"}`} />
            <span>{`US market ${marketOpen ? "open" : "closed"}`}</span>
          </span>
          <span className="text-[var(--rule-strong)]">·</span>
          <span>{`${borrowableCount} of ${xstocks.length} xStocks can be shorted right now`}</span>
          {marketError && <span className="text-[var(--negative)]">Market state unavailable: {marketError}</span>}
        </div>
      </div>

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
