import { address, createSolanaRpc } from "@solana/kit";
import { Scope } from "@kamino-finance/scope-sdk";
import * as T from "@kamino-finance/scope-sdk/dist/@codegen/scope/types/index.js";
const rpc = createSolanaRpc(process.env.RPC_URL || "https://api.mainnet-beta.solana.com");
const scope = new Scope("mainnet-beta", rpc);
const prices = address("3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH");
const [cfgAddr] = await scope.getSingleFeedConfiguration({ prices });
const m = await scope.getOracleMappings({ config: cfgAddr });
const op = await scope.getSingleOraclePrices({ prices });
const now = Math.floor(Date.now() / 1000);
const kinds = Object.values(T.OracleType).filter((c) => typeof c === "function" && c.discriminator !== undefined);
const kindOf = (d) => kinds.find((c) => c.discriminator === d)?.kind ?? `?${d}`;
const seen = new Set();
function walk(i, depth) {
  if (i >= m.priceTypes.length || seen.has(i)) return;
  seen.add(i);
  const g = Buffer.from(m.generic[i]);
  const k = kindOf(m.priceTypes[i]);
  const p = op.prices[i];
  console.log(`${"  ".repeat(depth)}${i} ${k} acct ${m.priceInfoAccounts[i]} ts ${p.unixTimestamp} age ${now - Number(p.unixTimestamp)}s twapSrc ${m.twapSource[i]} generic ${g.toString("hex").slice(0, 32)}`);
  if (k === "CappedFloored") { walk(g.readUInt16LE(0), depth + 1); if (g[2]) walk(g.readUInt16LE(3), depth + 1); const o = g[2] ? 5 : 3; if (g[o]) walk(g.readUInt16LE(o + 1), depth + 1); }
  if (k === "MostRecentOf" || k === "CappedMostRecentOf") for (let j = 0; j < 4; j++) walk(g.readUInt16LE(j * 2), depth + 1);
  if (k === "ScopeTwap") walk(m.twapSource[i], depth + 1);
}
for (const i of (process.env.IDX ?? "344,279,338,273,13").split(",").map(Number)) walk(i, 0);
