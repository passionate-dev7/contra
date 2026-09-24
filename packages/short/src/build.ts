import Decimal from "decimal.js";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { address, none, type Address } from "@solana/kit";
import { KaminoAction } from "@kamino-finance/klend-sdk";
import type { KaminoMarket, KaminoReserve } from "@kamino-finance/klend-sdk";
import { loadMarket, findUsdcReserve, findXstockReserve, vanillaObligationType, vanillaObligationAddress, ledgerInstant } from "./market.js";
import { buildScopeRefresh } from "./scope.js";
import { kitIxToWeb3, readOnlySigner } from "./kit.js";
import { getQuote, getSwapInstructions, routeLabel, type JupQuote } from "./jupiter.js";
import { USDC_MINT, XSTOCKS_MARKET_LUT } from "./constants.js";

const V2_IXS = true;
const EXTRA_COMPUTE_BUDGET = 1_400_000;
const BUYBACK_BUFFER_BPS = 50;
// Measured: a Byreal route pushed Scope refresh + buy + repay + withdraw over 1232 bytes; Riptide fit at 1165.
const CLOSE_MAX_SWAP_ACCOUNTS = 20;

export interface ShortRequest {
  owner: string;
  ticker: string; // e.g. "TSLA" for the TSLAx reserve
  usdcCollateral: number; // UI USDC, e.g. 0.5
  borrowAmount: number; // UI xStock units, e.g. 0.001
  slippageBps?: number;
}

export interface CloseShortRequest {
  owner: string;
  ticker: string;
  repayAmount: number; // UI xStock units to repay (borrowed amount + accrued interest)
  withdrawUsdc: number; // UI USDC to withdraw back out
  maxUsdcIn: number; // UI USDC budget to buy back the xStock, quote-checked
  slippageBps?: number;
}

export interface BuiltShort {
  instructions: TransactionInstruction[];
  lookupTables: AddressLookupTableAccount[];
  quote: JupQuote;
  route: string;
  transaction: VersionedTransaction;
  /** Present only when the combined message did not fit in one v0 transaction. */
  secondTransaction?: VersionedTransaction;
  reason: string; // why one tx vs a split, for the report
  scopeTokens: number[]; // Scope entries refreshed in-tx by the leading refresh_price_list
}

/** Every reserve klend will refresh for this owner's obligation plus the action's two reserves. */
async function reservesToPrice(market: KaminoMarket, owner: Address, action: KaminoReserve[]): Promise<Address[]> {
  const obligation = await market.getObligationByAddress(await vanillaObligationAddress(market, owner));
  const held = obligation === null ? [] : [...obligation.getDeposits(), ...obligation.getBorrows()].map((p) => p.reserveAddress);
  return [...held, ...action.map((r) => r.address)];
}

function toRaw(uiAmount: number, decimals: number): string {
  return new Decimal(uiAmount).mul(new Decimal(10).pow(decimals)).toFixed(0);
}

async function compileMessage(
  conn: Connection,
  payer: PublicKey,
  ixs: TransactionInstruction[],
  lookupTables: AddressLookupTableAccount[],
): Promise<VersionedTransaction> {
  const { blockhash } = await conn.getLatestBlockhash("finalized");
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message(lookupTables);
  return new VersionedTransaction(message);
}

/** null means "does not fit at all" (web3.js's fixed-size wire buffer overruns
 * before it can even report a length), which is still a firm "must split". */
function trySerializedSize(tx: VersionedTransaction): number | null {
  try {
    return tx.serialize().length;
  } catch {
    return null;
  }
}

async function resolveLookupTables(conn: Connection, addresses: string[]): Promise<AddressLookupTableAccount[]> {
  const out: AddressLookupTableAccount[] = [];
  for (const addr of addresses) {
    const res = await conn.getAddressLookupTable(new PublicKey(addr));
    if (res.value !== null) {
      out.push(res.value);
    }
  }
  return out;
}

/**
 * Open a short: deposit USDC collateral + borrow the xStock (init user
 * metadata / obligation inline if missing, refresh reserves + obligation via
 * klend-sdk's own support instructions), then sell the borrowed xStock for
 * USDC through Jupiter (swap-instructions, not /swap, so it composes into the
 * same v0 message). One transaction unless the combined instruction set is
 * too large for a single v0 message, in which case it is split into a Kamino
 * leg and a Jupiter leg and both unsigned transactions are returned.
 */
export async function buildOpenShort(conn: Connection, req: ShortRequest): Promise<BuiltShort> {
  const ownerAddr = address(req.owner);
  const market = await loadMarket();
  const usdcReserve = findUsdcReserve(market);
  const xstockReserve = findXstockReserve(market, req.ticker);
  const usdcDecimals = Number(usdcReserve.state.liquidity.mintDecimals.toString());
  const xstockDecimals = Number(xstockReserve.state.liquidity.mintDecimals.toString());

  // Throws MarketClosedError before anything is built when Scope's upstream is too old to refresh.
  const scopeRefresh = await buildScopeRefresh(market, await reservesToPrice(market, ownerAddr, [usdcReserve, xstockReserve]));
  const lead = [ComputeBudgetProgram.setComputeUnitLimit({ units: EXTRA_COMPUTE_BUDGET }), ...(scopeRefresh.instruction ? [scopeRefresh.instruction] : [])];

  const depositAmountRaw = toRaw(req.usdcCollateral, usdcDecimals);
  const borrowAmountRaw = toRaw(req.borrowAmount, xstockDecimals);

  const axn = await KaminoAction.buildDepositAndBorrowTxns({
    kaminoMarket: market,
    depositAmount: depositAmountRaw,
    depositReserveAddress: usdcReserve.address,
    borrowAmount: borrowAmountRaw,
    borrowReserveAddress: xstockReserve.address,
    owner: readOnlySigner(ownerAddr),
    obligation: vanillaObligationType(market),
    useV2Ixs: V2_IXS,
    scopeRefreshConfig: undefined,
    extraComputeBudget: 0, // we add one explicit CU-limit ix ourselves below, to cover the Jupiter leg too
    includeAtaIxs: true,
    requestElevationGroup: false,
    initUserMetadata: { skipInitialization: false, skipLutCreation: true },
    referrer: none(),
    currentLedgerInstant: await ledgerInstant(),
  });
  const kaminoIxs = KaminoAction.actionToIxs(axn).map(kitIxToWeb3);

  const quote = await getQuote({
    inputMint: xstockReserve.getLiquidityMint().toString(),
    outputMint: USDC_MINT,
    amount: BigInt(borrowAmountRaw),
    slippageBps: req.slippageBps ?? 100,
  });
  const swapIxs = await getSwapInstructions({ quote, userPublicKey: req.owner });

  // Scope's refresh_price_list must be preceded only by ComputeBudget ixs, so it sits at index 1.
  const allIxs = [...lead, ...kaminoIxs, ...swapIxs.setup, swapIxs.swap, ...swapIxs.cleanup];

  const lookupTables = await resolveLookupTables(conn, [XSTOCKS_MARKET_LUT, ...swapIxs.lookupTableAddresses]);
  const payer = new PublicKey(req.owner);

  const combined = await compileMessage(conn, payer, allIxs, lookupTables);
  const combinedSize = trySerializedSize(combined);
  if (combinedSize !== null && combinedSize <= 1232) {
    return {
      instructions: allIxs,
      lookupTables,
      quote,
      route: routeLabel(quote),
      transaction: combined,
      reason: `single v0 transaction: deposit + borrow + Jupiter sell fit within the 1232-byte limit (${combinedSize} bytes)`,
      scopeTokens: scopeRefresh.tokens,
    };
  }

  // Split: Kamino leg (deposit+borrow) first, Jupiter leg (sell) second. The
  // Jupiter leg must run after the Kamino leg lands, since it spends the
  // xStock the borrow just minted into the owner's account.
  const kaminoTx = await compileMessage(conn, payer, [...lead, ...kaminoIxs], lookupTables);
  const jupTx = await compileMessage(
    conn,
    payer,
    [lead[0]!, ...swapIxs.setup, swapIxs.swap, ...swapIxs.cleanup],
    lookupTables,
  );
  return {
    instructions: allIxs,
    lookupTables,
    quote,
    route: routeLabel(quote),
    transaction: kaminoTx,
    secondTransaction: jupTx,
    reason:
      "split into 2 transactions: the combined message exceeded the 1232-byte v0 limit. " +
      "tx1 = Kamino deposit+borrow, tx2 (secondTransaction) = Jupiter sell, sent after tx1 lands.",
    scopeTokens: scopeRefresh.tokens,
  };
}

/**
 * Close a short: buy back the xStock with USDC through Jupiter, then repay
 * the borrow and withdraw the USDC collateral. Jupiter leg runs first since
 * the repay instruction needs the xStock the swap just bought.
 */
export async function buildCloseShort(conn: Connection, req: CloseShortRequest): Promise<BuiltShort> {
  const ownerAddr = address(req.owner);
  const market = await loadMarket();
  const usdcReserve = findUsdcReserve(market);
  const xstockReserve = findXstockReserve(market, req.ticker);
  const usdcDecimals = Number(usdcReserve.state.liquidity.mintDecimals.toString());
  const xstockDecimals = Number(xstockReserve.state.liquidity.mintDecimals.toString());

  const repayAmountRaw = toRaw(req.repayAmount, xstockDecimals);
  const withdrawAmountRaw = toRaw(req.withdrawUsdc, usdcDecimals);
  const maxUsdcInRaw = BigInt(toRaw(req.maxUsdcIn, usdcDecimals));

  const scopeRefresh = await buildScopeRefresh(market, await reservesToPrice(market, ownerAddr, [usdcReserve, xstockReserve]));
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: EXTRA_COMPUTE_BUDGET });
  const lead = [computeBudgetIx, ...(scopeRefresh.instruction ? [scopeRefresh.instruction] : [])];

  // Jupiter has no ExactOut route for the xStock mints (NO_ROUTES_FOUND, measured 2026-09-24), so buy
  // ExactIn with a buffer over the oracle value and require the post-slippage minimum out to cover the repay.
  // The surplus (at most buffer + slippage of the repay) stays in the owner's xStock account.
  const slippageBps = req.slippageBps ?? 100;
  const bufferBps = BUYBACK_BUFFER_BPS + slippageBps;
  const oracleUsdcRaw = new Decimal(req.repayAmount).mul(xstockReserve.getOracleMarketPrice()).mul(new Decimal(10).pow(usdcDecimals));
  let usdcIn = BigInt(oracleUsdcRaw.mul(10_000 + bufferBps).div(10_000).ceil().toFixed(0));
  let quote = await getQuote({ inputMint: USDC_MINT, outputMint: xstockReserve.getLiquidityMint().toString(), amount: usdcIn, slippageBps, maxAccounts: CLOSE_MAX_SWAP_ACCOUNTS });
  if (BigInt(quote.otherAmountThreshold) < BigInt(repayAmountRaw)) {
    // Pool price sits above the oracle: scale the input by the observed shortfall and re-quote once.
    usdcIn = (usdcIn * BigInt(repayAmountRaw) * BigInt(10_000 + bufferBps)) / (BigInt(quote.otherAmountThreshold) * 10_000n) + 1n;
    quote = await getQuote({ inputMint: USDC_MINT, outputMint: xstockReserve.getLiquidityMint().toString(), amount: usdcIn, slippageBps, maxAccounts: CLOSE_MAX_SWAP_ACCOUNTS });
  }
  if (BigInt(quote.otherAmountThreshold) < BigInt(repayAmountRaw)) {
    throw new Error(`buy-back quote min out ${quote.otherAmountThreshold} is below the repay amount ${repayAmountRaw}`);
  }
  if (usdcIn > maxUsdcInRaw) {
    throw new Error(`buy-back of ${req.repayAmount} ${req.ticker}x needs ${usdcIn} raw USDC, over maxUsdcIn ${maxUsdcInRaw}`);
  }
  const swapIxs = await getSwapInstructions({ quote, userPublicKey: req.owner });

  const axn = await KaminoAction.buildRepayAndWithdrawTxns({
    kaminoMarket: market,
    repayAmount: repayAmountRaw,
    repayReserveAddress: xstockReserve.address,
    withdrawAmount: withdrawAmountRaw,
    withdrawReserveAddress: usdcReserve.address,
    payer: readOnlySigner(ownerAddr),
    currentLedgerInstant: await ledgerInstant(),
    obligation: vanillaObligationType(market),
    useV2Ixs: V2_IXS,
    scopeRefreshConfig: undefined,
    extraComputeBudget: 0,
    includeAtaIxs: true,
    requestElevationGroup: false,
    initUserMetadata: { skipInitialization: true, skipLutCreation: true },
    referrer: none(),
  });
  const kaminoIxs = KaminoAction.actionToIxs(axn).map(kitIxToWeb3);

  const allIxs = [...lead, ...swapIxs.setup, swapIxs.swap, ...swapIxs.cleanup, ...kaminoIxs];
  const lookupTables = await resolveLookupTables(conn, [XSTOCKS_MARKET_LUT, ...swapIxs.lookupTableAddresses]);
  const payer = new PublicKey(req.owner);

  const combined = await compileMessage(conn, payer, allIxs, lookupTables);
  const closeSize = trySerializedSize(combined);
  const base = { instructions: allIxs, lookupTables, quote, route: routeLabel(quote), scopeTokens: scopeRefresh.tokens };
  if (closeSize !== null && closeSize <= 1232) {
    return {
      ...base,
      transaction: combined,
      reason: `single v0 transaction: Scope refresh + Jupiter buy + repay + withdraw fit within the 1232-byte limit (${closeSize} bytes)`,
    };
  }
  // Split: buy back first, then repay + withdraw once the xStock is in the owner's account.
  const jupTx = await compileMessage(conn, payer, [computeBudgetIx, ...swapIxs.setup, swapIxs.swap, ...swapIxs.cleanup], lookupTables);
  const kaminoTx = await compileMessage(conn, payer, [...lead, ...kaminoIxs], lookupTables);
  return {
    ...base,
    transaction: jupTx,
    secondTransaction: kaminoTx,
    reason:
      "split into 2 transactions: the combined message exceeded the 1232-byte v0 limit. " +
      "tx1 = Jupiter buy-back, tx2 (secondTransaction) = Scope refresh + repay + withdraw, sent after tx1 lands.",
  };
}
