import { describe, expect, it } from "vitest";
import {
  grossForNet,
  inForceTier,
  netAfterTransferFee,
  roundTripBps,
  transferFeeOf,
  type FeeTier,
} from "../src/fee.js";

// u64 max = uncapped maximumFee (SPEC: measured ground truth).
const MAX = 18446744073709551615n;

// SPEC: olderTransferFee { epoch 1032, 50 bps }, newerTransferFee { epoch 1039, 100 bps }.
const older: FeeTier = {
  epoch: 1032,
  transferFeeBasisPoints: 50,
  maximumFee: MAX,
};
const newer: FeeTier = {
  epoch: 1039,
  transferFeeBasisPoints: 100,
  maximumFee: MAX,
};

describe("transferFeeOf hand-computed values", () => {
  it("charges 50 bps on 1_000_000", () => {
    expect(transferFeeOf(1_000_000n, 50, MAX)).toBe(5_000n);
  });

  it("charges 100 bps on 1_000_000", () => {
    expect(transferFeeOf(1_000_000n, 100, MAX)).toBe(10_000n);
  });

  it("matches the mainnet-measured ANTHROPIC fee", () => {
    expect(transferFeeOf(105_363_629n, 50, MAX)).toBe(526_819n);
  });

  it("matches the mainnet-measured ANTHROPIC net", () => {
    expect(netAfterTransferFee(105_363_629n, 50, MAX)).toBe(104_836_810n);
  });

  it("matches the mainnet-measured SPACEX fee and net", () => {
    expect(transferFeeOf(44_527_722n, 50, MAX)).toBe(222_639n);
    expect(netAfterTransferFee(44_527_722n, 50, MAX)).toBe(44_305_083n);
  });

  it("rounds the fee up (ceiling)", () => {
    expect(transferFeeOf(1n, 50, MAX)).toBe(1n);
    expect(transferFeeOf(199n, 50, MAX)).toBe(1n);
    expect(transferFeeOf(201n, 50, MAX)).toBe(2n);
  });

  it("clamps to maximumFee", () => {
    expect(transferFeeOf(10_000_000n, 100, 1_000n)).toBe(1_000n);
  });
});

describe("grossForNet round trip", () => {
  const bpsList = [1, 50, 100, 999];
  const nets = [
    1n,
    199n,
    201n,
    1_000n,
    5_000n,
    10_000n,
    222_639n,
    526_819n,
    44_305_083n,
    104_836_810n,
  ];

  for (const bps of bpsList) {
    for (const net of nets) {
      it(`is exact for net ${net.toString()} at ${bps} bps`, () => {
        const gross = grossForNet(net, bps, MAX);
        expect(netAfterTransferFee(gross, bps, MAX) >= net).toBe(true);
        expect(gross > 0n).toBe(true);
        expect(netAfterTransferFee(gross - 1n, bps, MAX) < net).toBe(true);
      });
    }
  }
});

describe("inForceTier", () => {
  it("epoch 1038 selects the 50 bps tier", () => {
    const tier = inForceTier(older, newer, 1038);
    expect(tier).toBe(older);
    expect(tier.transferFeeBasisPoints).toBe(50);
  });

  it("epoch 1039 selects the 100 bps tier", () => {
    const tier = inForceTier(older, newer, 1039);
    expect(tier).toBe(newer);
    expect(tier.transferFeeBasisPoints).toBe(100);
  });

  it("epoch 1040 keeps the 100 bps tier", () => {
    const tier = inForceTier(older, newer, 1040);
    expect(tier).toBe(newer);
    expect(tier.transferFeeBasisPoints).toBe(100);
  });
});

describe("roundTripBps", () => {
  it("compounds 50 bps to 100", () => {
    expect(roundTripBps(50)).toBe(100);
  });

  it("compounds 100 bps to 199", () => {
    expect(roundTripBps(100)).toBe(199);
  });
});
