import { Connection } from "@solana/web3.js";
import { createSolanaRpc } from "@solana/kit";

export const DEFAULT_RPC_URL = "https://api.mainnet-beta.solana.com";

/** SOLANA_RPC_URL wins; RPC_URL is the monorepo-wide fallback used by
 * packages/core and packages/exec; otherwise the public mainnet endpoint. */
export function resolveRpcUrl(): string {
  return process.env["SOLANA_RPC_URL"] || process.env["RPC_URL"] || DEFAULT_RPC_URL;
}

/** @solana/web3.js Connection: simulateTransaction, getAccountInfo, ATA reads. */
export function web3Connection(url = resolveRpcUrl()): Connection {
  return new Connection(url, "confirmed");
}

/** @solana/kit Rpc: required by @kamino-finance/klend-sdk. */
export function kitRpc(url = resolveRpcUrl()) {
  return createSolanaRpc(url);
}
