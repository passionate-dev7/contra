function parseFinite(value: string): number {
  // Number("") and Number("  ") are 0, which would silently zero out every supply
  // downstream instead of failing. Reject blanks before the finite check.
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`Invalid multiplier: ${JSON.stringify(value)}`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`Invalid multiplier: ${value}`);
  }
  return parsed;
}

export function operativeMultiplier(
  multiplier: string,
  newMultiplier: string,
  newMultiplierEffectiveTimestamp: number,
  asOfUnix: number,
): number {
  const current = parseFinite(multiplier);
  const next = parseFinite(newMultiplier);
  return asOfUnix >= newMultiplierEffectiveTimestamp ? next : current;
}

export function isPending(newMultiplierEffectiveTimestamp: number, asOfUnix: number): boolean {
  return asOfUnix < newMultiplierEffectiveTimestamp;
}
