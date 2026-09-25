import { spawn, execSync } from "node:child_process";
export async function withApp(filter, port, fn) { execSync(`pnpm --filter ${filter} build`, { stdio: "ignore" }); const srv = spawn("pnpm", ["--filter", filter, "exec", "next", "start", "--port", String(port)], { stdio: "ignore", detached: true });
  const get = async (p) => { for (let i = 0; i < 90; i++) { try { return await fetch(`http://127.0.0.1:${port}${p}`); } catch { await new Promise((r) => setTimeout(r, 1000)); } } throw new Error(`no answer ${p}`); };
  try { return await fn(get); } finally { try { process.kill(-srv.pid); } catch {} } }
export const text = (h) => h.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
