/**
 * Which Token-2022 transfer fee tier is actually in force right now.
 *
 * A `transferFeeConfig` carries two tiers, `olderTransferFee` and
 * `newerTransferFee`, each stamped with the epoch it becomes effective. The
 * newer tier is a SCHEDULE, not the current rate: the token program keeps
 * charging the older tier until the chain reaches the newer tier's epoch.
 * Reading `newerTransferFee` unconditionally overstates the fee for the whole
 * window between the authority signing the change and the epoch rolling over.
 *
 * On the PreStocks slate that window is live as this is written: older tier is
 * 50bps at epoch 1032, newer is 100bps at epoch 1039, and mainnet is in epoch
 * 1038. The fee charged today is 50bps a transfer. Confirmed independently by
 * live simulation in @fineprint/exec: 2,059,187 withheld on a gross of
 * 411,837,330 is exactly 50bps.
 *
 * The selection rule here is the same one @fineprint/exec applies in
 * packages/exec/src/fee.ts. This module is the read-side mirror for the decode
 * path, which works in the string-u64 shape the core types use.
 */
import type { MintFacts, TransferFeeTier } from "./types.js";

/** Solana's target slot time. Used only to turn a slot countdown into seconds. */
export const SLOT_SECONDS = 0.4;

/** Where the chain is inside the current epoch, straight from getEpochInfo. */
export interface EpochPosition {
  epoch: number;
  slotIndex: number;
  slotsInEpoch: number;
}

/**
 * The tier the token program will apply to a transfer landed at `currentEpoch`.
 *
 * An epoch before the older tier's own activation epoch is not a state this can
 * answer for, so it throws rather than guessing a rate.
 */
export function inForceTier(
  older: TransferFeeTier,
  newer: TransferFeeTier,
  currentEpoch: number,
): TransferFeeTier {
  if (currentEpoch < older.epoch) {
    throw new RangeError(
      `currentEpoch ${String(currentEpoch)} is before older tier epoch ${String(older.epoch)}`,
    );
  }
  return currentEpoch >= newer.epoch ? newer : older;
}

/** The scheduled tier that has not activated yet, or null when none is pending. */
export function pendingTier(
  older: TransferFeeTier,
  newer: TransferFeeTier,
  currentEpoch: number,
): TransferFeeTier | null {
  if (currentEpoch < older.epoch) {
    throw new RangeError(
      `currentEpoch ${String(currentEpoch)} is before older tier epoch ${String(older.epoch)}`,
    );
  }
  return currentEpoch >= newer.epoch ? null : newer;
}

/**
 * Slots between now and the first slot of `targetEpoch`.
 *
 * The remainder of the current epoch, plus a whole epoch for every one skipped
 * in between. Zero or negative distances are not a countdown, so they come back
 * null rather than as a misleading 0.
 */
export function slotsUntilEpoch(targetEpoch: number, at: EpochPosition): number | null {
  if (targetEpoch <= at.epoch) {
    return null;
  }
  if (at.slotsInEpoch <= 0) {
    throw new RangeError(`slotsInEpoch must be positive, received ${String(at.slotsInEpoch)}`);
  }
  const remainingThisEpoch = at.slotsInEpoch - at.slotIndex;
  return remainingThisEpoch + (targetEpoch - at.epoch - 1) * at.slotsInEpoch;
}

/**
 * Assemble the `MintFacts.transferFee` view from the two decoded tiers and the
 * chain's position in the epoch schedule.
 *
 * `current` and `previous` keep their raw meaning (newer tier, older tier) so
 * the exec package's tier selection still sees both sides. `currentBps`,
 * `roundTripBps` and `uncapped` describe the tier actually being charged.
 */
export function buildTransferFee(
  older: TransferFeeTier,
  newer: TransferFeeTier,
  at: EpochPosition,
  uncappedMaximumFee: string,
): MintFacts["transferFee"] {
  const tiersIdentical =
    older.epoch === newer.epoch &&
    older.transferFeeBasisPoints === newer.transferFeeBasisPoints &&
    older.maximumFee === newer.maximumFee;
  const previous: TransferFeeTier | null = tiersIdentical ? null : older;

  const inForce = inForceTier(older, newer, at.epoch);
  const pending = tiersIdentical ? null : pendingTier(older, newer, at.epoch);
  const slotsUntilActivation = pending === null ? null : slotsUntilEpoch(pending.epoch, at);

  return {
    current: newer,
    previous,
    currentBps: inForce.transferFeeBasisPoints,
    roundTripBps: inForce.transferFeeBasisPoints * 2,
    uncapped: inForce.maximumFee === uncappedMaximumFee,
    pendingBps: pending === null ? null : pending.transferFeeBasisPoints,
    pendingActivationEpoch: pending === null ? null : pending.epoch,
    currentEpoch: at.epoch,
    slotsUntilActivation,
    secondsUntilActivation:
      slotsUntilActivation === null ? null : slotsUntilActivation * SLOT_SECONDS,
  };
}
