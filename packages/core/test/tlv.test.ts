/**
 * Why this file exists: jsonParsed hands `maximumFee` back as a JSON *number*.
 * JSON.parse cannot hold 18446744073709551615 and rounds it to 18446744073709552000.
 * These tests pin the exact-byte read against live mainnet data and against the
 * corroborating jsonParsed fields.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { Connection, PublicKey } from "@solana/web3.js";
import { connection, rpcUrl, DEFAULT_RPC_URL } from "../src/constants.js";
import { parseTlvEntries, readTransferFeeConfigExact, U64_MAX } from "../src/tlv.js";
import { fetchPreStocksTokens } from "../src/prestocks.js";

let conn: Connection;
let spacexMint: string;

beforeAll(async () => {
  conn = connection();
  const tokens = await fetchPreStocksTokens();
  spacexMint = tokens.find((t) => t.symbol === "SPACEX")!.mint;
}, 60_000);

describe("rpc configuration", () => {
  it("defaults to public mainnet and honours RPC_URL without embedding a secret", () => {
    const original = process.env.RPC_URL;
    delete process.env.RPC_URL;
    expect(rpcUrl()).toBe(DEFAULT_RPC_URL);
    process.env.RPC_URL = "https://example.invalid/override";
    expect(rpcUrl()).toBe("https://example.invalid/override");
    if (original === undefined) delete process.env.RPC_URL;
    else process.env.RPC_URL = original;
  });
});

describe("exact u64 transfer fee read", () => {
  it("recovers u64 max exactly where jsonParsed loses it", async () => {
    const pk = new PublicKey(spacexMint);
    const raw = await conn.getAccountInfo(pk, "confirmed");
    expect(raw).not.toBeNull();

    const exact = readTransferFeeConfigExact(raw!.data)!;
    expect(exact).not.toBeNull();
    expect(exact.newer.maximumFee).toBe(U64_MAX);
    expect(exact.older.maximumFee).toBe(U64_MAX);
    expect(exact.newer.transferFeeBasisPoints).toBe(100);
    expect(exact.older.transferFeeBasisPoints).toBe(50);
    expect(exact.newer.epoch).toBe(1039);
    expect(exact.older.epoch).toBe(1032);

    const parsed = await conn.getParsedAccountInfo(pk, "confirmed");
    const data = parsed.value!.data as { parsed: { info: { extensions: Array<{ extension: string; state: any }> } } };
    const fee = data.parsed.info.extensions.find((e) => e.extension === "transferFeeConfig")!.state;

    // The lossy path, demonstrated rather than asserted from memory.
    const lossy = String(fee.newerTransferFee.maximumFee);
    console.log(`\n  jsonParsed maximumFee = ${lossy}\n  exact TLV maximumFee  = ${exact.newer.maximumFee}\n`);
    expect(lossy).not.toBe(U64_MAX);
    expect(BigInt(exact.newer.maximumFee)).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));

    // But bps and epoch DO survive jsonParsed, so they corroborate the byte offsets.
    expect(fee.newerTransferFee.transferFeeBasisPoints).toBe(exact.newer.transferFeeBasisPoints);
    expect(fee.newerTransferFee.epoch).toBe(exact.newer.epoch);
  }, 60_000);

  it("walks a real TLV region and finds TransferFeeConfig as type 1, length 108", async () => {
    const raw = await conn.getAccountInfo(new PublicKey(spacexMint), "confirmed");
    const entries = parseTlvEntries(raw!.data);
    expect(entries.length).toBeGreaterThan(5);
    const tf = entries.find((e) => e.type === 1);
    expect(tf, "no TransferFeeConfig TLV entry").toBeDefined();
    expect(tf!.length).toBe(108);
    // entries must tile the region without overlapping
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i]!.start).toBe(entries[i - 1]!.start + entries[i - 1]!.length + 4);
    }
  }, 60_000);

  it("returns null rather than garbage when there is no TransferFeeConfig", () => {
    const empty = Buffer.alloc(200);
    expect(readTransferFeeConfigExact(empty)).toBeNull();
    expect(parseTlvEntries(empty)).toEqual([]);
    expect(parseTlvEntries(Buffer.alloc(10))).toEqual([]);
  });
});
