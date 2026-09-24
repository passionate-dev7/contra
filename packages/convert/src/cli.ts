import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection } from "@solana/web3.js";
import { buildSponsoredConversion } from "./sponsored.js";

const [owner, feePayer, fromMint, toMint, amountRaw] = process.argv.slice(2);
if (!owner || !feePayer || !fromMint || !toMint || !amountRaw) {
  console.error(
    "usage: tsx src/cli.ts <owner> <feePayer> <fromMint> <toMint> <amountRaw>",
  );
  process.exit(1);
}

const rpc =
  process.env["SOLANA_RPC_URL"] ?? "https://solana-rpc.publicnode.com";
const connection = new Connection(rpc, "confirmed");

const tx = await buildSponsoredConversion({
  connection,
  owner,
  feePayer,
  fromMint,
  toMint,
  amountRaw,
});

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "out");
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, "convert.json"),
  JSON.stringify(
    {
      txBase64: Buffer.from(tx.serialize()).toString("base64"),
      owner,
      feePayer,
      fromMint,
      toMint,
    },
    null,
    2,
  ) + "\n",
);
console.log(`wrote ${join(outDir, "convert.json")}`);
