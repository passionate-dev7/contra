import { PublicKey, TransactionInstruction } from "@solana/web3.js";

/** Lighthouse assertion program, live on mainnet and devnet. */
export const LIGHTHOUSE_PROGRAM_ID = new PublicKey("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95");

// LighthouseInstruction::AssertTokenAccount discriminant (borsh enum index).
const ASSERT_TOKEN_ACCOUNT_DISCRIMINATOR = 9;
// LogLevel::Silent — no per-assertion log lines, the runtime still logs invoke/fail.
const LOG_LEVEL_SILENT = 0;
// TokenAccountAssertion::Amount discriminant.
const TOKEN_ASSERT_AMOUNT = 2;
// IntegerOperator::GreaterThanOrEqual.
const OP_GTE = 4;

function toBigint(v: bigint | number | string): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.floor(v));
  return BigInt(v);
}

/**
 * Build a Lighthouse AssertTokenAccount instruction asserting the token
 * account's amount is >= minAmount. Encoding follows the on-chain program
 * (programs/lighthouse/src/instruction.rs + types/assert/):
 *   u8 discriminator (9) | u8 logLevel (0) | u8 assertKind (2=Amount)
 *   | u64 LE value | u8 operator (4=GTE)
 */
export function assertTokenAccountGteIx(usdcAta: string | PublicKey, minAmount: bigint | number | string): TransactionInstruction {
  const min = toBigint(minAmount);
  if (min < 0n) throw new Error(`assertTokenAccountGteIx: minUsdcAfter must be >= 0, got ${min}`);
  if (min >= 1n << 64n) throw new Error(`assertTokenAccountGteIx: minUsdcAfter overflows u64: ${min}`);
  const data = Buffer.alloc(12);
  data.writeUInt8(ASSERT_TOKEN_ACCOUNT_DISCRIMINATOR, 0);
  data.writeUInt8(LOG_LEVEL_SILENT, 1);
  data.writeUInt8(TOKEN_ASSERT_AMOUNT, 2);
  data.writeBigUInt64LE(min, 3);
  data.writeUInt8(OP_GTE, 11);
  return new TransactionInstruction({
    programId: LIGHTHOUSE_PROGRAM_ID,
    keys: [{ pubkey: typeof usdcAta === "string" ? new PublicKey(usdcAta) : usdcAta, isSigner: false, isWritable: false }],
    data,
  });
}

export interface Postconditions {
  owner: string | PublicKey;
  usdcAta: string | PublicKey;
  minUsdcAfter: bigint | number | string;
}

/**
 * Append a Lighthouse postcondition asserting the owner's USDC token account
 * amount is >= minUsdcAfter at the end of the transaction. A bad outcome
 * (swap shortfall, wrong ATA debited, etc.) reverts on-chain instead of
 * merely failing an off-chain check.
 */
export function withPostconditions(
  instructions: TransactionInstruction[],
  { owner, usdcAta, minUsdcAfter }: Postconditions,
): TransactionInstruction[] {
  void owner;
  return [...instructions, assertTokenAccountGteIx(usdcAta, minUsdcAfter)];
}
