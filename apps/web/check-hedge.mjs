import { withApp, text } from "./serve.mjs";
const OWNER = "DrAR2ZNC5KYZps7NJyYHfzeZTaqbMUaGM3CBUWfpbCUs", SPYX = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
const rpc = await (await fetch("https://api.mainnet-beta.solana.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner", params: [OWNER, { mint: SPYX }, { encoding: "jsonParsed" }] }) })).json();
const raw = rpc.result.value.reduce((s, a) => s + Number(a.account.data.parsed.info.tokenAmount.amount), 0);
await withApp("@contra/web", 3171, async (get) => {
  const h = await (await get(`/api/hedge?owner=${OWNER}`)).json();
  const spy = h.holdings?.find((x) => x.symbol === "SPYx");
  if (!spy || Math.abs(Number(spy.amountRaw) - raw) > 1) throw new Error(`hedge must read the owner's raw SPYx balance ${raw}: ${JSON.stringify(spy)}`);
  if (!(h.suggestion?.ticker === "SPYx") || !(Number(h.suggestion.borrowRaw) > 0) || !(Number(h.suggestion.borrowRaw) <= raw)) throw new Error("suggestion must propose a SPYx short no larger than the holding");
  const t = text(await (await get(`/hedge?wallet=${OWNER}`)).text());
  if (!/SPYx/.test(t) || !/hedge/i.test(t)) throw new Error("/hedge page must show the holding and the hedge");
  console.log(`ok: hedge reads ${raw} raw SPYx and proposes ${h.suggestion.borrowRaw}`);
});
