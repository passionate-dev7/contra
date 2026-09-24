import { describe, expect, it } from "vitest";
import type { VersionedTransaction } from "@solana/web3.js";
import type { SwapRequest } from "@fineprint/core";
import { defaultConnection } from "../src/index.js";
import { executeSwap } from "../src/execute.js";
import { WalletMutatedTransactionError } from "../src/errors.js";

const SIMULATION_SUBJECT = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";

const req: SwapRequest = {
  symbol: "SPACEX",
  mint: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh",
  notionalUsd: 25,
  userPublicKey: SIMULATION_SUBJECT,
  slippageBps: 100,
};

describe("executeSwap wallet guard", () => {
  it("refuses to send when the wallet hands back an unsigned transaction", async () => {
    // A wallet adapter that returns the transaction untouched. No key exists
    // anywhere in this package, so this is the only reachable end of the signing
    // path in a test, and it must abort before sendRawTransaction.
    const passthrough = async (
      tx: VersionedTransaction,
    ): Promise<VersionedTransaction> => tx;

    await expect(
      executeSwap(defaultConnection(), req, passthrough),
    ).rejects.toBeInstanceOf(WalletMutatedTransactionError);
  });

  it("refuses to send when the wallet returns a different message", async () => {
    const tamper = async (
      tx: VersionedTransaction,
    ): Promise<VersionedTransaction> => {
      // Forge a signature slot so the first guard passes, then alter the message
      // so the second guard is the one that has to fire.
      const firstSig = tx.signatures[0];
      if (firstSig !== undefined) {
        firstSig[0] = 7;
      }
      tx.message.recentBlockhash = "11111111111111111111111111111111";
      return tx;
    };

    await expect(
      executeSwap(defaultConnection(), req, tamper),
    ).rejects.toBeInstanceOf(WalletMutatedTransactionError);
  });
});
