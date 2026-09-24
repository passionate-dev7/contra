import { resolveEquityFeed, requireFreshEquityPrice } from "../src/pyth.ts";

for (const t of ["TSLA", "SPY", "QQQ", "NVDA"]) {
  try {
    const feed = await resolveEquityFeed(t);
    console.log(t, feed);
  } catch (e) {
    console.log(t, "ERROR", e.message);
  }
}

try {
  await requireFreshEquityPrice("TSLA");
} catch (e) {
  console.log("requireFreshEquityPrice TSLA ->", e.constructor.name, e.message);
}
