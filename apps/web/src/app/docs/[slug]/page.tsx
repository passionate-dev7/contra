import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsShell } from "@/components/DocsShell";
import { listDocs, renderDoc } from "@/lib/docs";

export const dynamicParams = false;

export function generateStaticParams() {
  return listDocs().map((d) => ({ slug: d.slug }));
}

const find = (slug: string) => listDocs().find((d) => d.slug === slug);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const entry = find((await params).slug);
  return entry ? { title: `${entry.title} · Contra docs` } : {};
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const entry = find((await params).slug);
  if (!entry) notFound();
  return <DocsShell slug={entry.slug} doc={renderDoc(entry.file)} folio={`${entry.number} · ${entry.group}`} />;
}
