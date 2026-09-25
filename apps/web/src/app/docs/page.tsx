import type { Metadata } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/DocsShell";
import { groupDocs, listDocs, renderDoc } from "@/lib/docs";

export const metadata: Metadata = { title: "Docs · Contra", description: "How Contra builds a one-signature xStock short on Solana: tutorials, how-to guides, explanation and reference." };

export default function DocsIndex() {
  // The README's own "Page index" list is replaced by the numbered directory below.
  const doc = renderDoc("README.md", { dropSection: "Page index" });
  return (
    <DocsShell slug="" doc={doc} folio="00 · Overview">
      <section aria-labelledby="directory" className="mt-12">
        <h2 id="directory" className="font-[family-name:var(--font-display)] text-2xl font-semibold">Directory</h2>
        <div className="mt-4 grid grid-cols-1 border-t border-[var(--rule-strong)] sm:grid-cols-2">
          {groupDocs(listDocs()).map((g) => (
            <div key={g.name} className="border-b border-[var(--rule)] py-4 sm:odd:border-r sm:odd:pr-5 sm:even:pl-5">
              <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.14em] text-[var(--accent)]">
                {g.number} {g.name}
              </p>
              <ul className="mt-2 space-y-1">
                {g.docs.map((d) => (
                  <li key={d.slug} className="flex gap-3">
                    <span className="w-8 shrink-0 font-[family-name:var(--font-mono)] text-xs leading-6 text-[var(--ink-dim)]">{d.number}</span>
                    <Link href={`/docs/${d.slug}`} className="underline decoration-[var(--rule-strong)] underline-offset-4 hover:text-[var(--accent)] hover:decoration-[var(--accent)]">
                      {d.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </DocsShell>
  );
}
