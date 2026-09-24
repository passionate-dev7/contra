import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import {
  AccountState,
  TOKEN_2022_PROGRAM_ID,
  getDefaultAccountState,
  getPausableConfig,
  getPermanentDelegate,
  getTransferFeeConfig,
  getTransferHook,
  unpackMint,
} from "@solana/spl-token";
import type { MintFacts } from "@fineprint/core";
import { NoTransferFeeConfigError, NotToken2022Error } from "./errors.js";
import { inForceTier, type FeeTier } from "./fee.js";

export interface ExecMintFacts {
  mint: string;
  decimals: number;
  ownerProgram: string;
  inForceBps: number;
  inForceMaximumFee: bigint;
  currentEpoch: number;
  tiers: { older: FeeTier; newer: FeeTier };
  paused: boolean;
  pausableAuthority: string | null;
  permanentDelegate: string | null;
  transferHookProgramId: string | null;
  defaultAccountState: string | null;
  slot: number;
}

function defaultAccountStateToString(state: AccountState): string {
  switch (state) {
    case AccountState.Frozen:
      return "frozen";
    case AccountState.Initialized:
      return "initialized";
    case AccountState.Uninitialized:
      return "uninitialized";
    default:
      return "unknown";
  }
}

export async function readExecMintFacts(
  conn: Connection,
  mint: string,
): Promise<ExecMintFacts> {
  const mintKey = new PublicKey(mint);
  const response = await conn.getAccountInfoAndContext(mintKey, "finalized");
  const slot = response.context.slot;
  const info = response.value;
  if (info === null || !info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new NotToken2022Error(
      `Mint ${mint} is not owned by the Token-2022 program`,
      {
        mint,
        ownerProgram:
          info === null ? undefined : info.owner.toBase58(),
      },
    );
  }
  const unpacked = unpackMint(mintKey, info, TOKEN_2022_PROGRAM_ID);
  const feeConfig = getTransferFeeConfig(unpacked);
  if (feeConfig === null) {
    throw new NoTransferFeeConfigError(
      `Mint ${mint} has no transferFeeConfig extension`,
      { mint },
    );
  }
  const epochInfo = await conn.getEpochInfo();
  const currentEpoch = epochInfo.epoch;
  const older: FeeTier = {
    epoch: Number(feeConfig.olderTransferFee.epoch),
    transferFeeBasisPoints:
      feeConfig.olderTransferFee.transferFeeBasisPoints,
    maximumFee: feeConfig.olderTransferFee.maximumFee,
  };
  const newer: FeeTier = {
    epoch: Number(feeConfig.newerTransferFee.epoch),
    transferFeeBasisPoints:
      feeConfig.newerTransferFee.transferFeeBasisPoints,
    maximumFee: feeConfig.newerTransferFee.maximumFee,
  };
  const inForce = inForceTier(older, newer, currentEpoch);
  const pausable = getPausableConfig(unpacked);
  const delegate = getPermanentDelegate(unpacked);
  const hook = getTransferHook(unpacked);
  const defaultState = getDefaultAccountState(unpacked);
  return {
    mint,
    decimals: unpacked.decimals,
    ownerProgram: info.owner.toBase58(),
    inForceBps: inForce.transferFeeBasisPoints,
    inForceMaximumFee: inForce.maximumFee,
    currentEpoch,
    tiers: { older, newer },
    paused: pausable === null ? false : pausable.paused,
    pausableAuthority:
      pausable === null ? null : pausable.authority.toBase58(),
    permanentDelegate:
      delegate === null ? null : delegate.delegate.toBase58(),
    transferHookProgramId:
      hook === null || hook.programId.equals(PublicKey.default)
        ? null
        : hook.programId.toBase58(),
    defaultAccountState:
      defaultState === null
        ? null
        : defaultAccountStateToString(defaultState.state),
    slot,
  };
}

function feeTierFromCoreTier(tier: {
  epoch: number;
  transferFeeBasisPoints: number;
  maximumFee: string;
}): FeeTier {
  return {
    epoch: tier.epoch,
    transferFeeBasisPoints: tier.transferFeeBasisPoints,
    maximumFee: BigInt(tier.maximumFee),
  };
}

export function execFactsFromMintFacts(
  f: MintFacts,
  currentEpoch: number,
): ExecMintFacts {
  const newer = feeTierFromCoreTier(f.transferFee.current);
  const older =
    f.transferFee.previous === null
      ? { ...newer }
      : feeTierFromCoreTier(f.transferFee.previous);
  const inForce = inForceTier(older, newer, currentEpoch);
  return {
    mint: f.mint,
    decimals: f.decimals,
    ownerProgram: f.ownerProgram,
    inForceBps: inForce.transferFeeBasisPoints,
    inForceMaximumFee: inForce.maximumFee,
    currentEpoch,
    tiers: { older, newer },
    paused: f.powers.paused,
    pausableAuthority: f.powers.pausableAuthority,
    permanentDelegate: f.powers.permanentDelegate,
    transferHookProgramId: f.powers.transferHookProgramId,
    defaultAccountState: f.powers.defaultAccountState,
    slot: f.slot,
  };
}
