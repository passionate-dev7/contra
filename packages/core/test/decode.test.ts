/**
 * Mainnet decode assertions. No mocks: every value here is read from
 * api.mainnet-beta.solana.com (or RPC_URL) at test time.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  decodeAllMints,
  decodeMint,
  readEpochPosition,
  TOKEN_2022_PROGRAM_ID,
  U64_MAX,
  fetchPreStocksTokens,
} from "../src/index.js";
import type { EpochPosition } from "../src/fee.js";
import type { MintFacts } from "../src/types.js";

const ISSUER_KEY = "WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc";

let facts: MintFacts[];
let epoch: EpochPosition;

beforeAll(async () => {
  epoch = await readEpochPosition();
  facts = await decodeAllMints(undefined, undefined, epoch);
}, 180_000);

describe("mint discovery", () => {
  it("takes the mint list from the issuer API, never a hardcoded array", async () => {
    const tokens = await fetchPreStocksTokens();
    expect(tokens.length).toBeGreaterThanOrEqual(8);
    for (const t of tokens) {
      expect(t.mint, `${t.symbol} has no contract_address`).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    }
    expect(tokens.map((t) => t.symbol)).toEqual(expect.arrayContaining(["SPACEX", "OPENAI", "ANTHROPIC"]));
  }, 60_000);
});

describe("every PreStocks mint", () => {
  it("is owned by Token-2022 and decoded at a real slot", () => {
    for (const f of facts) {
      expect(f.ownerProgram, f.symbol).toBe(TOKEN_2022_PROGRAM_ID);
      expect(f.decimals, f.symbol).toBe(9);
      expect(f.slot, f.symbol).toBeGreaterThan(400_000_000);
      expect(Number(f.rawSupply), f.symbol).toBeGreaterThan(0);
      expect(f.asOfUnix).toBeGreaterThan(1_700_000_000);
    }
  });

  /**
   * The rate charged today is whichever tier the chain's epoch has reached, not
   * whichever one the issuer has scheduled. Both tiers and the live epoch are
   * read from mainnet, so this asserts the selection rather than a literal that
   * goes stale the moment the epoch rolls over.
   */
  it("charges the tier the current epoch has activated, round trip is twice it, uncapped", () => {
    expect(epoch.epoch, "getEpochInfo returned no epoch").toBeGreaterThan(1_000);
    for (const f of facts) {
      const newer = f.transferFee.current;
      const older = f.transferFee.previous ?? newer;
      const inForce =
        epoch.epoch >= newer.epoch ? newer.transferFeeBasisPoints : older.transferFeeBasisPoints;
      expect(f.transferFee.currentEpoch, f.symbol).toBe(epoch.epoch);
      expect(f.transferFee.currentBps, f.symbol).toBe(inForce);
      expect(f.transferFee.roundTripBps, f.symbol).toBe(inForce * 2);
      expect(f.transferFee.current.epoch, f.symbol).toBe(1039);
      expect(f.transferFee.uncapped, f.symbol).toBe(true);
    }
    const f = facts[0]!;
    console.log(
      `\nepoch ${epoch.epoch} (slot ${epoch.slotIndex}/${epoch.slotsInEpoch}): ` +
        `in force ${f.transferFee.currentBps}bps/transfer, ${f.transferFee.roundTripBps}bps round trip; ` +
        `pending ${String(f.transferFee.pendingBps)}bps at epoch ${String(f.transferFee.pendingActivationEpoch)}\n`,
    );
  });

  /**
   * The countdown is a product surface, so it has to be consistent with the
   * tiers rather than decorative: pending is set exactly when the scheduled
   * epoch is still ahead, and the seconds are the slots at 0.4s.
   */
  it("exposes the pending tier and when it activates", () => {
    for (const f of facts) {
      const pendingExpected = epoch.epoch < f.transferFee.current.epoch;
      if (pendingExpected) {
        expect(f.transferFee.pendingBps, f.symbol).toBe(
          f.transferFee.current.transferFeeBasisPoints,
        );
        expect(f.transferFee.pendingActivationEpoch, f.symbol).toBe(f.transferFee.current.epoch);
        expect(f.transferFee.slotsUntilActivation, f.symbol).toBeGreaterThan(0);
        expect(f.transferFee.secondsUntilActivation, f.symbol).toBeCloseTo(
          f.transferFee.slotsUntilActivation! * 0.4,
          6,
        );
        expect(f.transferFee.pendingBps, f.symbol).not.toBe(f.transferFee.currentBps);
      } else {
        expect(f.transferFee.pendingBps, f.symbol).toBeNull();
        expect(f.transferFee.pendingActivationEpoch, f.symbol).toBeNull();
        expect(f.transferFee.slotsUntilActivation, f.symbol).toBeNull();
        expect(f.transferFee.secondsUntilActivation, f.symbol).toBeNull();
      }
    }
  });

  it("carries the exact u64 maximumFee, not the float-mangled value jsonParsed hands back", () => {
    for (const f of facts) {
      expect(f.transferFee.current.maximumFee, f.symbol).toBe(U64_MAX);
      expect(f.transferFee.current.maximumFee, f.symbol).toBe("18446744073709551615");
      // JSON.parse turns u64 max into this. Shipping it would be a silent precision bug.
      expect(f.transferFee.current.maximumFee, f.symbol).not.toBe("18446744073709552000");
      expect(BigInt(f.transferFee.current.maximumFee)).toBe(2n ** 64n - 1n);
    }
  });

  it("records the previous, cheaper fee tier so the doubling is visible", () => {
    for (const f of facts) {
      expect(f.transferFee.previous, f.symbol).not.toBeNull();
      expect(f.transferFee.previous!.transferFeeBasisPoints, f.symbol).toBe(50);
      expect(f.transferFee.previous!.epoch, f.symbol).toBe(1032);
      expect(f.transferFee.current.transferFeeBasisPoints).toBeGreaterThan(
        f.transferFee.previous!.transferFeeBasisPoints,
      );
    }
  });

  it("exposes the full extension set", () => {
    for (const f of facts) {
      expect(f.extensionsPresent, f.symbol).toEqual(
        expect.arrayContaining([
          "permanentDelegate",
          "defaultAccountState",
          "transferFeeConfig",
          "transferHook",
          "scaledUiAmountConfig",
          "pausableConfig",
          "tokenMetadata",
        ]),
      );
    }
  });

  it("shows one key holding all six levers", () => {
    for (const f of facts) {
      const p = f.powers;
      expect(p.permanentDelegate, f.symbol).toBe(ISSUER_KEY);
      expect(p.pausableAuthority, f.symbol).toBe(ISSUER_KEY);
      expect(p.transferFeeAuthority, f.symbol).toBe(ISSUER_KEY);
      expect(p.withdrawWithheldAuthority, f.symbol).toBe(ISSUER_KEY);
      expect(p.transferHookAuthority, f.symbol).toBe(ISSUER_KEY);
      expect(p.scaledUiAmountAuthority, f.symbol).toBe(ISSUER_KEY);
      expect(p.distinctAuthorities, f.symbol).toEqual([ISSUER_KEY]);
      expect(p.singleKeyControlsAll, f.symbol).toBe(true);
      expect(p.paused, f.symbol).toBe(false);
      expect(p.defaultAccountState, f.symbol).toBe("initialized");
      expect(p.transferHookProgramId, f.symbol).toBeNull();
    }
  });
});

describe("scaled UI amount, per mint", () => {
  it("SPACEX carries a landed 5x that multiplier still reports as 1", () => {
    const f = facts.find((x) => x.symbol === "SPACEX")!;
    const s = f.scaledUiAmount!;
    expect(s.multiplier).toBe("1");
    expect(s.newMultiplier).toBe("5");
    expect(s.newMultiplierEffectiveTimestamp).toBe(1781065800);
    expect(s.newMultiplierEffectiveTimestamp).toBeLessThan(f.asOfUnix);
    expect(s.operativeMultiplier).toBe(5);
    expect(s.operativeMultiplier).not.toBe(Number(s.multiplier));
  });

  it("OPENAI carries a landed 1.4861347x", () => {
    const f = facts.find((x) => x.symbol === "OPENAI")!;
    const s = f.scaledUiAmount!;
    expect(s.multiplier).toBe("1");
    expect(s.newMultiplier).toBe("1.4861347");
    expect(s.newMultiplierEffectiveTimestamp).toBe(1784305800);
    expect(s.operativeMultiplier).toBe(1.4861347);
  });

  it("ANTHROPIC is unscaled, so the finding is per-mint and not a decoder artifact", () => {
    const f = facts.find((x) => x.symbol === "ANTHROPIC")!;
    const s = f.scaledUiAmount!;
    expect(s.multiplier).toBe("1");
    expect(s.newMultiplier).toBe("1");
    expect(s.newMultiplierEffectiveTimestamp).toBe(0);
    expect(s.operativeMultiplier).toBe(1);
    expect(f.effectiveSupply).toBeCloseTo(Number(f.rawSupply) / 1e9, 9);
  });

  /**
   * All eight mints currently have a PAST effective timestamp, so the pending branch
   * would otherwise never be exercised against real data. Re-decoding SPACEX with an
   * asOf just before its effective timestamp drives the same mainnet bytes down the
   * other branch: the pending 5x must NOT be applied and the stale 1 must win.
   */
  it("holds the pending multiplier back when asOf precedes the effective timestamp", async () => {
    const spacex = facts.find((x) => x.symbol === "SPACEX")!;
    const before = spacex.scaledUiAmount!.newMultiplierEffectiveTimestamp - 1;
    const past = await decodeMint(spacex.mint, "SPACEX", undefined, before);
    expect(past.scaledUiAmount!.newMultiplier).toBe("5");
    expect(past.scaledUiAmount!.operativeMultiplier).toBe(1);
    expect(past.effectiveSupply).toBeCloseTo(Number(past.rawSupply) / 1e9, 6);
    expect(past.effectiveSupply).toBeLessThan(spacex.effectiveSupply);
  }, 60_000);

  it("effectiveSupply always equals rawSupply/10^decimals times the operative multiplier", () => {
    for (const f of facts) {
      const m = f.scaledUiAmount?.operativeMultiplier ?? 1;
      expect(f.effectiveSupply, f.symbol).toBeCloseTo((Number(f.rawSupply) / 10 ** f.decimals) * m, 6);
    }
  });
});
