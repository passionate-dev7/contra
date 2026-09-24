import type { MintFacts, NaiveVsCorrect } from "./types.js";

export function naiveVsCorrect(facts: MintFacts[]): NaiveVsCorrect[] {
  return facts.map((factsEntry) => {
    const naiveSupply = Number(factsEntry.rawSupply) / 10 ** factsEntry.decimals;
    const correctSupply = factsEntry.effectiveSupply;
    return {
      symbol: factsEntry.symbol,
      naiveSupply,
      correctSupply,
      errorPct: (correctSupply / naiveSupply - 1) * 100,
    };
  });
}
