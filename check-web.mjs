// Independent check for the Contra web app. Owned by the orchestrator.
import { spawn, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("./packages/exec/package.json", import.meta.url));
const { VersionedTransaction } = require("@solana/web3.js");
const PORT = 3131, KLEND = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD", JUP = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
if (!existsSync(new URL("./DESIGN.md", import.meta.url))) throw new Error("no DESIGN.md at repo root");
const log = readFileSync(process.env.HOME + "/.config/agent-rules/frontend/design-log.jsonl", "utf8").trim().split("\n");
if (!log.some((l) => l.includes("stocklana/contra"))) throw new Error("design-log.jsonl has no entry for contra");
execSync("pnpm --filter @contra/web build", { stdio: "ignore" });
const srv = spawn("pnpm", ["--filter", "@contra/web", "exec", "next", "start", "--port", String(PORT)], { stdio: "ignore", detached: true });
const get = async (p, init) => { for (let i = 0; i < 90; i++) { try { return await fetch(`http://127.0.0.1:${PORT}${p}`, init); } catch { await new Promise((r) => setTimeout(r, 1000)); } } throw new Error(`no answer ${p}`); };
try {
  const r = await (await get("/api/reserves")).json();
  const open = r.filter((x) => x.borrowable).map((x) => x.symbol).sort().join(",");
  if (open !== "NVDAx,QQQx,SPYx,TSLAx") throw new Error(`borrowable set must come from live reserve config; got ${open}`);
  if (!r.some((x) => x.symbol === "MSTRx" && !x.borrowable && /limit/i.test(x.reason ?? ""))) throw new Error("blocked tickers must say why (borrow limit 0)");
  const home = await (await get("/")).text();
  if (!/4 of 9/.test(home.replace(/<[^>]+>/g, " "))) throw new Error('home must state "4 of 9" xStocks can be shorted');
  if (!/market (open|closed)/i.test(home.replace(/<[^>]+>/g, " "))) throw new Error("home must show US market open/closed state");
  const o = await (await get("/api/open", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ owner: "sadmBTQm5HJsyzWHEjV4YwG9CiahZKVDVqAyS4Wx1zH", ticker: "SPYx", usdcCollateral: "500000", borrowRaw: "100000" }) })).json();
  const txs = o.transactions ?? (o.txBase64 ? [o.txBase64] : []);
  if (!txs.length) throw new Error(`/api/open returned no transaction: ${JSON.stringify(o).slice(0, 200)}`);
  const progs = new Set(txs.flatMap((b) => { const t = VersionedTransaction.deserialize(Buffer.from(b, "base64")); return t.message.compiledInstructions.map((i) => t.message.staticAccountKeys[i.programIdIndex]?.toBase58()); }));
  if (!progs.has(KLEND) || !progs.has(JUP)) throw new Error(`open-short tx must call Kamino and Jupiter; programs: ${[...progs].join(",")}`);
  console.log(`ok: DESIGN.md + log entry, live borrowable set ${open}, 4 of 9 stated, market state shown, open tx calls Kamino + Jupiter`);
} finally { try { process.kill(-srv.pid); } catch {} }
