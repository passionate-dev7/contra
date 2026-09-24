import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const JUPITER_V6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const ASSOCIATED_TOKEN = "ATokenGPvbdGVxr1b2hvZbsiqW5xWJ25efTNsLJA8knL";
const TOKEN_KEG = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

const ALLOWLIST = new Set([COMPUTE_BUDGET, JUPITER_V6, ASSOCIATED_TOKEN, TOKEN_KEG, TOKEN_2022]);

export async function cosign(txBase64: string, sponsor: Keypair): Promise<string> {
  const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, "base64"));

  const staticKeys = tx.message.staticAccountKeys;
  if (staticKeys.length === 0 || !staticKeys[0]?.equals(sponsor.publicKey)) {
    throw new Error("fee payer must be the sponsor");
  }

  const rpc = process.env["SOLANA_RPC_URL"] ?? "https://solana-rpc.publicnode.com";
  const connection = new Connection(rpc, "confirmed");

  const lookups: AddressLookupTableAccount[] = [];
  for (const lookup of tx.message.addressTableLookups) {
    const table = await connection.getAddressLookupTable(lookup.accountKey);
    if (table.value === null) {
      throw new Error(`address lookup table ${lookup.accountKey.toBase58()} not found`);
    }
    lookups.push(table.value);
  }

  const decompiled = TransactionMessage.decompile(tx.message, {
    addressLookupTableAccounts: lookups,
  });

  if (!decompiled.payerKey.equals(sponsor.publicKey)) {
    throw new Error("fee payer must be the sponsor");
  }

  let jupiterCount = 0;
  for (const ix of decompiled.instructions) {
    const programId = ix.programId.toBase58();
    if (!ALLOWLIST.has(programId)) {
      throw new Error(`program not allowed: ${programId}`);
    }
    if (programId === JUPITER_V6) {
      jupiterCount += 1;
    }
  }
  if (jupiterCount !== 1) {
    throw new Error(`expected exactly one Jupiter instruction, found ${jupiterCount}`);
  }

  const ataProgram = new PublicKey(ASSOCIATED_TOKEN);
  for (const ix of decompiled.instructions) {
    for (const key of ix.keys) {
      if (!key.isSigner) continue;
      if (!key.pubkey.equals(sponsor.publicKey)) continue;
      if (ix.programId.equals(ataProgram)) {
        const funder = ix.keys[0];
        if (funder !== undefined && funder.pubkey.equals(sponsor.publicKey)) {
          const discriminant = ix.data.length > 0 ? ix.data[0] : undefined;
          if (discriminant === 0 || discriminant === 1) continue;
          throw new Error("sponsor may only fund ATA create/createIdempotent");
        }
      }
      throw new Error("sponsor appears as a signer outside fee payer / ATA funder");
    }
  }

  tx.sign([sponsor]);
  return Buffer.from(tx.serialize()).toString("base64");
}
