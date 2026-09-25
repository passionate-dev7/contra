// Independent check for /docs: every tracked docs/ page renders with its H1,
// every internal link (and #anchor) resolves, and untracked docs/ files are unreachable.
import { execSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { withApp } from "./serve.mjs";

const root = execSync("git rev-parse --show-toplevel").toString().trim();
const git = (a) => execSync(`git ${a}`, { cwd: root }).toString().split("\n").filter(Boolean);
const tracked = git("ls-files docs").filter((f) => f.endsWith(".md"));
const priv = git("ls-files --others --ignored --exclude-standard docs").filter((f) => f.endsWith(".md"));
const fail = (m) => { throw new Error(m); };

const content = path.join(import.meta.dirname, "content");
const shipped = readdirSync(path.join(content, "docs"), { recursive: true }).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`).sort();
if (JSON.stringify(shipped) !== JSON.stringify([...tracked].sort())) fail(`content/docs differs from git ls-files docs: ${shipped} vs ${tracked}; run pnpm --filter @contra/web sync-docs`);
for (const f of tracked) if (readFileSync(path.join(root, f), "utf8") !== readFileSync(path.join(content, f), "utf8")) fail(`${f} is stale in content/docs; run sync-docs`);

const route = (f) => (f === "docs/README.md" ? "/docs" : `/docs/${path.basename(f, ".md")}`);
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

await withApp("@contra/web", 3175, async (get) => {
  const pages = new Map();
  for (const f of tracked) {
    const r = await get(route(f));
    if (r.status !== 200) fail(`${route(f)} returned ${r.status}`);
    const html = await r.text();
    const want = readFileSync(path.join(root, f), "utf8").match(/^# (.+)$/m)[1].replace(/`/g, "");
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    if (!h1 || decode(h1[1]).trim() !== want) fail(`${route(f)} H1 is ${h1 && decode(h1[1])}, want ${want}`);
    pages.set(route(f), html);
  }

  let links = 0;
  for (const [from, html] of pages) {
    const article = html.match(/<article class="doc-prose"[\s\S]*?<\/article>/)[0];
    const bad = article.match(/href="[^"#:]*\.md(#[^"]*)?"/);
    if (bad) fail(`${from} has an unrewritten markdown link ${bad[0]}`);
    for (const [, href] of html.matchAll(/href="((?:\/docs|#)[^"]*)"/g)) {
      const [p, frag] = href.split("#");
      const target = p ? (pages.get(p) ?? fail(`${from} links to ${href}, which is not a docs page`)) : html;
      if (frag && !target.includes(`id="${frag}"`)) fail(`${from} links to ${href}, but no element has id="${frag}"`);
      links++;
    }
  }

  for (const f of priv) {
    const r = await get(route(f));
    if (r.status !== 404) fail(`private ${f} is reachable at ${route(f)} (${r.status})`);
    const line = readFileSync(path.join(root, f), "utf8").match(/^# (.+)$/m)?.[1];
    for (const [p, html] of pages) if (line && html.includes(line)) fail(`private ${f} content appears on ${p}`);
  }

  console.log(`ok: ${pages.size} pages render with their H1, ${links} internal links resolve, ${priv.length} private file(s) unreachable (${priv.join(", ")})`);
});
