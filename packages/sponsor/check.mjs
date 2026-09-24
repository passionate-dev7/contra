// Independent check for the sponsor co-signer. Owned by the orchestrator.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../exec/package.json", import.meta.url));
const { Keypair, VersionedTransaction, TransactionMessage, SystemProgram, PublicKey, AddressLookupTableAccount, Connection } = require("@solana/web3.js");
const { cosign } = await import("./src/index.ts").catch(() => import("./dist/index.js"));
const sponsor = Keypair.generate();
const OWNER = "CtB2LNTpRnD97zTcDqMnTih7usipMxrD5WYsdiC9V3Jb";
execSync(`pnpm --filter @lastcall/convert build-tx ${OWNER} ${sponsor.publicKey.toBase58()} PreC1KtJ1sBPPqaeeqL6Qb15GTLCYVvyYEwxhdfTwfx PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh 1000000000`, { stdio: "ignore" });
const good = JSON.parse(readFileSync(new URL("../convert/out/convert.json", import.meta.url))).txBase64;
const signed = VersionedTransaction.deserialize(Buffer.from(await cosign(good, sponsor), "base64"));
if (!signed.signatures[0].some((b) => b !== 0)) throw new Error("valid conversion was not signed by sponsor");
const conn = new Connection(process.env.SOLANA_RPC_URL ?? "https://solana-rpc.publicnode.com");
const tx = VersionedTransaction.deserialize(Buffer.from(good, "base64"));
const alts = [];
for (const l of tx.message.addressTableLookups) alts.push((await conn.getAddressLookupTable(l.accountKey)).value);
const msg = TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: alts });
const attacker = Keypair.generate().publicKey;
const rejects = async (name, ixs, payer = sponsor.publicKey) => {
  const m = new TransactionMessage({ payerKey: payer, recentBlockhash: msg.recentBlockhash, instructions: ixs }).compileToV0Message(alts);
  const b64 = Buffer.from(new VersionedTransaction(m).serialize()).toString("base64");
  try { await cosign(b64, sponsor); } catch { return; }
  throw new Error(`sponsor signed a malicious tx: ${name}`);
};
await rejects("drain sponsor SOL", [...msg.instructions, SystemProgram.transfer({ fromPubkey: sponsor.publicKey, toPubkey: attacker, lamports: 1_000_000 })]);
await rejects("fee payer not sponsor", msg.instructions, new PublicKey(OWNER));
await rejects("no swap at all", msg.instructions.filter((i) => !i.programId.equals(new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"))));
console.log("ok: valid conversion co-signed; 3 malicious variants rejected");
