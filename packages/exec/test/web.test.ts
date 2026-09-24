import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { defaultConnection } from "../src/connection.js";
import { readExecMintFacts } from "../src/mint.js";
import { readFinalizedSwapEvidence } from "../src/web.js";
import { buildSwap } from "../src/web.js";
import { transferFeeOf } from "../src/fee.js";

const SPACEX = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const SIMULATION_SUBJECT = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";

describe("buildSwap, the surface apps/web calls", () => {
  it("returns a base64 transaction, a block height and a fee-adjusted expectation", async () => {
    const built = await buildSwap({
      symbol: "SPACEX",
      mint: SPACEX,
      notionalUsd: 250,
      userPublicKey: SIMULATION_SUBJECT,
      slippageBps: 100,
    });
    expect(built.transactionBase64.length).toBeGreaterThan(100);
    expect(Buffer.from(built.transactionBase64, "base64").length).toBeGreaterThan(200);
    expect(built.lastValidBlockHeight).toBeGreaterThan(0);
    expect(built.expectedNetDelta).toBeGreaterThan(0);
    expect([50, 100]).toContain(built.inForceBps);
    expect(new PublicKey(built.destinationAta).toBase58()).toBe(built.destinationAta);
  });
});

/**
 * The confirm path cannot be exercised on a swap we signed, because no key exists
 * here. It can be exercised on somebody else's finalized swap, which is the same
 * code reading the same ledger. This test finds a real finalized Token-2022
 * transfer of this mint and asserts the fee arithmetic reconciles the transfer
 * instruction against the ledger balance delta, two independent readings.
 */
describe("finalized-transaction evidence on a real mainnet transfer", () => {
  it("reconciles gross, fee and the destination balance delta", async () => {
    const conn = defaultConnection();
    const facts = await readExecMintFacts(conn, SPACEX);
    const signatures = await conn.getSignaturesForAddress(
      new PublicKey(SPACEX),
      { limit: 40 },
      "finalized",
    );
    expect(signatures.length).toBeGreaterThan(0);

    let checked = 0;
    for (const entry of signatures) {
      if (entry.err !== null) {
        continue;
      }
      const tx = await conn.getParsedTransaction(entry.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "finalized",
      });
      if (tx?.meta == null || tx.meta.err !== null) {
        continue;
      }
      const every = [
        ...tx.transaction.message.instructions,
        ...(tx.meta.innerInstructions ?? []).flatMap((g) => g.instructions),
      ];
      for (const ix of every) {
        if (!("parsed" in ix) || ix.programId.toBase58() !== TOKEN_2022) {
          continue;
        }
        if (!String(ix.parsed.type).startsWith("transfer")) {
          continue;
        }
        const info = ix.parsed.info as {
          mint?: string;
          destination?: string;
          tokenAmount?: { amount?: string };
        };
        const amount = info.tokenAmount?.amount;
        if (info.mint !== SPACEX || typeof amount !== "string") {
          continue;
        }
        const destination = info.destination;
        if (destination === undefined) {
          continue;
        }

        const gross = BigInt(amount);
        const fee = transferFeeOf(
          gross,
          facts.inForceBps,
          facts.inForceMaximumFee,
        );
        const pre = (tx.meta.preTokenBalances ?? []).find(
          (b) =>
            b.mint === SPACEX &&
            tx.transaction.message.accountKeys[b.accountIndex]?.pubkey.toBase58() ===
              destination,
        );
        const post = (tx.meta.postTokenBalances ?? []).find(
          (b) =>
            b.mint === SPACEX &&
            tx.transaction.message.accountKeys[b.accountIndex]?.pubkey.toBase58() ===
              destination,
        );
        if (post === undefined) {
          continue;
        }
        const delta =
          BigInt(post.uiTokenAmount.amount) -
          BigInt(pre?.uiTokenAmount.amount ?? "0");
        // The destination may also have sent tokens out in the same transaction,
        // so only assert on destinations whose net movement is a pure receipt.
        if (delta <= 0n) {
          continue;
        }

        // eslint-disable-next-line no-console
        console.log(
          `finalized ${entry.signature.slice(0, 16)}... slot=${String(tx.slot)} ` +
            `dest=${destination.slice(0, 8)} gross=${gross.toString()} ` +
            `fee@${String(facts.inForceBps)}bps=${fee.toString()} ` +
            `net=${(gross - fee).toString()} ledgerDelta=${delta.toString()}`,
        );
        expect(gross - fee).toBe(delta);
        checked += 1;
        break;
      }
      if (checked > 0) {
        break;
      }
    }

    // Never pass on an empty search: if no finalized transfer was found the
    // assertion above never ran and this test proved nothing.
    expect(checked).toBeGreaterThan(0);
  });

  it("returns null for a signature that is not finalized", async () => {
    const conn = defaultConnection();
    const facts = await readExecMintFacts(conn, SPACEX);
    // 64 zero bytes in base58: a well-formed signature that was never submitted.
    const neverSent = "1".repeat(64);
    const evidence = await readFinalizedSwapEvidence(
      conn,
      neverSent,
      SPACEX,
      SIMULATION_SUBJECT,
      facts,
    );
    expect(evidence).toBeNull();
  });
});
