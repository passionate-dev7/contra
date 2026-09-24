import { describe, expect, it } from "vitest";
import { Connection } from "@solana/web3.js";
import type { MintFacts } from "@fineprint/core";
import { defaultConnection } from "../src/index.js";
import { execFactsFromMintFacts, readExecMintFacts } from "../src/mint.js";
import { inForceTier } from "../src/fee.js";
import { buildUnsignedSwap } from "../src/build.js";
import { MintPausedError } from "../src/errors.js";

const SPACEX = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const UNCAPPED = "18446744073709551615";

describe("readExecMintFacts against mainnet", () => {
  it("decodes the Token-2022 extensions that decide whether a swap is safe", async () => {
    const conn: Connection = defaultConnection();
    const facts = await readExecMintFacts(conn, SPACEX);

    expect(facts.ownerProgram).toBe(TOKEN_2022);
    expect(facts.decimals).toBeGreaterThan(0);

    // Two tiers live on the mint. The issuer already doubled the fee once.
    expect(facts.tiers.older.transferFeeBasisPoints).toBe(50);
    expect(facts.tiers.older.epoch).toBe(1032);
    expect(facts.tiers.newer.transferFeeBasisPoints).toBe(100);
    expect(facts.tiers.newer.epoch).toBe(1039);
    expect(facts.tiers.newer.maximumFee.toString()).toBe(UNCAPPED);

    // The bps actually charged is the tier in force at the CURRENT epoch, not the
    // newer tier. Hardcoding either number is wrong on one side of epoch 1039.
    const expectedTier = inForceTier(
      facts.tiers.older,
      facts.tiers.newer,
      facts.currentEpoch,
    );
    expect(facts.inForceBps).toBe(expectedTier.transferFeeBasisPoints);
    expect(facts.inForceMaximumFee).toBe(expectedTier.maximumFee);
    expect([50, 100]).toContain(facts.inForceBps);

    expect(facts.paused).toBe(false);
    expect(facts.pausableAuthority).not.toBeNull();
    expect(facts.permanentDelegate).not.toBeNull();
    expect(facts.transferHookProgramId).toBeNull();
    expect(facts.defaultAccountState).toBe("initialized");
    expect(facts.slot).toBeGreaterThan(0);
  });
});

function pausedMintFacts(paused: boolean): MintFacts {
  return {
    symbol: "SPACEX",
    mint: SPACEX,
    ownerProgram: TOKEN_2022,
    decimals: 9,
    rawSupply: "8742506795000000",
    effectiveSupply: 43712.533977,
    transferFee: {
      current: {
        epoch: 1039,
        transferFeeBasisPoints: 100,
        maximumFee: UNCAPPED,
      },
      previous: {
        epoch: 1032,
        transferFeeBasisPoints: 50,
        maximumFee: UNCAPPED,
      },
      currentBps: 100,
      roundTripBps: 199,
      uncapped: true,
    },
    scaledUiAmount: null,
    powers: {
      permanentDelegate: "WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc",
      pausableAuthority: "WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc",
      paused,
      transferFeeAuthority: "WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc",
      withdrawWithheldAuthority: "WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc",
      transferHookAuthority: "WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc",
      transferHookProgramId: null,
      scaledUiAmountAuthority: "WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc",
      defaultAccountState: "initialized",
      singleKeyControlsAll: true,
      distinctAuthorities: ["WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc"],
    },
    extensionsPresent: [
      "permanentDelegate",
      "defaultAccountState",
      "transferFeeConfig",
      "pausableConfig",
      "transferHook",
    ],
    asOfUnix: 1758369600,
    slot: 448720096,
  };
}

describe("execFactsFromMintFacts", () => {
  it("picks the tier in force at the given epoch, not the newest tier", () => {
    const facts = pausedMintFacts(false);
    expect(execFactsFromMintFacts(facts, 1038).inForceBps).toBe(50);
    expect(execFactsFromMintFacts(facts, 1039).inForceBps).toBe(100);
    expect(execFactsFromMintFacts(facts, 1200).inForceBps).toBe(100);
  });
});

describe("paused issuer", () => {
  it("refuses to build a swap when the mint is paused, before any Jupiter call", async () => {
    const conn: Connection = defaultConnection();
    const facts = execFactsFromMintFacts(pausedMintFacts(true), 1038);
    expect(facts.paused).toBe(true);

    await expect(
      buildUnsignedSwap(
        conn,
        {
          symbol: "SPACEX",
          mint: SPACEX,
          notionalUsd: 250,
          userPublicKey: "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9",
          slippageBps: 100,
        },
        { facts },
      ),
    ).rejects.toBeInstanceOf(MintPausedError);
  });

  it("builds past the paused gate when the issuer has not halted transfers", async () => {
    // The negative case. If the guard rejected unconditionally the test above
    // would pass for the wrong reason.
    const conn: Connection = defaultConnection();
    const facts = execFactsFromMintFacts(pausedMintFacts(false), 1038);
    const built = await buildUnsignedSwap(
      conn,
      {
        symbol: "SPACEX",
        mint: SPACEX,
        notionalUsd: 25,
        userPublicKey: "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9",
        slippageBps: 100,
      },
      { facts, simulate: false },
    );
    expect(built.transaction.message.compiledInstructions.length).toBeGreaterThan(0);
  });
});
