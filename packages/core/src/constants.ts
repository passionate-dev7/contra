import { Connection } from "@solana/web3.js";

export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const DEFAULT_RPC_URL = "https://api.mainnet-beta.solana.com";
export const PRESTOCKS_API_URL = "https://prestocks.com/api/prestocks";

export function rpcUrl(): string {
  return process.env.RPC_URL || DEFAULT_RPC_URL;
}

export function connection(url = rpcUrl()): Connection {
  return new Connection(url, "confirmed");
}
