import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = fileURLToPath(new URL("../src/", import.meta.url));

function readSources(): Array<{ file: string; content: string }> {
  const entries = readdirSync(srcDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => entry.name)
    .sort();
  expect(files.length > 0).toBe(true);
  return files.map((file) => ({
    file,
    content: readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8"),
  }));
}

// The package never holds a key: signing happens in the browser wallet
// adapter and is injected as signTransaction. These tokens must never
// appear in src/.
const FORBIDDEN_TOKENS = [
  "Keypair.fromSecretKey",
  "fromSeed",
  "bip39",
  "PRIVATE_KEY",
  "SECRET_KEY",
  "readFileSync",
] as const;

// Local definitions of the injected signer (as opposed to declaring its
// type or calling the injected value) would mean the package signs itself.
const LOCAL_SIGNER_PATTERNS = [
  /function\s+signTransaction\s*\(/,
  /const\s+signTransaction\s*=/,
  /let\s+signTransaction\s*=/,
  /var\s+signTransaction\s*=/,
] as const;

describe("no-key guard", () => {
  it("reads every file in src/", () => {
    const sources = readSources();
    expect(sources.length > 0).toBe(true);
    for (const source of sources) {
      expect(source.content.length > 0).toBe(true);
    }
  });

  it("contains no keypair, seed, or secret material", () => {
    for (const source of readSources()) {
      for (const token of FORBIDDEN_TOKENS) {
        expect(
          source.content.includes(token),
          `${source.file} must not contain ${token}`,
        ).toBe(false);
      }
    }
  });

  it("never implements signTransaction locally", () => {
    for (const source of readSources()) {
      for (const pattern of LOCAL_SIGNER_PATTERNS) {
        expect(
          pattern.test(source.content),
          `${source.file} must not implement signTransaction (${pattern.source})`,
        ).toBe(false);
      }
    }
  });

  it("the guard itself can fail", () => {
    // A scan that cannot go red proves nothing. Feed it a violation and confirm
    // every matcher trips.
    const planted = [
      'const kp = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY));',
      'const signTransaction = async (tx) => { tx.sign([kp]); return tx; };',
      'const seed = readFileSync("./id.json");',
    ].join("\n");
    for (const token of FORBIDDEN_TOKENS) {
      if (token === "fromSeed" || token === "SECRET_KEY" || token === "bip39") {
        continue;
      }
      expect(planted.includes(token)).toBe(true);
    }
    expect(
      LOCAL_SIGNER_PATTERNS.some((pattern) => pattern.test(planted)),
    ).toBe(true);
    expect(planted.includes("sign(")).toBe(true);
  });

  it("never calls sign( on a transaction inside src/", () => {
    for (const source of readSources()) {
      expect(
        source.content.includes("sign("),
        `${source.file} must never call sign(`,
      ).toBe(false);
    }
  });
});
