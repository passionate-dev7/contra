import Link from "next/link";
import { ArrowLeft, ArrowRight, CaretDown } from "@phosphor-icons/react/dist/ssr";
import { groupDocs, listDocs, type RenderedDoc } from "@/lib/docs";

// One page of the docs ledger: sidebar index, the article, its TOC, prev/next.
// `slug` is "" for the /docs index.
export function DocsShell({ slug, doc, folio, children }: { slug: string; doc: RenderedDoc; folio: string; children?: React.ReactNode }) {
  const docs = listDocs();
  const order = [{ slug: "", title: "Overview" }, ...docs];
  const at = order.findIndex((d) => d.slug === slug);
  const prev = order[at - 1];
  const next = order[at + 1];
  const href = (s: string) => (s ? `/docs/${s}` : "/docs");
  const current = order[at]?.title ?? doc.title;

  const index = (
    <nav aria-label="Documentation" className="text-sm">
      <Link
        href="/docs"
        aria-current={slug === "" ? "page" : undefined}
        className="doc-side-link flex gap-3 border-l-2 py-1.5 pl-3"
      >
        <span className="w-8 shrink-0 font-[family-name:var(--font-mono)] text-xs leading-5 text-[var(--ink-dim)]">00</span>
        Overview
      </Link>
      {groupDocs(docs).map((g) => (
        <div key={g.name} className="mt-5">
          <p className="mb-1.5 pl-[14px] font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.14em] text-[var(--ink-dim)]">
            {g.number} {g.name}
          </p>
          {g.docs.map((d) => (
            <Link
              key={d.slug}
              href={href(d.slug)}
              aria-current={d.slug === slug ? "page" : undefined}
              className="doc-side-link flex gap-3 border-l-2 py-1.5 pl-3"
            >
              <span className="w-8 shrink-0 font-[family-name:var(--font-mono)] text-xs leading-5 text-[var(--ink-dim)]">{d.number}</span>
              {d.title}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );

  const toc = doc.toc.length > 0 && (
    <ol className="space-y-1.5 text-[13px]">
      {doc.toc.map((t) => (
        <li key={t.id} className={t.depth === 3 ? "pl-3" : undefined}>
          <a href={`#${t.id}`} className="block text-[var(--ink-dim)] hover:text-[var(--accent)]">
            {t.text}
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="mx-auto grid max-w-[1180px] grid-cols-1 gap-x-10 px-6 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_200px]">
      <aside className="hidden border-r border-[var(--rule)] py-10 pr-6 lg:block">
        <div className="sticky top-6">{index}</div>
      </aside>

      <details className="doc-drawer mt-4 rounded-[var(--radius-ticket)] border border-[var(--rule-strong)] bg-[var(--paper-raised)] lg:hidden">
        <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm">
          <span className="min-w-0 truncate">
            <span className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.14em] text-[var(--ink-dim)]">Contents · </span>
            {current}
          </span>
          <CaretDown size={14} weight="bold" aria-hidden="true" className="doc-drawer-caret shrink-0" />
        </summary>
        <div className="border-t border-[var(--rule)] px-1 py-4">{index}</div>
      </details>

      <main className="min-w-0 py-8 lg:py-10">
        <header className="border-b-[3px] border-double border-[var(--rule-strong)] pb-5">
          <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.14em] text-[var(--accent)]">{folio}</p>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold leading-tight sm:text-4xl">{doc.title}</h1>
        </header>

        {toc && (
          <details className="doc-drawer mt-5 border-b border-[var(--rule)] pb-3 xl:hidden">
            <summary className="flex cursor-pointer items-center gap-2 font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.14em] text-[var(--ink-dim)]">
              On this page
              <CaretDown size={12} weight="bold" aria-hidden="true" className="doc-drawer-caret" />
            </summary>
            <div className="pt-3">{toc}</div>
          </details>
        )}

        <article className="doc-prose" dangerouslySetInnerHTML={{ __html: doc.html }} />
        {children}

        <nav aria-label="Pager" className="mt-14 grid grid-cols-1 border border-[var(--rule-strong)] sm:grid-cols-2">
          {prev ? (
            <Link href={href(prev.slug)} rel="prev" className="doc-pager group border-b border-[var(--rule)] p-4 sm:border-r sm:border-b-0">
              <span className="flex items-center gap-1.5 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.14em] text-[var(--ink-dim)]">
                <ArrowLeft size={12} weight="bold" aria-hidden="true" /> Previous
              </span>
              <span className="mt-1 block font-[family-name:var(--font-display)] text-lg group-hover:text-[var(--accent)]">{prev.title}</span>
            </Link>
          ) : (
            <span className="hidden sm:block sm:border-r sm:border-[var(--rule)]" />
          )}
          {next && (
            <Link href={href(next.slug)} rel="next" className="doc-pager group p-4 text-right">
              <span className="flex items-center justify-end gap-1.5 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.14em] text-[var(--ink-dim)]">
                Next <ArrowRight size={12} weight="bold" aria-hidden="true" />
              </span>
              <span className="mt-1 block font-[family-name:var(--font-display)] text-lg group-hover:text-[var(--accent)]">{next.title}</span>
            </Link>
          )}
        </nav>
      </main>

      {toc && (
        <aside className="hidden py-10 xl:block">
          <div className="sticky top-6 border-l border-[var(--rule)] pl-4">
            <p className="mb-3 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.14em] text-[var(--ink-dim)]">On this page</p>
            {toc}
          </div>
        </aside>
      )}
    </div>
  );
}
