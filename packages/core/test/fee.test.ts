/**
 * The in-force transfer fee tier.
 *
 * A Token-2022 transferFeeConfig holds two tiers and each is stamped with the
 * epoch it takes effect. The newer one is a SCHEDULE. Reading it as the live
 * rate overstates the fee for the entire window before its epoch arrives, and
 * that window is open on the PreStocks slate right now: 50bps at epoch 1032,
 * 100bps scheduled for epoch 1039, mainnet in epoch 1038.
 *
 * The deterministic half drives the same mainnet bytes down all three branches
 * by injecting the epoch, because the live chain can only ever exercise one of
 * them on any given day. The live half then pins the answer to what the chain
 * actually says, so a decoder that ignored the injected epoch would still be
 * caught.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  U64_MAX,
  buildTransferFee,
  decodeMint,
  inForceTier,
  pendingTier,
  readEpochPosition,
  slotsUntilEpoch,
  SLOT_SECONDS,
} from "../src/index.js";
import type { EpochPosition } from "../src/fee.js";
import type { TransferFeeTier } from "../src/types.js";

const OLDER: TransferFeeTier = { epoch: 1032, transferFeeBasisPoints: 50, maximumFee: U64_MAX };
const NEWER: TransferFeeTier = { epoch: 1039, transferFeeBasisPoints: 100, maximumFee: U64_MAX };

const at = (epoch: number, slotIndex = 311_022): EpochPosition => ({
  epoch,
  slotIndex,
  slotsInEpoch: 432_000,
});

describe("inForceTier picks the newest tier whose epoch has arrived", () => {
  it("epoch BEFORE activation charges the older tier", () => {
    expect(inForceTier(OLDER, NEWER, 1038).transferFeeBasisPoints).toBe(50);
    expect(inForceTier(OLDER, NEWER, 1032).transferFeeBasisPoints).toBe(50);
    expect(inForceTier(OLDER, NEWER, 1035).transferFeeBasisPoints).toBe(50);
  });

  it("epoch EQUAL to activation charges the newer tier, the same slot the epoch opens", () => {
    expect(inForceTier(OLDER, NEWER, 1039).transferFeeBasisPoints).toBe(100);
  });

  it("epoch AFTER activation keeps charging the newer tier", () => {
    expect(inForceTier(OLDER, NEWER, 1040).transferFeeBasisPoints).toBe(100);
    expect(inForceTier(OLDER, NEWER, 9999).transferFeeBasisPoints).toBe(100);
  });

  it("refuses an epoch older than the older tier rather than inventing a rate", () => {
    expect(() => inForceTier(OLDER, NEWER, 1031)).toThrow(/before older tier epoch/);
  });

  it("reports the pending tier only while it is still pending", () => {
    expect(pendingTier(OLDER, NEWER, 1038)?.transferFeeBasisPoints).toBe(100);
    expect(pendingTier(OLDER, NEWER, 1039)).toBeNull();
    expect(pendingTier(OLDER, NEWER, 1040)).toBeNull();
  });
});

describe("the activation countdown", () => {
  it("counts the rest of this epoch when the change lands next epoch", () => {
    expect(slotsUntilEpoch(1039, at(1038, 311_022))).toBe(120_978);
    expect(slotsUntilEpoch(1039, at(1038, 0))).toBe(432_000);
  });

  it("adds a whole epoch for every one skipped in between", () => {
    expect(slotsUntilEpoch(1041, at(1038, 311_022))).toBe(120_978 + 2 * 432_000);
  });

  it("returns null rather than 0 once the target epoch is reached or passed", () => {
    expect(slotsUntilEpoch(1039, at(1039, 10))).toBeNull();
    expect(slotsUntilEpoch(1039, at(1040, 10))).toBeNull();
  });
});

describe("buildTransferFee reports the in-force tier and the pending one separately", () => {
  it("before activation: 50bps live, 100bps pending, with a countdown", () => {
    const f = buildTransferFee(OLDER, NEWER, at(1038, 311_022), U64_MAX);
    expect(f.currentBps).toBe(50);
    expect(f.roundTripBps).toBe(100);
    expect(f.pendingBps).toBe(100);
    expect(f.pendingActivationEpoch).toBe(1039);
    expect(f.currentEpoch).toBe(1038);
    expect(f.slotsUntilActivation).toBe(120_978);
    expect(f.secondsUntilActivation).toBeCloseTo(120_978 * SLOT_SECONDS, 6);
    // The raw tiers are untouched, so the scheduled change stays visible.
    expect(f.current.transferFeeBasisPoints).toBe(100);
    expect(f.previous?.transferFeeBasisPoints).toBe(50);
    expect(f.uncapped).toBe(true);
  });

  it("at activation: 100bps live, nothing pending, no countdown", () => {
    const f = buildTransferFee(OLDER, NEWER, at(1039, 0), U64_MAX);
    expect(f.currentBps).toBe(100);
    expect(f.roundTripBps).toBe(200);
    expect(f.pendingBps).toBeNull();
    expect(f.pendingActivationEpoch).toBeNull();
    expect(f.slotsUntilActivation).toBeNull();
    expect(f.secondsUntilActivation).toBeNull();
    expect(f.currentEpoch).toBe(1039);
  });

  it("after activation: still 100bps live and still nothing pending", () => {
    const f = buildTransferFee(OLDER, NEWER, at(1040, 200_000), U64_MAX);
    expect(f.currentBps).toBe(100);
    expect(f.roundTripBps).toBe(200);
    expect(f.pendingBps).toBeNull();
    expect(f.slotsUntilActivation).toBeNull();
  });

  it("collapses identical tiers to no history and nothing pending", () => {
    const f = buildTransferFee(OLDER, { ...OLDER }, at(1038), U64_MAX);
    expect(f.previous).toBeNull();
    expect(f.pendingBps).toBeNull();
    expect(f.currentBps).toBe(50);
  });

  it("takes uncapped from the IN-FORCE tier, not from the scheduled one", () => {
    const cappedNewer: TransferFeeTier = { ...NEWER, maximumFee: "1000000" };
    expect(buildTransferFee(OLDER, cappedNewer, at(1038), U64_MAX).uncapped).toBe(true);
    expect(buildTransferFee(OLDER, cappedNewer, at(1039), U64_MAX).uncapped).toBe(false);
  });
});

/**
 * One live mint, named directly.
 *
 * The decoder's own rule is that the mint LIST is never hardcoded, and
 * decode.test.ts proves that by taking every address from the issuer API. This
 * file is about tier selection, not discovery, and the issuer rate-limits hard
 * enough that a fourth list fetch per run starves the retry test in
 * naive.test.ts. So it names one mint and reads everything else from chain. If
 * the issuer re-mints, this fails loudly with "Mint account not found", which
 * is the correct failure.
 */
const LIVE_MINT = "PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S";
const LIVE_SYMBOL = "NEURALINK";

describe("against mainnet", () => {
  const mint = LIVE_MINT;
  const symbol = LIVE_SYMBOL;
  let chain: EpochPosition;

  beforeAll(async () => {
    chain = await readEpochPosition();
  }, 120_000);

  it("selects the tier the chain's own epoch says is in force", async () => {
    const f = await decodeMint(mint, symbol);
    const newer = f.transferFee.current;
    const older = f.transferFee.previous ?? newer;
    const expected =
      chain.epoch >= newer.epoch
        ? newer.transferFeeBasisPoints
        : older.transferFeeBasisPoints;

    expect(f.transferFee.currentEpoch).toBe(chain.epoch);
    expect(f.transferFee.currentBps).toBe(expected);
    expect(f.transferFee.roundTripBps).toBe(expected * 2);

    if (chain.epoch < newer.epoch) {
      expect(f.transferFee.pendingBps).toBe(newer.transferFeeBasisPoints);
      expect(f.transferFee.pendingActivationEpoch).toBe(newer.epoch);
      expect(f.transferFee.slotsUntilActivation).toBeGreaterThan(0);
      expect(f.transferFee.secondsUntilActivation).toBeGreaterThan(0);
      // The bug this replaces: the scheduled tier read as the live one.
      expect(f.transferFee.currentBps).not.toBe(newer.transferFeeBasisPoints);
    } else {
      expect(f.transferFee.pendingBps).toBeNull();
      expect(f.transferFee.slotsUntilActivation).toBeNull();
    }

    console.log(
      `\n${symbol} ${mint}\n` +
        `  chain epoch ${chain.epoch}, slot ${chain.slotIndex}/${chain.slotsInEpoch}\n` +
        `  tiers: older ${older.transferFeeBasisPoints}bps @ epoch ${older.epoch}, ` +
        `newer ${newer.transferFeeBasisPoints}bps @ epoch ${newer.epoch}\n` +
        `  IN FORCE ${f.transferFee.currentBps}bps/transfer, ${f.transferFee.roundTripBps}bps round trip\n` +
        `  pending ${String(f.transferFee.pendingBps)}bps at epoch ${String(f.transferFee.pendingActivationEpoch)} ` +
        `in ${String(f.transferFee.slotsUntilActivation)} slots ` +
        `(${((f.transferFee.secondsUntilActivation ?? 0) / 3600).toFixed(2)}h)\n`,
    );
  }, 120_000);

  it("drives the same mainnet bytes down every branch by injecting the epoch", async () => {
    const live = await decodeMint(mint, symbol);
    const activation = live.transferFee.current.epoch;
    const scheduledBps = live.transferFee.current.transferFeeBasisPoints;
    const priorBps = (live.transferFee.previous ?? live.transferFee.current).transferFeeBasisPoints;

    const before = await decodeMint(mint, symbol, undefined, undefined, at(activation - 1, 1_000));
    const on = await decodeMint(mint, symbol, undefined, undefined, at(activation, 0));
    const after = await decodeMint(mint, symbol, undefined, undefined, at(activation + 1, 1_000));

    expect(before.transferFee.currentBps).toBe(priorBps);
    expect(on.transferFee.currentBps).toBe(scheduledBps);
    expect(after.transferFee.currentBps).toBe(scheduledBps);

    expect(before.transferFee.roundTripBps).toBe(priorBps * 2);
    expect(on.transferFee.roundTripBps).toBe(scheduledBps * 2);

    expect(before.transferFee.pendingBps).toBe(scheduledBps);
    expect(on.transferFee.pendingBps).toBeNull();
    expect(after.transferFee.pendingBps).toBeNull();

    // The tiers really are different on this mint, so the three branches are
    // not all quietly returning the same number.
    expect(priorBps).not.toBe(scheduledBps);
  }, 180_000);
});
