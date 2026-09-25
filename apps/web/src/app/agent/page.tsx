import Link from "next/link";
import { Binoculars, Checks, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { agentTick, type AgentStep } from "@/lib/agent";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Contra agent",
  description: "Autonomous short agent for tokenized stocks. Reads Kamino and Pyth, picks a short, hands the wallet one transaction to sign.",
};

function phaseOf(step: AgentStep): "observe" | "decide" | "act" {
  if (step.step === "select") return "decide";
  if (step.step === "build") return "act";
  return "observe";
}

const PHASE_LABEL = {
  observe: "Observe",
  decide: "Decide",
  act: "Act",
} as const;

export default async function AgentPage({
  searchParams,
}: {
  searchParams: Promise<{ owner?: string }>;
}) {
  const { owner } = await searchParams;
  const cleanOwner = owner?.trim() || undefined;

  let result: Awaited<ReturnType<typeof agentTick>> | null = null;
  let error: string | null = null;
  try {
    result = await agentTick({ owner: cleanOwner });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="min-h-[100dvh] bg-[var(--paper)]">
      <header className="border-b border-[var(--rule)]">
        <div className="mx-auto max-w-[1180px] px-6 py-6">
          <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.14em] text-[var(--accent)]">
            Stocknized agent track
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold">
            <Link href="/">Contra</Link> · Agent
          </h1>
          <p className="mt-2 max-w-[60ch] text-sm text-[var(--ink-dim)]">
            The agent reads Kamino and Pyth, picks a short, and hands the wallet one transaction to sign.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-6 py-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
          <section aria-label="Decision log" className="order-2 min-w-0 lg:order-1">
            {error !== null ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-[var(--radius-ticket)] border border-[var(--negative)] bg-[var(--negative)]/5 p-4 text-sm text-[var(--negative)]"
              >
                <WarningCircle size={16} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
                <span>The tick failed before it could decide: {error}</span>
              </div>
            ) : result !== null && result.steps.length === 0 ? (
              <div className="rounded-[var(--radius-ticket)] border border-[var(--rule-strong)] bg-[var(--paper-raised)] p-5 text-sm text-[var(--ink-dim)]">
                No steps recorded. Reload to run the tick again.
              </div>
            ) : (
              result !== null && (
                <ol className="m-0 list-none p-0">
                  {result.steps.map((s, i) => {
                    const phase = phaseOf(s);
                    return (
                      <li key={`${s.step}-${i}`} className="relative flex gap-4 pb-6 last:pb-0">
                        <div aria-hidden="true" className="flex flex-col items-center">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--rule-strong)] bg-[var(--paper-raised)] font-[family-name:var(--font-mono)] text-xs text-[var(--ink)]">
                            {i + 1}
                          </span>
                          {i < result.steps.length - 1 && <span className="mt-1 w-px flex-1 bg-[var(--rule-strong)]" />}
                        </div>
                        <div className="min-w-0 flex-1 rounded-[var(--radius-ticket)] border border-[var(--rule-strong)] bg-[var(--paper-raised)] p-4">
                          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="rounded-full border border-[var(--accent)] px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--accent)]">
                              {PHASE_LABEL[phase]}
                            </span>
                            <span className="font-[family-name:var(--font-display)] text-base font-semibold">{s.step}</span>
                          </p>
                          <dl className="mt-3 space-y-2 text-sm">
                            <div>
                              <dt className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.1em] text-[var(--ink-dim)]">
                                Observed
                              </dt>
                              <dd className="mt-0.5 break-words text-[var(--ink)]">{s.observed}</dd>
                            </div>
                            <div>
                              <dt className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.1em] text-[var(--ink-dim)]">
                                Decision
                              </dt>
                              <dd className="mt-0.5 break-words text-[var(--ink)]">{s.decision}</dd>
                            </div>
                            <div>
                              <dt className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.1em] text-[var(--ink-dim)]">
                                Reason
                              </dt>
                              <dd className="mt-0.5 break-words text-[var(--ink-dim)]">{s.reason}</dd>
                            </div>
                          </dl>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )
            )}
          </section>

          <aside className="order-1 min-w-0 lg:order-2 lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-[var(--radius-ticket)] border border-[var(--rule-strong)] bg-[var(--paper-raised)] p-5">
              <h2 className="flex items-center gap-2 font-[family-name:var(--font-display)] text-lg font-semibold">
                <Binoculars size={20} aria-hidden="true" />
                Verdict
              </h2>
              {result !== null && (
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="flex items-baseline justify-between gap-3 border-b border-[var(--rule)] pb-3">
                    <dt className="text-[var(--ink-dim)]">Market</dt>
                    <dd className="flex items-center gap-1.5 font-medium tabular-nums">
                      <span
                        aria-hidden="true"
                        className={`inline-block h-2 w-2 rounded-full ${result.marketOpen ? "bg-[var(--positive)]" : "bg-[var(--negative)]"}`}
                      />
                      {result.marketOpen ? "Open" : "Closed"}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 border-b border-[var(--rule)] pb-3">
                    <dt className="text-[var(--ink-dim)]">Ticker</dt>
                    <dd className="font-[family-name:var(--font-mono)] font-medium tabular-nums">
                      {result.ticker ?? "none"}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-[var(--ink-dim)]">Unsigned tx</dt>
                    <dd className="font-medium tabular-nums">
                      {result.transactions !== null ? `${result.transactions.length} ready` : "none"}
                    </dd>
                  </div>
                </dl>
              )}
              {result?.route !== null && result?.route !== undefined && (
                <p className="mt-3 break-words font-[family-name:var(--font-mono)] text-xs text-[var(--ink-dim)]">
                  Route: {result.route}
                </p>
              )}
              <h3 className="mt-5 flex items-center gap-2 text-sm font-semibold">
                <Checks size={16} aria-hidden="true" />
                Hand it a wallet
              </h3>
              <p className="mt-1 text-sm text-[var(--ink-dim)]">
                Add an owner address and the agent builds the unsigned open for that wallet to sign.
              </p>
              <form method="get" className="mt-3 flex flex-col gap-2">
                <label
                  htmlFor="agent-owner"
                  className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.1em] text-[var(--ink-dim)]"
                >
                  Owner address
                </label>
                <input
                  id="agent-owner"
                  name="owner"
                  defaultValue={cleanOwner ?? ""}
                  placeholder="Solana wallet address"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-11 w-full min-w-0 rounded-[var(--radius-ticket)] border border-[var(--rule-strong)] bg-[var(--paper)] px-3 py-2 font-[family-name:var(--font-mono)] text-xs text-[var(--ink)]"
                />
                <button
                  type="submit"
                  className="press-scale h-11 rounded-[var(--radius-ticket)] border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-ink)]"
                >
                  Run tick for this wallet
                </button>
              </form>
              {result?.transactions !== null && result?.transactions !== undefined && (
                <p className="mt-3 break-words font-[family-name:var(--font-mono)] text-xs text-[var(--ink-dim)]">
                  First tx: {result.transactions[0]?.slice(0, 44)}…
                </p>
              )}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
