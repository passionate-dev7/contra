// Independent check: blotter shows per-reserve borrow factor, not USDC's LTV repeated.
import { spawn, execSync } from "node:child_process";
execSync("pnpm --filter @contra/web build", { stdio: "ignore" });
const srv = spawn("pnpm", ["--filter", "@contra/web", "exec", "next", "start", "--port", "3141"], { stdio: "ignore", detached: true });
try {
  let r; for (let i = 0; i < 90 && !r; i++) { try { r = await (await fetch("http://127.0.0.1:3141/api/reserves")).json(); } catch { await new Promise((s) => setTimeout(s, 1000)); } }
  const spy = r.find((x) => x.symbol === "SPYx"), tsla = r.find((x) => x.symbol === "TSLAx");
  if (!(spy?.borrowFactor > 1) || !(tsla?.borrowFactor > spy.borrowFactor)) throw new Error(`/api/reserves needs per-reserve borrowFactor from live config: ${JSON.stringify({ spy, tsla }).slice(0, 200)}`);
  const html = (await (await fetch("http://127.0.0.1:3141/")).text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  if (!/borrow factor/i.test(html)) throw new Error("blotter must have a Borrow factor column");
  const pct = (v) => `${Math.round(v * 100)}%`;
  if (!html.includes(pct(spy.borrowFactor)) || !html.includes(pct(tsla.borrowFactor))) throw new Error(`blotter must show ${pct(spy.borrowFactor)} and ${pct(tsla.borrowFactor)}`);
  if (/MAX LTV|LIQ\. LTV/i.test(html) && !/USDC collateral/i.test(html)) throw new Error("per-row Max/Liq LTV columns must be removed or clearly labelled as USDC collateral limits");
  console.log(`ok: borrow factor SPYx ${pct(spy.borrowFactor)}, TSLAx ${pct(tsla.borrowFactor)}; LTV labelled correctly`);
} finally { try { process.kill(-srv.pid); } catch {} }
