// Independent post-condition for the sponsored conversion builder. Owned by the orchestrator.
// Reads out/convert.json ({ txBase64, owner, feePayer, fromMint, toMint }) and simulates it on mainnet itself.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../exec/package.json", import.meta.url));
const { PublicKey, VersionedTransaction } = require("@solana/web3.js");
const { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } = require("@solana/spl-token");

const RPC = process.env.SOLANA_RPC_URL ?? "https://solana-rpc.publicnode.com";
const { txBase64, owner, feePayer, fromMint, toMint } = JSON.parse(readFileSync(new URL("./out/convert.json", import.meta.url)));
for (const [k, v] of Object.entries({ txBase64, owner, feePayer, fromMint, toMint })) if (!v) throw new Error(`missing ${k}`);
if (owner === feePayer) throw new Error("fee payer must be the sponsor, not the holder");

const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, "base64"));
const payerInTx = tx.message.staticAccountKeys[0].toBase58();
if (payerInTx !== feePayer) throw new Error(`tx fee payer is ${payerInTx}, expected sponsor ${feePayer}`);

const ownerPk = new PublicKey(owner);
const fromAta = getAssociatedTokenAddressSync(new PublicKey(fromMint), ownerPk, true, TOKEN_2022_PROGRAM_ID).toBase58();
const toAta = getAssociatedTokenAddressSync(new PublicKey(toMint), ownerPk, true, TOKEN_2022_PROGRAM_ID).toBase58();

const call = (method, params) => fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((r) => r.json());

const ownerSol = (await call("getBalance", [owner])).result?.value;
const before = (await call("getMultipleAccounts", [[fromAta, toAta], { encoding: "jsonParsed" }])).result.value
  .map((a) => BigInt(a?.data?.parsed?.info?.tokenAmount?.amount ?? 0));

const sim = await call("simulateTransaction", [txBase64, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true,
  accounts: { encoding: "jsonParsed", addresses: [fromAta, toAta] } }]);
const v = sim.result?.value;
if (!v) throw new Error(`RPC error: ${JSON.stringify(sim.error)}`);
if (v.err) throw new Error(`simulation failed: ${JSON.stringify(v.err)}\n${(v.logs ?? []).join("\n")}`);
const after = v.accounts.map((a) => BigInt(a?.data?.parsed?.info?.tokenAmount?.amount ?? 0));

if (!(after[0] < before[0])) throw new Error(`holder ${fromMint} balance did not decrease (${before[0]} -> ${after[0]})`);
if (!(after[1] > before[1])) throw new Error(`holder ${toMint} balance did not increase (${before[1]} -> ${after[1]})`);
console.log(`ok: holder SOL ${ownerSol} lamports; ${fromMint.slice(0, 6)} ${before[0]} -> ${after[0]}; ${toMint.slice(0, 6)} ${before[1]} -> ${after[1]}; fee payer ${feePayer}; units ${v.unitsConsumed}`);
