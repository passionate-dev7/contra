import { describe, it, expect } from "vitest";
import { operativeMultiplier, isPending } from "../src/multiplier.js";

const HOUR = 3600;

describe("operativeMultiplier", () => {
  it("returns newMultiplier once the effective timestamp has passed", () => {
    const now = 1_790_000_000;
    expect(operativeMultiplier("1", "5", 1_781_065_800, now)).toBe(5);
  });

  it("returns the stale multiplier while the change is still pending", () => {
    const now = 1_790_000_000;
    expect(operativeMultiplier("1", "5", now + HOUR, now)).toBe(1);
    expect(isPending(now + HOUR, now)).toBe(true);
  });

  it("switches at exactly the effective timestamp, inclusive", () => {
    const t = 1_781_065_800;
    expect(operativeMultiplier("1", "5", t, t - 1)).toBe(1);
    expect(operativeMultiplier("1", "5", t, t)).toBe(5);
    expect(isPending(t, t)).toBe(false);
  });

  it("treats timestamp 0 with the same rule, no special case", () => {
    expect(operativeMultiplier("1", "1", 0, 1_790_000_000)).toBe(1);
    expect(operativeMultiplier("2", "3", 0, 1_790_000_000)).toBe(3);
  });

  it("handles a fractional multiplier without losing precision", () => {
    expect(operativeMultiplier("1", "1.4861347", 1_784_305_800, 1_790_000_000)).toBe(1.4861347);
  });

  it("rejects unparseable multipliers instead of silently returning NaN", () => {
    // Number("") === 0, so a blank must be rejected explicitly or every supply
    // downstream silently becomes 0 instead of erroring.
    expect(() => operativeMultiplier("", "5", 0, 1)).toThrow(TypeError);
    expect(() => operativeMultiplier("   ", "5", 0, 1)).toThrow(TypeError);
    expect(() => operativeMultiplier("1", "not-a-number", 0, 1)).toThrow(TypeError);
    expect(() => operativeMultiplier("1", "Infinity", 0, 1)).toThrow(TypeError);
  });
});
