// Independent check: Contra's Pyth fair-value gate matches Hermes read directly. Needs PYTH_API_KEY in env.
import { withApp, text } from "./serve.mjs";
const IDS = { TSLAx: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1", QQQx: "9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d" };
if (!process.env.PYTH_API_KEY) throw new Error("PYTH_API_KEY not in env");
const hermes = async (id) => { const j = await (await fetch(`https://hermes.pyth.network/v2/updates/price/latest?ids[]=${id}&parsed=true`, { headers: { Authorization: `Bearer ${process.env.PYTH_API_KEY}` } })).json(); const p = j.parsed[0].price; return p.price * 10 ** p.expo; };
await withApp("@contra/web", 3172, async (get) => {
  for (const [t, id] of Object.entries(IDS)) {
    const indep = await hermes(id);
    const r = await (await get(`/api/pyth?ticker=${t}`)).json();
    if (!(Math.abs(r.pythPrice - indep) / indep < 0.005)) throw new Error(`${t}: pythPrice ${r.pythPrice} vs Hermes ${indep}`);
    if (!(r.jupiterSellPrice > 0) || !Number.isFinite(r.gapBps) || !r.publishTime) throw new Error(`${t}: needs jupiterSellPrice, gapBps, publishTime: ${JSON.stringify(r).slice(0, 200)}`);
  }
  const spy = await (await get(`/api/pyth?ticker=SPYx`)).json();
  if (spy.pythPrice != null || !/plan|entitle/i.test(spy.reason ?? "")) throw new Error("SPYx must report the feed is not in the current Pyth plan, never a fake price");
  const page = text(await (await get("/")).text());
  if (!/Pyth/.test(page) || !/bps/.test(page)) throw new Error("ticket must show the Pyth fair-value line with the gap in bps");
  console.log("ok: Pyth TSLA and QQQ match Hermes within 0.5%, gap vs Jupiter sell price shown, SPYx honestly unavailable");
});
