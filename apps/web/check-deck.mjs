// Independent check for the /pitch deck. Owned by the orchestrator.
import { withApp, text } from "./serve.mjs";
await withApp("@contra/web", 3174, async (get) => {
  const html = await (await get("/pitch")).text();
  const slides = (html.match(/data-slide=/g) ?? []).length;
  if (slides < 8) throw new Error(`need >= 8 slides marked data-slide, got ${slides}`);
  if (!/ArrowRight|keydown/.test(html) && !/data-deck-nav/.test(html)) throw new Error("deck needs keyboard navigation (ArrowRight/keydown) or data-deck-nav");
  if (/—|&mdash;/.test(html)) throw new Error("em dash in deck");
  const live = await (await get("/api/reserves")).json();
  const v = String(`${live.filter((x) => /x$/.test(x.symbol) && x.borrowable).length} of ${live.filter((x) => /x$/.test(x.symbol)).length}`);
  if (!text(html).includes(v)) throw new Error(`deck must show the live figure ${v} from /api/reserves`);
  console.log(`ok: ${slides} slides, keyboard nav, live figure ${v}`);
});
