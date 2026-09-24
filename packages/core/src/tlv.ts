export interface ExactTransferFee {
  epoch: number;
  transferFeeBasisPoints: number;
  maximumFee: string;
}

export interface ExactTransferFeeConfig {
  older: ExactTransferFee;
  newer: ExactTransferFee;
}

export const U64_MAX = "18446744073709551615";

const TLV_START = 166;
const TRANSFER_FEE_CONFIG_TYPE = 1;
const TRANSFER_FEE_CONFIG_LEN = 108;
const OLDER_TIER_OFFSET = 72;
const NEWER_TIER_OFFSET = 90;

export function parseTlvEntries(data: Buffer): Array<{ type: number; length: number; start: number }> {
  const entries: Array<{ type: number; length: number; start: number }> = [];
  let offset = TLV_START;
  while (offset + 4 <= data.length) {
    const type = data.readUInt16LE(offset);
    const length = data.readUInt16LE(offset + 2);
    if (type === 0 && length === 0) {
      break;
    }
    entries.push({ type, length, start: offset + 4 });
    offset += 4 + length;
  }
  return entries;
}

function readTier(data: Buffer, base: number): ExactTransferFee {
  return {
    epoch: Number(data.readBigUInt64LE(base)),
    transferFeeBasisPoints: data.readUInt16LE(base + 16),
    maximumFee: data.readBigUInt64LE(base + 8).toString(),
  };
}

export function readTransferFeeConfigExact(data: Buffer): ExactTransferFeeConfig | null {
  for (const entry of parseTlvEntries(data)) {
    if (entry.type !== TRANSFER_FEE_CONFIG_TYPE) {
      continue;
    }
    if (entry.length < TRANSFER_FEE_CONFIG_LEN) {
      continue;
    }
    if (entry.start + TRANSFER_FEE_CONFIG_LEN > data.length) {
      continue;
    }
    return {
      older: readTier(data, entry.start + OLDER_TIER_OFFSET),
      newer: readTier(data, entry.start + NEWER_TIER_OFFSET),
    };
  }
  return null;
}
