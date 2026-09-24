"use client";

import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { Connection, VersionedTransaction } from "@solana/web3.js";

const SOLANA_CHAINS = ["solana:mainnet", "solana:mainnet-beta"];

/** Wallets registered via the Wallet Standard (Phantom, Backpack, Solflare, ...)
 * that speak Solana and can sign-and-send. No wallet-adapter-react: the Wallet
 * Standard is the platform feature the uicontract and product brief both name. */
export function listSolanaWallets(): Wallet[] {
  const { get } = getWallets();
  return get().filter((w) => w.chains.some((c) => SOLANA_CHAINS.includes(c)) && "standard:connect" in w.features);
}

export async function connectWallet(wallet: Wallet): Promise<WalletAccount> {
  const connect = wallet.features["standard:connect"] as { connect: () => Promise<{ accounts: readonly WalletAccount[] }> };
  const { accounts } = await connect.connect();
  const account = accounts[0];
  if (account === undefined) {
    throw new Error(`${wallet.name} returned no account`);
  }
  return account;
}

function rpcUrl(): string {
  return process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
}

/** Sign and send each base64 v0 transaction in order, confirming one before
 * sending the next (the split-open-short path spends what the first tx just
 * created). Returns the signatures in send order. */
export async function signAndSendAll(wallet: Wallet, account: WalletAccount, base64Txs: string[]): Promise<string[]> {
  const feature = wallet.features["solana:signAndSendTransaction"] as
    | {
        signAndSendTransaction: (
          ...inputs: Array<{ transaction: Uint8Array; account: WalletAccount; chain: string }>
        ) => Promise<readonly { signature: Uint8Array }[]>;
      }
    | undefined;
  if (feature === undefined) {
    throw new Error(`${wallet.name} does not support solana:signAndSendTransaction`);
  }
  const conn = new Connection(rpcUrl(), "confirmed");
  const signatures: string[] = [];
  for (const b64 of base64Txs) {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    VersionedTransaction.deserialize(bytes); // throws on malformed input before we bother the wallet
    const [result] = await feature.signAndSendTransaction({ transaction: bytes, account, chain: "solana:mainnet" });
    if (result === undefined) {
      throw new Error(`${wallet.name} returned no signature`);
    }
    const sig = base58Encode(result.signature);
    await conn.confirmTransaction(sig, "confirmed");
    signatures.push(sig);
  }
  return signatures;
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i]! << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    digits.push(0);
  }
  return digits
    .reverse()
    .map((d) => BASE58_ALPHABET[d])
    .join("");
}
