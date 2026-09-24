import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, connection } from "./constants.js";
import { fetchPreStocksTokens } from "./prestocks.js";
import { operativeMultiplier } from "./multiplier.js";
import { U64_MAX, readTransferFeeConfigExact } from "./tlv.js";
import { buildTransferFee, type EpochPosition } from "./fee.js";
import type { MintFacts, ScaledUiAmount, TransferFeeTier } from "./types.js";

const RATE_LIMIT_DELAY_MS = 120;

interface ParsedExtension {
  extension: string;
  state: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extensionState(extensions: ParsedExtension[], name: string): Record<string, unknown> | null {
  return extensions.find((entry) => entry.extension === name)?.state ?? null;
}

function parseExtensions(value: unknown): ParsedExtension[] {
  if (!Array.isArray(value)) {
    throw new Error("Mint account has no parsable extensions list");
  }
  return value.map((entry) => {
    const record = asRecord(entry);
    const name = record === null ? null : asString(record["extension"]);
    const state = record === null ? null : asRecord(record["state"]);
    if (name === null || state === null) {
      throw new Error("Mint account has a malformed extension entry");
    }
    return { extension: name, state };
  });
}

function buildScaledUiAmount(state: Record<string, unknown>, asOfUnix: number): ScaledUiAmount {
  const multiplier = asString(state["multiplier"]);
  const newMultiplier = asString(state["newMultiplier"]);
  const timestamp = asNumber(state["newMultiplierEffectiveTimestamp"]);
  if (multiplier === null || newMultiplier === null || timestamp === null) {
    throw new Error("scaledUiAmountConfig extension is missing multiplier fields");
  }
  return {
    multiplier,
    newMultiplier,
    newMultiplierEffectiveTimestamp: timestamp,
    operativeMultiplier: operativeMultiplier(multiplier, newMultiplier, timestamp, asOfUnix),
  };
}

function jsonFeeTier(tier: unknown, side: string): { epoch: number; transferFeeBasisPoints: number } {
  const record = asRecord(tier);
  const epoch = record === null ? null : asNumber(record["epoch"]);
  const bps =
    record === null ? null : (asNumber(record["transferFeeBasisPoints"]) ?? asNumber(record["transfer_fee_basis_points"]));
  if (epoch === null || bps === null) {
    throw new Error(`transferFeeConfig ${side} tier is missing epoch or basis points`);
  }
  return { epoch, transferFeeBasisPoints: bps };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Read where the chain sits in the epoch schedule. The in-force fee tier depends on it. */
export async function readEpochPosition(conn?: Connection): Promise<EpochPosition> {
  const info = await (conn ?? connection()).getEpochInfo();
  return { epoch: info.epoch, slotIndex: info.slotIndex, slotsInEpoch: info.slotsInEpoch };
}

/**
 * @param epochAt Where the chain is in the epoch schedule. Read from
 *   getEpochInfo when omitted. Injectable so a caller can decode the same
 *   mainnet bytes against a different epoch and see the other fee tier win,
 *   and so a sweep across many mints pays for one getEpochInfo, not N.
 */
export async function decodeMint(
  mint: string,
  symbol: string,
  conn?: Connection,
  asOfUnix?: number,
  epochAt?: EpochPosition,
): Promise<MintFacts> {
  const client = conn ?? connection();
  const asOf = asOfUnix ?? Math.floor(Date.now() / 1000);
  const mintKey = new PublicKey(mint);
  const epoch = epochAt ?? (await readEpochPosition(client));

  const parsed = await client.getParsedAccountInfo(mintKey, "confirmed");
  const slot = parsed.context.slot;
  const value = parsed.value;
  if (value === null) {
    throw new Error(`Mint account not found: ${mint}`);
  }
  if (value.owner.toBase58() !== TOKEN_2022_PROGRAM_ID) {
    throw new Error(`Mint ${mint} is not owned by the Token-2022 program`);
  }
  const rawData: unknown = value.data;
  if (Buffer.isBuffer(rawData)) {
    throw new Error(`Mint ${mint} account data is not parsed`);
  }
  const dataRecord = asRecord(rawData);
  const parsedPayload = dataRecord === null ? null : asRecord(dataRecord["parsed"]);
  if (
    dataRecord?.["program"] !== "spl-token-2022" ||
    parsedPayload?.["type"] !== "mint"
  ) {
    throw new Error(`Mint ${mint} account data is not a Token-2022 mint`);
  }
  const info = asRecord(parsedPayload["info"]);
  if (info === null) {
    throw new Error(`Mint ${mint} account data has no mint info`);
  }

  const decimals = asNumber(info["decimals"]);
  const supplyValue = info["supply"];
  const rawSupply =
    typeof supplyValue === "string"
      ? supplyValue
      : typeof supplyValue === "number"
        ? String(supplyValue)
        : null;
  if (decimals === null || rawSupply === null) {
    throw new Error(`Mint ${mint} account data is missing decimals or supply`);
  }

  const extensions = parseExtensions(info["extensions"]);
  const extensionsPresent = extensions.map((entry) => entry.extension);

  const raw = await client.getAccountInfo(mintKey, "confirmed");
  if (raw === null || raw.data.length === 0) {
    throw new Error(`Mint ${mint} raw account data is missing`);
  }

  const scaledState = extensionState(extensions, "scaledUiAmountConfig");
  const scaledUiAmount = scaledState === null ? null : buildScaledUiAmount(scaledState, asOf);
  const effectiveSupply = (Number(rawSupply) / 10 ** decimals) * (scaledUiAmount?.operativeMultiplier ?? 1);

  const feeState = extensionState(extensions, "transferFeeConfig");
  if (feeState === null) {
    throw new Error(`Mint ${mint} has no transferFeeConfig extension`);
  }
  const olderJson = jsonFeeTier(feeState["olderTransferFee"], "older");
  const newerJson = jsonFeeTier(feeState["newerTransferFee"], "newer");
  const exact = readTransferFeeConfigExact(raw.data);
  if (exact === null) {
    throw new Error(`Mint ${mint} has no exact transfer fee config in TLV data`);
  }
  if (
    exact.older.epoch !== olderJson.epoch ||
    exact.older.transferFeeBasisPoints !== olderJson.transferFeeBasisPoints ||
    exact.newer.epoch !== newerJson.epoch ||
    exact.newer.transferFeeBasisPoints !== newerJson.transferFeeBasisPoints
  ) {
    throw new Error(`Mint ${mint} exact TLV fee data disagrees with jsonParsed`);
  }
  const newerTier: TransferFeeTier = {
    epoch: newerJson.epoch,
    transferFeeBasisPoints: newerJson.transferFeeBasisPoints,
    maximumFee: exact.newer.maximumFee,
  };
  const olderTier: TransferFeeTier = {
    epoch: olderJson.epoch,
    transferFeeBasisPoints: olderJson.transferFeeBasisPoints,
    maximumFee: exact.older.maximumFee,
  };
  const transferFee = buildTransferFee(olderTier, newerTier, epoch, U64_MAX);

  const permanentDelegate = asString(extensionState(extensions, "permanentDelegate")?.["delegate"]);
  const pausable = extensionState(extensions, "pausableConfig");
  const pausableAuthority = pausable === null ? null : asString(pausable["authority"]);
  const paused = pausable !== null && pausable["paused"] === true;
  const transferFeeAuthority = asString(feeState["transferFeeConfigAuthority"]);
  const withdrawWithheldAuthority = asString(feeState["withdrawWithheldAuthority"]);
  const hookState = extensionState(extensions, "transferHook");
  const transferHookAuthority = hookState === null ? null : asString(hookState["authority"]);
  const transferHookProgramId = hookState === null ? null : asString(hookState["programId"]);
  const scaledUiAmountAuthority =
    scaledState === null ? null : asString(scaledState["authority"]);
  const defaultAccountState = asString(
    extensionState(extensions, "defaultAccountState")?.["accountState"],
  );

  const authorities = [
    permanentDelegate,
    pausableAuthority,
    transferFeeAuthority,
    withdrawWithheldAuthority,
    transferHookAuthority,
    scaledUiAmountAuthority,
  ];
  const distinctAuthorities = [...new Set(authorities.filter((entry) => entry !== null))].sort();
  const singleKeyControlsAll =
    distinctAuthorities.length === 1 && authorities.every((entry) => entry !== null);

  return {
    symbol,
    mint,
    ownerProgram: value.owner.toBase58(),
    decimals,
    rawSupply,
    effectiveSupply,
    transferFee,
    scaledUiAmount,
    powers: {
      permanentDelegate,
      pausableAuthority,
      paused,
      transferFeeAuthority,
      withdrawWithheldAuthority,
      transferHookAuthority,
      transferHookProgramId,
      scaledUiAmountAuthority,
      defaultAccountState,
      singleKeyControlsAll,
      distinctAuthorities,
    },
    extensionsPresent,
    asOfUnix: asOf,
    slot,
  };
}

export async function decodeAllMints(
  conn?: Connection,
  asOfUnix?: number,
  epochAt?: EpochPosition,
): Promise<MintFacts[]> {
  const client = conn ?? connection();
  const [tokens, epoch] = await Promise.all([
    fetchPreStocksTokens(),
    epochAt === undefined ? readEpochPosition(client) : Promise.resolve(epochAt),
  ]);
  const out: MintFacts[] = [];
  for (const [index, token] of tokens.entries()) {
    if (index > 0) {
      await delay(RATE_LIMIT_DELAY_MS);
    }
    out.push(await decodeMint(token.mint, token.symbol, client, asOfUnix, epoch));
  }
  return out;
}
