import { describe, it, expect } from "vitest";
import { naiveVsCorrect } from "../src/naive.js";
import type { MintFacts } from "../src/types.js";

function fixture(symbol: string, rawSupply: string, operativeMultiplier: number): MintFacts {
  const effectiveSupply = (Number(rawSupply) / 1e9) * operativeMultiplier;
  return {
    symbol,
    mint: "P".repeat(43),
    ownerProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    decimals: 9,
    rawSupply,
    effectiveSupply,
    transferFee: {
      current: { epoch: 1039, transferFeeBasisPoints: 100, maximumFee: "18446744073709551615" },
      previous: { epoch: 1032, transferFeeBasisPoints: 50, maximumFee: "18446744073709551615" },
      currentBps: 100,
      roundTripBps: 200,
      uncapped: true,
    },
    scaledUiAmount: {
      multiplier: "1",
      newMultiplier: String(operativeMultiplier),
      newMultiplierEffectiveTimestamp: 1,
      operativeMultiplier,
    },
    powers: {
      permanentDelegate: null,
      pausableAuthority: null,
      paused: false,
      transferFeeAuthority: null,
      withdrawWithheldAuthority: null,
      transferHookAuthority: null,
      transferHookProgramId: null,
      scaledUiAmountAuthority: null,
      defaultAccountState: null,
      singleKeyControlsAll: false,
      distinctAuthorities: [],
    },
    extensionsPresent: [],
    asOfUnix: 1_790_000_000,
    slot: 448_716_401,
  };
}

describe("naiveVsCorrect", () => {
  it("reports +400% for a 5x multiplier", () => {
    const [row] = naiveVsCorrect([fixture("SPACEX", "8742506795473", 5)]);
    expect(row!.naiveSupply).toBeCloseTo(8742.506795473, 6);
    expect(row!.correctSupply).toBeCloseTo(43712.533977365, 6);
    expect(row!.errorPct).toBeCloseTo(400, 9);
  });

  it("reports +48.61% for the OPENAI multiplier", () => {
    const [row] = naiveVsCorrect([fixture("OPENAI", "1901883228852", 1.4861347)]);
    expect(row!.errorPct).toBeCloseTo(48.61347, 6);
  });

  it("reports 0% for an unscaled mint", () => {
    const [row] = naiveVsCorrect([fixture("ANTHROPIC", "7381882796239", 1)]);
    expect(row!.errorPct).toBe(0);
    expect(row!.naiveSupply).toBe(row!.correctSupply);
  });

  it("preserves input order and length", () => {
    const rows = naiveVsCorrect([
      fixture("A", "1000000000", 1),
      fixture("B", "2000000000", 5),
      fixture("C", "3000000000", 2),
    ]);
    expect(rows.map((r) => r.symbol)).toEqual(["A", "B", "C"]);
  });

  it("treats a null scaledUiAmount as multiplier 1 rather than throwing", () => {
    const f = fixture("NOEXT", "1000000000", 1);
    f.scaledUiAmount = null;
    const [row] = naiveVsCorrect([f]);
    expect(row!.errorPct).toBe(0);
  });
});

describe("prestocks API client resilience", () => {
  it("reuses one in-flight request instead of hammering a rate-limited issuer", async () => {
    const { fetchPreStocksTokens, clearPreStocksCache } = await import("../src/prestocks.js");
    clearPreStocksCache();
    // A deterministic 200 so the count measures request coalescing, not retry attempts.
    const body = JSON.stringify([
      { symbol: "SPACEX", name: "SpaceX", contract_address: "Pre" + "A".repeat(40), markPrice: 1, tokenPrice: 1, supply: 43712.5 },
    ]);
    const calls: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: any) => {
      calls.push(String(url));
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const [a, b, c] = await Promise.all([
        fetchPreStocksTokens(),
        fetchPreStocksTokens(),
        fetchPreStocksTokens(),
      ]);
      expect(calls).toHaveLength(1);
      expect(a).toBe(b);
      expect(b).toBe(c);
      // served from cache, still no second request
      await fetchPreStocksTokens();
      expect(calls).toHaveLength(1);
      // force bypasses both cache and coalescing
      await fetchPreStocksTokens({ force: true });
      expect(calls).toHaveLength(2);
    } finally {
      globalThis.fetch = real;
      clearPreStocksCache();
    }
  }, 60_000);

  it("retries a 429 rather than failing the run", async () => {
    const { fetchPreStocksTokens, clearPreStocksCache } = await import("../src/prestocks.js");
    clearPreStocksCache();
    const real = globalThis.fetch;
    let n = 0;
    globalThis.fetch = (async (url: any, init: any) => {
      n++;
      if (n <= 2) return new Response("Too Many Requests", { status: 429, headers: { "retry-after": "0" } });
      return real(url, init);
    }) as typeof fetch;
    try {
      const tokens = await fetchPreStocksTokens({ force: true });
      expect(n).toBe(3);
      expect(tokens.length).toBeGreaterThanOrEqual(8);
    } finally {
      globalThis.fetch = real;
      clearPreStocksCache();
    }
  }, 60_000);

  it("gives up with a clear error when the issuer never recovers", async () => {
    const { fetchPreStocksTokens, clearPreStocksCache } = await import("../src/prestocks.js");
    clearPreStocksCache();
    const real = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("Too Many Requests", { status: 429, headers: { "retry-after": "0" } })) as typeof fetch;
    try {
      await expect(fetchPreStocksTokens({ force: true, retries: 1 })).rejects.toThrow(/HTTP 429/);
    } finally {
      globalThis.fetch = real;
      clearPreStocksCache();
    }
  }, 60_000);
});

describe("issuer payload integrity", () => {
  it("retries past a row with a null supply instead of poisoning the cross-check", async () => {
    const { fetchPreStocksTokens, clearPreStocksCache } = await import("../src/prestocks.js");
    clearPreStocksCache();
    const real = globalThis.fetch;
    let n = 0;
    globalThis.fetch = (async (url: any, init: any) => {
      n++;
      if (n === 1) {
        return new Response(
          JSON.stringify([
            { symbol: "SPACEX", name: "SpaceX", contract_address: "Pre" + "A".repeat(40), markPrice: null, tokenPrice: null, supply: null },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return real(url, init);
    }) as typeof fetch;
    try {
      const tokens = await fetchPreStocksTokens({ force: true });
      expect(n).toBe(2);
      for (const t of tokens) expect(Number.isFinite(t.supply)).toBe(true);
    } finally {
      globalThis.fetch = real;
      clearPreStocksCache();
    }
  }, 60_000);

  it("tolerates a null markPrice, which is informational only", async () => {
    const { fetchPreStocksTokens, clearPreStocksCache } = await import("../src/prestocks.js");
    clearPreStocksCache();
    const real = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify([
          { symbol: "SPACEX", name: "SpaceX", contract_address: "Pre" + "A".repeat(40), markPrice: null, tokenPrice: null, supply: 43712.5 },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    try {
      const tokens = await fetchPreStocksTokens({ force: true });
      expect(tokens[0]!.markPrice).toBeNull();
      expect(tokens[0]!.supply).toBe(43712.5);
    } finally {
      globalThis.fetch = real;
      clearPreStocksCache();
    }
  }, 60_000);
});
