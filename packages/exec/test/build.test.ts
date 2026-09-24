import { describe, expect, it } from "vitest";
import { VersionedTransaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import type { SwapRequest } from "@fineprint/core";
import { defaultConnection } from "../src/index.js";
import {
  buildUnsignedSwap,
  isFullyUnsigned,
  resolvedAccountKeys,
  type UnsignedSwap,
} from "../src/build.js";
import { netAfterTransferFee, transferFeeOf } from "../src/fee.js";

/**
 * A well known funded mainnet account, used ONLY as the subject of a read-only
 * simulation. No key exists in this repository, nothing is signed, nothing is sent.
 */
const SIMULATION_SUBJECT = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";

const MINTS: Array<{ symbol: string; mint: string; notionalUsd: number }> = [
  {
    symbol: "SPACEX",
    mint: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh",
    notionalUsd: 250,
  },
  {
    symbol: "ANTHROPIC",
    mint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw",
    notionalUsd: 250,
  },
];

function request(m: (typeof MINTS)[number]): SwapRequest {
  return {
    symbol: m.symbol,
    mint: m.mint,
    notionalUsd: m.notionalUsd,
    userPublicKey: SIMULATION_SUBJECT,
    slippageBps: 100,
  };
}

function bpsDrift(a: bigint, b: bigint): number {
  if (b === 0n) {
    return Number.POSITIVE_INFINITY;
  }
  return (Math.abs(Number(a - b)) / Number(b)) * 10_000;
}

describe.each(MINTS)(
  "buildUnsignedSwap on mainnet: $symbol",
  (m) => {
    let built: UnsignedSwap;

    it("builds a real unsigned Jupiter transaction", async () => {
      built = await buildUnsignedSwap(defaultConnection(), request(m));
      // eslint-disable-next-line no-console
      console.log(
        `${m.symbol} route=${built.route} semantics=${built.quoteSemantics} ` +
          `bps=${String(built.facts.inForceBps)} epoch=${String(built.facts.currentEpoch)} ` +
          `quoteOut=${built.quote.outAmount} expectedGross=${built.expectedGrossRaw.toString()} ` +
          `expectedNet=${built.expectedNetRaw.toString()} fee=${built.transferFeeRaw.toString()} ` +
          `simGross=${built.simulation.simulatedGrossRaw.toString()} ` +
          `simNet=${built.simulation.simulatedNetRaw.toString()} ` +
          `simWithheld=${built.simulation.simulatedWithheldRaw.toString()} ` +
          `units=${String(built.simulation.unitsConsumed)}`,
      );
      expect(built.quote.outputMint).toBe(m.mint);
      expect(BigInt(built.quote.outAmount)).toBeGreaterThan(0n);
      expect(built.route.length).toBeGreaterThan(0);
    });

    it("is unsigned and survives a serialize/deserialize round trip", () => {
      expect(isFullyUnsigned(built.transaction)).toBe(true);
      const bytes = built.transaction.serialize();
      const again = VersionedTransaction.deserialize(bytes);
      expect(Buffer.from(again.serialize()).equals(Buffer.from(bytes))).toBe(true);
      expect(again.message.compiledInstructions.length).toBeGreaterThan(0);
    });

    it("touches the Token-2022 program, which is reachable only through the lookup tables", async () => {
      const staticKeys = built.transaction.message.staticAccountKeys.map((k) =>
        k.toBase58(),
      );
      const resolved = (
        await resolvedAccountKeys(defaultConnection(), built.transaction)
      ).map((k) => k.toBase58());
      const t22 = TOKEN_2022_PROGRAM_ID.toBase58();

      expect(resolved).toContain(t22);
      // The trap: a naive staticAccountKeys check misses it entirely.
      expect(staticKeys).not.toContain(t22);
      expect(built.transaction.message.addressTableLookups.length).toBeGreaterThan(0);
    });

    it("simulates on mainnet without error", () => {
      expect(built.simulation.err).toBeNull();
      expect(built.simulation.unitsConsumed ?? 0).toBeGreaterThan(0);
      expect(built.simulation.simulatedNetRaw).toBeGreaterThan(0n);
      expect(built.simulation.simulatedWithheldRaw).toBeGreaterThan(0n);
    });

    it("the withheld fee the live program produced matches our arithmetic exactly", () => {
      const expectedWithheld = transferFeeOf(
        built.simulation.simulatedGrossRaw,
        built.facts.inForceBps,
        built.facts.inForceMaximumFee,
      );
      expect(built.simulation.simulatedWithheldRaw).toBe(expectedWithheld);
      expect(
        built.simulation.simulatedNetRaw + built.simulation.simulatedWithheldRaw,
      ).toBe(built.simulation.simulatedGrossRaw);
    });

    it("the net the live program produced is exactly gross minus our computed fee", () => {
      // Drift-free: both sides come from the same simulated slot. If the fee
      // subtraction is removed this is immediately red.
      expect(
        netAfterTransferFee(
          built.simulation.simulatedGrossRaw,
          built.facts.inForceBps,
          built.facts.inForceMaximumFee,
        ),
      ).toBe(built.simulation.simulatedNetRaw);
    });

    it("expected net delta tracks the simulated net delta inside the fee itself", () => {
      // The bound must stay below the in-force fee, otherwise dropping the fee
      // subtraction would still pass. Quote-to-simulation drift on a thin book
      // has been measured at ~11 bps, so 80% of the fee is the working band.
      expect(
        bpsDrift(built.expectedNetRaw, built.simulation.simulatedNetRaw),
      ).toBeLessThan(built.facts.inForceBps * 0.8);
      expect(built.expectedGrossRaw - built.expectedNetRaw).toBe(
        built.transferFeeRaw,
      );
      expect(built.transferFeeRaw).toBe(
        transferFeeOf(
          built.expectedGrossRaw,
          built.facts.inForceBps,
          built.facts.inForceMaximumFee,
        ),
      );
      expect(built.transferFeeRaw).toBeGreaterThan(0n);
    });

    it("the slippage floor sits at or below the expected net delta", () => {
      expect(built.minimumNetRaw).toBeLessThanOrEqual(built.expectedNetRaw);
      expect(built.minimumNetRaw).toBeGreaterThan(0n);
    });
  },
);

describe("buildUnsignedSwap input validation", () => {
  it("rejects a non-positive notional and an out-of-range slippage", async () => {
    const conn = defaultConnection();
    const base = request(MINTS[0]!);
    await expect(
      buildUnsignedSwap(conn, { ...base, notionalUsd: 0 }),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      buildUnsignedSwap(conn, { ...base, slippageBps: 0 }),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      buildUnsignedSwap(conn, { ...base, slippageBps: 9000 }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});
