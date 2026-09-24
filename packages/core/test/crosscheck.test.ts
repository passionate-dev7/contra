/**
 * THE PROOF.
 *
 * Decode every PreStocks mint from mainnet, apply the operative scaled-UI multiplier,
 * and compare against the supply the issuer publishes on its own API. Agreement means
 * the decoder reproduces the issuer's number from chain state alone.
 *
 * The negative half asserts the opposite: a naive reader that ignores the multiplier
 * misses by hundreds of percent. Without that half, the positive assertion could not fail.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { decodeAllMints, fetchPreStocksTokens, naiveVsCorrect } from "../src/index.js";
import type { MintFacts } from "../src/types.js";
import type { PreStocksToken } from "../src/prestocks.js";

const TOLERANCE_PCT = 0.01;

let facts: MintFacts[];
let api: Map<string, PreStocksToken>;

function driftPct(chain: number, issuer: number): number {
  return Math.abs(chain / issuer - 1) * 100;
}

beforeAll(async () => {
  const [decoded, tokens] = await Promise.all([decodeAllMints(), fetchPreStocksTokens()]);
  facts = decoded;
  api = new Map(tokens.map((t) => [t.symbol, t]));
  expect(facts.length).toBeGreaterThanOrEqual(8);
}, 180_000);

describe("cross-check: on-chain decode vs the issuer's published supply", () => {
  it("reproduces every published supply within 0.01% using the operative multiplier", () => {
    const rows: string[] = [];
    for (const f of facts) {
      const issuer = api.get(f.symbol);
      expect(issuer, `no API row for ${f.symbol}`).toBeDefined();
      const drift = driftPct(f.effectiveSupply, issuer!.supply);
      rows.push(
        `${f.symbol.padEnd(11)} mult=${String(f.scaledUiAmount?.operativeMultiplier ?? 1).padEnd(10)}` +
          ` chain=${f.effectiveSupply.toFixed(6).padStart(16)}` +
          ` issuer=${issuer!.supply.toFixed(6).padStart(16)}` +
          ` drift=${drift.toExponential(3)}%`,
      );
    }
    console.log("\n  CROSS-CHECK (chain decode vs prestocks.com/api/prestocks)\n  " + rows.join("\n  ") + "\n");

    for (const f of facts) {
      const issuer = api.get(f.symbol)!;
      expect(
        driftPct(f.effectiveSupply, issuer.supply),
        `${f.symbol}: chain ${f.effectiveSupply} vs issuer ${issuer.supply}`,
      ).toBeLessThan(TOLERANCE_PCT);
    }
  });

  it("SPACEX specifically: raw supply x operative multiplier 5 equals the published supply", () => {
    const f = facts.find((x) => x.symbol === "SPACEX")!;
    const issuer = api.get("SPACEX")!;
    expect(f.decimals).toBe(9);
    expect(f.scaledUiAmount?.operativeMultiplier).toBe(5);
    const raw = Number(f.rawSupply) / 10 ** f.decimals;
    console.log(
      `\n  SPACEX raw=${raw} x ${f.scaledUiAmount!.operativeMultiplier} = ${raw * 5}` +
        `  |  issuer=${issuer.supply}  |  drift=${driftPct(raw * 5, issuer.supply).toExponential(3)}%\n`,
    );
    expect(driftPct(raw * 5, issuer.supply)).toBeLessThan(TOLERANCE_PCT);
  });

  /* ---- NEGATIVE CASE: prove the check above is capable of failing ---- */

  it("NEGATIVE: the naive reading (multiplier ignored) fails the same cross-check", () => {
    const scaled = facts.filter((f) => (f.scaledUiAmount?.operativeMultiplier ?? 1) !== 1);
    expect(scaled.length, "expected at least one scaled mint to test against").toBeGreaterThan(0);

    const failures: string[] = [];
    for (const f of scaled) {
      const issuer = api.get(f.symbol)!;
      const naive = Number(f.rawSupply) / 10 ** f.decimals;
      const drift = driftPct(naive, issuer.supply);
      failures.push(
        `${f.symbol.padEnd(11)} naive=${naive.toFixed(6)} issuer=${issuer.supply.toFixed(6)}` +
          ` understated by ${drift.toFixed(4)}% of the true number` +
          ` (issuer/naive = ${(issuer.supply / naive).toFixed(7)}x)`,
      );
      expect(drift, `${f.symbol} naive reading should NOT agree`).toBeGreaterThan(TOLERANCE_PCT);
    }
    console.log("\n  NEGATIVE CASE (naive reader, multiplier ignored) -- all must miss:\n  " + failures.join("\n  ") + "\n");
  });

  it("NEGATIVE: a deliberately stale multiplier reader reports SPACEX 5x low", () => {
    const f = facts.find((x) => x.symbol === "SPACEX")!;
    const issuer = api.get("SPACEX")!;
    const staleMultiplier = Number(f.scaledUiAmount!.multiplier);
    expect(staleMultiplier).toBe(1);
    const stale = (Number(f.rawSupply) / 10 ** f.decimals) * staleMultiplier;
    expect(driftPct(stale, issuer.supply)).toBeGreaterThan(50);
    expect(issuer.supply / stale).toBeCloseTo(5, 3);
  });

  it("naiveVsCorrect quantifies the error the UI needs to display", () => {
    const rows = naiveVsCorrect(facts);
    console.log(
      "\n  NAIVE vs CORRECT\n  " +
        rows.map((r) => `${r.symbol.padEnd(11)} naive=${r.naiveSupply.toFixed(6).padStart(16)} correct=${r.correctSupply.toFixed(6).padStart(16)} error=${r.errorPct.toFixed(4)}%`).join("\n  ") +
        "\n",
    );
    expect(rows).toHaveLength(facts.length);
    const spacex = rows.find((r) => r.symbol === "SPACEX")!;
    expect(spacex.errorPct).toBeCloseTo(400, 6);
    const openai = rows.find((r) => r.symbol === "OPENAI")!;
    expect(openai.errorPct).toBeGreaterThan(40);
    expect(openai.errorPct).toBeLessThan(60);
    for (const r of rows.filter((x) => !["SPACEX", "OPENAI"].includes(x.symbol))) {
      expect(r.errorPct).toBe(0);
    }
  });
});
