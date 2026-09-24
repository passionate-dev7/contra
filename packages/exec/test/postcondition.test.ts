import { describe, expect, it } from "vitest";
import { evaluatePostCondition } from "../src/execute.js";

// u64 max = uncapped maximumFee (SPEC: measured ground truth).
const MAX = 18446744073709551615n;
const BPS = 50;
const TOLERANCE_BPS = 25;

// Mainnet-measured ANTHROPIC leg: gross 105_363_629, fee 526_819, net 104_836_810.
// Mainnet-measured SPACEX leg: gross 44_527_722, fee 222_639, net 44_305_083.

describe("evaluatePostCondition", () => {
  it("holds on exact expected values", () => {
    const verdict = evaluatePostCondition({
      expectedNetRaw: 104_836_810n,
      actualNetRaw: 104_836_810n,
      minimumNetRaw: 104_836_810n,
      grossRaw: 105_363_629n,
      withheldDeltaRaw: 526_819n,
      bps: BPS,
      maximumFee: MAX,
      toleranceBps: TOLERANCE_BPS,
    });
    expect(verdict.held).toBe(true);
    expect(verdict.reasons).toEqual([]);
  });

  it("fails when withheldDelta is one lamport off the fee identity", () => {
    const verdict = evaluatePostCondition({
      expectedNetRaw: 104_836_810n,
      actualNetRaw: 104_836_810n,
      minimumNetRaw: 104_836_810n,
      grossRaw: 105_363_629n,
      withheldDeltaRaw: 526_818n,
      bps: BPS,
      maximumFee: MAX,
      toleranceBps: TOLERANCE_BPS,
    });
    expect(verdict.held).toBe(false);
    expect(verdict.reasons.length).toBe(1);
  });

  it("fails when actualNet is below minimumNet", () => {
    const verdict = evaluatePostCondition({
      expectedNetRaw: 44_305_083n,
      actualNetRaw: 44_305_083n,
      minimumNetRaw: 104_836_810n,
      grossRaw: 44_527_722n,
      withheldDeltaRaw: 222_639n,
      bps: BPS,
      maximumFee: MAX,
      toleranceBps: TOLERANCE_BPS,
    });
    expect(verdict.held).toBe(false);
    expect(verdict.reasons.length).toBe(1);
  });

  it("fails when actualNet is outside toleranceBps", () => {
    const verdict = evaluatePostCondition({
      expectedNetRaw: 104_836_810n,
      actualNetRaw: 44_305_083n,
      minimumNetRaw: 44_305_083n,
      grossRaw: 105_363_629n,
      withheldDeltaRaw: 526_819n,
      bps: BPS,
      maximumFee: MAX,
      toleranceBps: TOLERANCE_BPS,
    });
    expect(verdict.held).toBe(false);
    expect(verdict.reasons.length).toBe(1);
  });

  it("fails when actualNet is 0", () => {
    const verdict = evaluatePostCondition({
      expectedNetRaw: 104_836_810n,
      actualNetRaw: 0n,
      minimumNetRaw: 44_305_083n,
      grossRaw: 105_363_629n,
      withheldDeltaRaw: 526_819n,
      bps: BPS,
      maximumFee: MAX,
      toleranceBps: TOLERANCE_BPS,
    });
    expect(verdict.held).toBe(false);
    expect(verdict.reasons.length > 0).toBe(true);
  });
});
