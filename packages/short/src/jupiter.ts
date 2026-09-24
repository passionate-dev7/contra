import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { JUP_QUOTE_URL, JUP_SWAP_INSTRUCTIONS_URL } from "./constants.js";

export interface JupQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: Array<{ swapInfo: { label: string; [k: string]: unknown }; [k: string]: unknown }>;
  [k: string]: unknown;
}

interface RawInstruction {
  programId: string;
  accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  data: string; // base64
}

interface SwapInstructionsResponse {
  tokenLedgerInstruction?: RawInstruction;
  computeBudgetInstructions?: RawInstruction[];
  setupInstructions?: RawInstruction[];
  swapInstruction: RawInstruction;
  cleanupInstruction?: RawInstruction;
  addressLookupTableAddresses: string[];
  [k: string]: unknown;
}

export interface JupSwapInstructions {
  setup: TransactionInstruction[];
  swap: TransactionInstruction;
  cleanup: TransactionInstruction[];
  lookupTableAddresses: string[];
}

function toIx(raw: RawInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(raw.programId),
    keys: raw.accounts.map((a) => ({
      pubkey: new PublicKey(a.pubkey),
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    })),
    data: Buffer.from(raw.data, "base64"),
  });
}

export async function getQuote(p: {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  slippageBps: number;
}): Promise<JupQuote> {
  const params = new URLSearchParams({
    inputMint: p.inputMint,
    outputMint: p.outputMint,
    amount: p.amount.toString(),
    slippageBps: String(p.slippageBps),
    swapMode: "ExactIn",
  });
  const res = await fetch(`${JUP_QUOTE_URL}?${params.toString()}`);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Jupiter quote failed: ${res.status} ${text}`);
  }
  return JSON.parse(text) as JupQuote;
}

/**
 * Jupiter's swap-instructions endpoint (not /swap): returns the swap as raw
 * instructions rather than a pre-built transaction, so they can be composed
 * with the Kamino deposit/borrow (or repay/withdraw) instructions in one v0
 * message instead of two separate signed transactions.
 */
export async function getSwapInstructions(p: {
  quote: JupQuote;
  userPublicKey: string;
}): Promise<JupSwapInstructions> {
  const res = await fetch(JUP_SWAP_INSTRUCTIONS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: p.quote,
      userPublicKey: p.userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Jupiter swap-instructions failed: ${res.status} ${text}`);
  }
  const body = JSON.parse(text) as SwapInstructionsResponse;
  return {
    setup: (body.setupInstructions ?? []).map(toIx),
    swap: toIx(body.swapInstruction),
    cleanup: body.cleanupInstruction ? [toIx(body.cleanupInstruction)] : [],
    lookupTableAddresses: body.addressLookupTableAddresses ?? [],
  };
}

export function routeLabel(quote: JupQuote): string {
  return quote.routePlan.map((r) => r.swapInfo.label).join(" -> ");
}
