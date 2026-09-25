export default function Loading() {
  return (
    <div className="min-h-[100dvh] bg-[var(--paper)]" aria-busy="true" aria-label="Loading hedge analysis">
      <header className="border-b border-[var(--rule)]">
        <div className="mx-auto max-w-[1180px] px-6 py-6">
          <div className="h-3 w-28 rounded-[var(--radius-ticket)] bg-[var(--rule)]" />
          <div className="mt-3 h-8 w-56 rounded-[var(--radius-ticket)] bg-[var(--rule)]" />
          <div className="mt-2 h-4 w-80 max-w-full rounded-[var(--radius-ticket)] bg-[var(--rule)]" />
        </div>
      </header>
      <main className="mx-auto max-w-[1180px] space-y-6 px-6 py-8">
        <section className="border border-[var(--rule-strong)] bg-[var(--paper-raised)] p-5">
          <div className="h-6 w-36 rounded-[var(--radius-ticket)] bg-[var(--rule)]" />
          <div className="mt-4 space-y-3">
            <div className="h-5 w-full rounded-[var(--radius-ticket)] bg-[var(--rule)]" />
            <div className="h-5 w-11/12 rounded-[var(--radius-ticket)] bg-[var(--rule)]" />
            <div className="h-5 w-4/5 rounded-[var(--radius-ticket)] bg-[var(--rule)]" />
          </div>
        </section>
        <section className="border border-[var(--rule-strong)] bg-[var(--paper-raised)] p-5">
          <div className="h-6 w-44 rounded-[var(--radius-ticket)] bg-[var(--rule)]" />
          <div className="mt-4 h-24 rounded-[var(--radius-ticket)] bg-[var(--rule)]" />
        </section>
      </main>
    </div>
  );
}
