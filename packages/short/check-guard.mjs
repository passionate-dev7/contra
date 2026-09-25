// Independent check: Lighthouse postconditions make a bad outcome revert on-chain.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
const run = (flag) => { execSync(`timeout 300 npx tsx src/simulate-guard.ts ${flag}`, { cwd: new URL(".", import.meta.url).pathname, stdio: "ignore" }); return JSON.parse(readFileSync(new URL(`./artifacts/sim-guard-${flag}.json`, import.meta.url))); };
const ok = run("pass"), bad = run("fail");
const L = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";
if (ok.err !== null) throw new Error(`guarded open must succeed: ${JSON.stringify(ok.err)}`);
if (!ok.logs.some((l) => l.includes(`Program ${L} invoke`))) throw new Error("Lighthouse must be invoked in the guarded transaction");
if (bad.err === null) throw new Error("impossible postcondition must make the transaction revert");
if (!bad.logs.some((l) => l.includes(`Program ${L} failed`) || l.includes(`${L} consumed`) && /fail/i.test(bad.logs.join(" ")))) throw new Error("revert must come from Lighthouse");
console.log(`ok: guarded open succeeds with Lighthouse assertion; impossible postcondition reverts (${JSON.stringify(bad.err)})`);
