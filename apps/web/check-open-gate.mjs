// Independent check: /api/open refuses with 409 exactly when Hermes itself says the US equity market is closed.
import { withApp } from "./serve.mjs";
const PORT = 3174;
const OWNER = "CtB2LNTpRnD97zTcDqMnTih7usipMxrD5WYsdiC9V3Jb";
await withApp("@contra/web", PORT, async (get) => {
  await get("/api/reserves");
  for (const ticker of ["TSLAx", "SPYx"]) {
    const feeds = await (await fetch(`https://hermes.pyth.network/v2/price_feeds?query=Equity.US.${ticker.slice(0, -1)}`)).json();
    const feed = feeds.find((f) => f.attributes.symbol === `Equity.US.${ticker.slice(0, -1)}/USD`);
    if (!feed) throw new Error(`${ticker}: no Hermes feed`);
    const open = feed.market_hours?.is_open === true;
    const res = await fetch(`http://127.0.0.1:${PORT}/api/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner: OWNER, ticker, usdcCollateral: "1000000", borrowRaw: "1000" }),
    });
    const body = await res.json();
    if (!open && (res.status !== 409 || !/market is closed/.test(body.error ?? ""))) throw new Error(`${ticker}: Hermes says closed, /api/open returned ${res.status} ${JSON.stringify(body).slice(0, 160)}`);
    if (open && res.status === 409) throw new Error(`${ticker}: Hermes says open, /api/open still refused: ${body.error}`);
    console.log(`ok: ${ticker} market ${open ? "open" : "closed"} per Hermes, /api/open ${res.status}`);
  }
});
