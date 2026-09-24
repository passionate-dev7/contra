import Decimal from "decimal.js";
import { address } from "@solana/kit";
import { KaminoMarket, DEFAULT_RECENT_SLOT_DURATION_MS } from "@kamino-finance/klend-sdk";
import { kitRpc } from "./rpc.js";
import { XSTOCKS_MARKET, USDC_MINT } from "./constants.js";

export interface ReserveFacts {
  symbol: string;
  mint: string;
  decimals: number;
  maxLtvPct: number;
  liquidationThresholdPct: number;
  borrowFactorPct: number;
  availableLiquidity: string;
  totalBorrowed: string;
  borrowLimit: string;
  remainingBorrowCap: string;
}

/**
 * Live SDK read of every reserve in the xStocks Market: whether USDC is
 * usable as collateral (maxLtvPct > 0), and per-xStock borrow limit,
 * borrow factor, liquidation LTV and currently available liquidity to
 * borrow. This is the ground truth for requirement 1: it reads the
 * deployed reserve config directly, not the aggregator API.
 */
export async function readReserveFacts(marketAddress = XSTOCKS_MARKET): Promise<ReserveFacts[]> {
  const rpc = kitRpc();
  const market = await KaminoMarket.load(rpc, address(marketAddress), DEFAULT_RECENT_SLOT_DURATION_MS);
  if (market === null) {
    throw new Error(`Kamino market ${marketAddress} not found`);
  }
  const out: ReserveFacts[] = [];
  for (const reserve of market.getReserves()) {
    const cfg = reserve.state.config;
    const decimals = Number(reserve.state.liquidity.mintDecimals.toString());
    const scale = new Decimal(10).pow(decimals);
    const availableUi = reserve.getLiquidityAvailableAmount().div(scale);
    const borrowedUi = reserve.getBorrowedAmount().div(scale);
    const borrowLimitUi = new Decimal(cfg.borrowLimit.toString()).div(scale);
    out.push({
      symbol: reserve.getTokenSymbol(),
      mint: reserve.getLiquidityMint().toString(),
      decimals,
      maxLtvPct: cfg.loanToValuePct,
      liquidationThresholdPct: cfg.liquidationThresholdPct,
      borrowFactorPct: cfg.borrowFactorPct,
      availableLiquidity: availableUi.toFixed(4),
      totalBorrowed: borrowedUi.toFixed(4),
      borrowLimit: borrowLimitUi.toFixed(4),
      remainingBorrowCap: borrowLimitUi.sub(borrowedUi).toFixed(4),
    });
  }
  return out;
}

function printTable(rows: ReserveFacts[]): void {
  const header = [
    "symbol",
    "mint",
    "maxLtv%",
    "liqLtv%",
    "borrowFactor%",
    "available",
    "borrowed",
    "borrowLimit",
    "remainingCap",
  ];
  const widths = header.map((h) => h.length);
  const cells = rows.map((r) => [
    r.symbol,
    `${r.mint.slice(0, 4)}..${r.mint.slice(-4)}`,
    String(r.maxLtvPct),
    String(r.liquidationThresholdPct),
    String(r.borrowFactorPct),
    r.availableLiquidity,
    r.totalBorrowed,
    r.borrowLimit,
    r.remainingBorrowCap,
  ]);
  for (const row of cells) {
    row.forEach((c, i) => {
      widths[i] = Math.max(widths[i]!, c.length);
    });
  }
  const line = (cols: string[]): string => cols.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  console.log(line(header));
  console.log(line(widths.map((w) => "-".repeat(w))));
  for (const row of cells) {
    console.log(line(row));
  }
}

async function main(): Promise<void> {
  const facts = await readReserveFacts();
  const usdc = facts.find((f) => f.mint === USDC_MINT);
  console.log(`Market ${XSTOCKS_MARKET} — ${facts.length} reserves\n`);
  printTable(facts);
  console.log();
  if (usdc === undefined) {
    console.log("USDC is NOT a reserve in this market: it cannot be used as collateral here.");
  } else if (usdc.maxLtvPct === 0) {
    console.log(
      `USDC reserve exists (maxLtv 0) — it is NOT usable as collateral in this market (deposit-only or borrow-only asset).`,
    );
  } else {
    console.log(
      `USDC IS usable as collateral: maxLtv ${usdc.maxLtvPct}%, liquidation LTV ${usdc.liquidationThresholdPct}%, borrowFactor ${usdc.borrowFactorPct}%.`,
    );
  }
  const xstocks = facts.filter((f) => /x$/.test(f.symbol));
  console.log(`\nxStock reserves — borrowable requires BOTH available liquidity and a positive borrow-cap headroom:`);
  for (const x of xstocks) {
    const hasLiquidity = Number(x.availableLiquidity) > 0;
    const hasCapRoom = Number(x.remainingBorrowCap) > 0;
    const borrowable = hasLiquidity && hasCapRoom;
    const reason = borrowable
      ? "BORROWABLE"
      : !hasCapRoom
        ? "blocked: borrowLimit cap is 0 or exhausted (protocol has borrowing disabled for this reserve)"
        : "blocked: no available liquidity";
    console.log(`  ${x.symbol}: ${reason} — available ${x.availableLiquidity}, remaining cap ${x.remainingBorrowCap}`);
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
