import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { AccountRole, type Address, type Instruction, type TransactionSigner } from "@solana/kit";

/**
 * KaminoAction.actionToIxs returns @solana/kit `Instruction`s (programAddress /
 * accounts[].role / data as Uint8Array). Jupiter's swap-instructions endpoint and
 * @solana/web3.js VersionedTransaction both speak the legacy shape (programId /
 * keys[].{isSigner,isWritable} / data as Buffer). This converts kit -> legacy so
 * both instruction sources can be compiled into one v0 message.
 */
export function kitIxToWeb3(ix: Instruction): TransactionInstruction {
  const keys = (ix.accounts ?? []).map((a) => {
    if (!("role" in a)) {
      throw new Error("kitIxToWeb3: lookup-table account metas are not supported, expected a plain AccountMeta");
    }
    const role = a.role as AccountRole;
    return {
      pubkey: new PublicKey(a.address),
      isSigner: role === AccountRole.READONLY_SIGNER || role === AccountRole.WRITABLE_SIGNER,
      isWritable: role === AccountRole.WRITABLE || role === AccountRole.WRITABLE_SIGNER,
    };
  });
  return new TransactionInstruction({
    programId: new PublicKey(ix.programAddress),
    keys,
    data: Buffer.from(ix.data ?? new Uint8Array()),
  });
}

/**
 * A @solana/kit TransactionSigner that can never sign. contra only builds
 * instructions; klend-sdk needs a TransactionSigner shape to read `.address`
 * while assembling accounts, but this product never calls .signTransactions
 * and never holds a key. Calling it is a bug, so it throws instead of
 * returning a fake signature.
 */
export function readOnlySigner(address: Address): TransactionSigner {
  return {
    address,
    signTransactions: () => {
      throw new Error("readOnlySigner: contra never signs transactions, the caller's wallet does");
    },
  } as unknown as TransactionSigner;
}
