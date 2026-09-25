import { readFileSync } from "node:fs";
import path from "node:path";
import { Marked, type Tokens } from "marked";

// content/docs is a copy of `git ls-files docs`, refreshed by sync-docs.mjs.
const ROOT = path.join(process.cwd(), "content/docs");

export type DocEntry = { slug: string; file: string; title: string; group: string; number: string };
export type TocItem = { id: string; text: string; depth: number };
export type RenderedDoc = { title: string; html: string; toc: TocItem[] };

const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const slugOf = (file: string) => path.posix.basename(file, ".md");
const plain = (s: string) => s.replace(/`/g, "").replace(/\*\*|__/g, "");

// github-slugger's rule, so anchors written against GitHub's renderer still land.
function slugger() {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base = plain(text).toLowerCase().trim().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "").replace(/ /g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
}

// The sidebar order and grouping are the README's "Page index", so the site
// and the repo index cannot drift apart.
export function listDocs(): DocEntry[] {
  const index = read("README.md").split(/^## Page index\s*$/m)[1] ?? "";
  const out: DocEntry[] = [];
  let group = "";
  let g = 0;
  let i = 0;
  for (const line of index.split("\n")) {
    const link = line.match(/^- \[(.+?)\]\((.+?\.md)\)/);
    if (link) out.push({ slug: slugOf(link[2]), file: link[2], title: link[1], group, number: `${String(g).padStart(2, "0")}.${++i}` });
    else if (/^\S/.test(line) && !line.startsWith("#")) {
      group = line.trim();
      g++;
      i = 0;
    }
  }
  return out;
}

export function groupDocs(docs: DocEntry[]) {
  const groups: { name: string; number: string; docs: DocEntry[] }[] = [];
  for (const d of docs) {
    const last = groups.at(-1);
    if (last?.name === d.group) last.docs.push(d);
    else groups.push({ name: d.group, number: d.number.split(".")[0], docs: [d] });
  }
  return groups;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderDoc(file: string, opts: { dropSection?: string } = {}): RenderedDoc {
  let src = read(file);
  if (opts.dropSection) src = src.split(new RegExp(`^## ${opts.dropSection}\\s*$`, "m"))[0];
  const slugByFile = new Map(listDocs().map((d) => [d.file, d.slug]));
  slugByFile.set("README.md", "");
  const dir = path.posix.dirname(file);
  const slug = slugger();
  const toc: TocItem[] = [];
  let title = "";

  const marked = new Marked({
    gfm: true,
    walkTokens(token) {
      if (token.type !== "link") return;
      const m = token.href.match(/^([^:#?]+\.md)(#.*)?$/);
      if (!m) return;
      const target = slugByFile.get(path.posix.normalize(path.posix.join(dir, m[1])));
      if (target !== undefined) token.href = `/docs${target ? `/${target}` : ""}${m[2] ?? ""}`;
    },
    renderer: {
      heading({ tokens, depth, text }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens);
        if (depth === 1) {
          title ||= plain(text);
          return "";
        }
        const id = slug(text);
        if (depth <= 3) toc.push({ id, text: plain(text), depth });
        return `<h${depth} id="${id}"><a class="doc-anchor" href="#${id}" aria-label="Link to this section">§</a>${inner}</h${depth}>\n`;
      },
      code({ text, lang }: Tokens.Code) {
        const label = lang ? `<figcaption>${esc(lang)}</figcaption>` : "";
        return `<figure class="doc-code">${label}<pre><code>${esc(text)}</code></pre></figure>\n`;
      },
      link({ href, tokens }: Tokens.Link) {
        const external = /^https?:/.test(href);
        return `<a href="${esc(href)}"${external ? ' rel="noreferrer" target="_blank"' : ""}>${this.parser.parseInline(tokens)}</a>`;
      },
    },
  });

  const html = (marked.parse(src, { async: false }) as string)
    .replace(/<table>/g, '<div class="doc-table"><table>')
    .replace(/<\/table>/g, "</table></div>");
  return { title, html, toc };
}
