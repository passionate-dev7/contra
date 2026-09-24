export default function Loading() {
  return (
    <div className="min-h-[100dvh] bg-[var(--paper)] px-6 py-8">
      <div className="mx-auto max-w-[1180px] animate-pulse space-y-4">
        <div className="h-8 w-40 rounded bg-[var(--rule)]" />
        <div className="h-4 w-80 rounded bg-[var(--rule)]" />
        <div className="mt-6 h-64 rounded bg-[var(--rule)]" />
      </div>
    </div>
  );
}
