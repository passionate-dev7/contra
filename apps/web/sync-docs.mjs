// Copies the git-tracked docs/ pages into content/docs so they ship with the app
// (.vercelignore drops docs/). Only `git ls-files docs` is copied, so ignored
// private notes never reach the build.
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const root = execSync("git rev-parse --show-toplevel").toString().trim();
const files = execSync("git ls-files docs", { cwd: root }).toString().split("\n").filter((f) => f.endsWith(".md"));
const out = path.join(import.meta.dirname, "content");
rmSync(path.join(out, "docs"), { recursive: true, force: true });
for (const f of files) {
  mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
  cpSync(path.join(root, f), path.join(out, f));
}
console.log(`synced ${files.length} pages into content/docs`);
