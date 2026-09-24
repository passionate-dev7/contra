export interface FeeTier {
  epoch: number;
  transferFeeBasisPoints: number;
  maximumFee: bigint;
}

const BASIS_POINTS_DENOMINATOR = 10000;
const BASIS_POINTS_DENOMINATOR_BIGINT = 10000n;
const CEIL_ROUNDING_ADDEND = 9999n;

function assertValidBps(bps: number): void {
  if (!Number.isInteger(bps) || bps < 0 || bps > BASIS_POINTS_DENOMINATOR) {
    throw new RangeError(
      `bps must be an integer in 0..10000, received ${String(bps)}`,
    );
  }
}

function assertNonNegativeBigint(value: bigint, name: string): void {
  if (value < 0n) {
    throw new RangeError(`${name} must be >= 0, received ${value.toString()}`);
  }
}

export function inForceTier(
  older: FeeTier,
  newer: FeeTier,
  currentEpoch: number,
): FeeTier {
  if (currentEpoch < older.epoch) {
    throw new RangeError(
      `currentEpoch ${String(currentEpoch)} is before older tier epoch ${String(older.epoch)}`,
    );
  }
  if (currentEpoch >= newer.epoch) {
    return newer;
  }
  return older;
}

export function transferFeeOf(
  gross: bigint,
  bps: number,
  maximumFee: bigint,
): bigint {
  assertNonNegativeBigint(gross, "gross");
  assertValidBps(bps);
  assertNonNegativeBigint(maximumFee, "maximumFee");
  if (bps === 0 || gross === 0n) {
    return 0n;
  }
  const raw =
    (gross * BigInt(bps) + CEIL_ROUNDING_ADDEND) /
    BASIS_POINTS_DENOMINATOR_BIGINT;
  return raw > maximumFee ? maximumFee : raw;
}

export function netAfterTransferFee(
  gross: bigint,
  bps: number,
  maximumFee: bigint,
): bigint {
  return gross - transferFeeOf(gross, bps, maximumFee);
}

export function grossForNet(
  net: bigint,
  bps: number,
  maximumFee: bigint,
): bigint {
  assertNonNegativeBigint(net, "net");
  assertValidBps(bps);
  assertNonNegativeBigint(maximumFee, "maximumFee");
  if (bps === BASIS_POINTS_DENOMINATOR) {
    throw new RangeError("bps 10000 cannot invert: fee consumes the full amount");
  }
  if (net === 0n) {
    return 0n;
  }
  if (bps === 0) {
    return net;
  }
  const denom = BigInt(BASIS_POINTS_DENOMINATOR - bps);
  const linear = (net * BASIS_POINTS_DENOMINATOR_BIGINT + denom - 1n) / denom;
  const cappedBound = net + maximumFee;
  let gross = linear < cappedBound ? linear : cappedBound;
  while (netAfterTransferFee(gross, bps, maximumFee) < net) {
    gross += 1n;
  }
  while (
    gross > 0n &&
    netAfterTransferFee(gross - 1n, bps, maximumFee) >= net
  ) {
    gross -= 1n;
  }
  return gross;
}

export function roundTripBps(bps: number): number {
  assertValidBps(bps);
  return Math.round(
    2 * bps - (bps * bps) / BASIS_POINTS_DENOMINATOR,
  );
}
