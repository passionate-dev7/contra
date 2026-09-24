import { Connection } from "@solana/web3.js";
import type { Commitment } from "@solana/web3.js";

export const DEFAULT_RPC_URL = "https://api.mainnet-beta.solana.com";

export function resolveRpcUrl(): string {
  const env =
    typeof process === "undefined" ? undefined : process.env["RPC_URL"];
  return env ?? DEFAULT_RPC_URL;
}

export function defaultConnection(
  commitment: Commitment = "confirmed",
): Connection {
  return new Connection(resolveRpcUrl(), commitment);
}
