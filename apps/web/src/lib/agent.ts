import Decimal from "decimal.js";
import { PublicKey } from "@solana/web3.js";
import {
  web3Connection,
  buildOpenShort,
  resolveEquityFeed,
  MarketClosedError,
} from "@contra/short";
import { readReserveRows, readMarketOpenState, type ReserveRow } from "@/lib/reserves";
import { readPythFair } from "@/lib/pyth-fair";

export interface AgentStep {
  step: string;
  observed: string;
  decision: string;
  reason: string;
}

export interface AgentResult {
  steps: AgentStep[];
  ticker: string | null;
  marketOpen: boolean;
  transactions: string[] | null;
  route: string | null;
  buildReason: string | null;
}

/** Diagnostic borrow notional in USD. Small on purpose: the agent only needs
 * a quotable size to hand the wallet one real transaction to sign. */
const DIAGNOSTIC_NOTIONAL_USD = 10;
/** Pyth fair-value gate: skip a candidate whose Jupiter sell price deviates
 * from Pyth by 150 bps or more when a Pyth price exists. */
const MAX_GAP_BPS = 150;

function baseTicker(symbol: string): string {
  return /x$/i.test(symbol) ? symbol.slice(0, -1) : symbol;
}

function capacityRaw(r: ReserveRow): bigint {
  const available = BigInt(r.availableRaw);
  const remaining = BigInt(r.borrowLimitRaw) - BigInt(r.totalBorrowedRaw);
  const cap = remaining > 0n ? remaining : 0n;
  return available < cap ? available : cap;
}

function validOwner(owner: string): boolean {
  try {
    new PublicKey(owner);
    return true;
  } catch {
    return false;
  }
}

/** Autonomous short agent: reads Kamino reserves and Pyth fair value live,
 * picks one borrowable ticker, and (when an owner is given and the market is
 * open) builds the unsigned open transaction. Never signs. Every observed
 * value comes from a live read; sizing choices are logged as decisions. */
export async function agentTick(opts: {
  owner?: string;
  usdcCollateralRaw?: string;
} = {}): Promise<AgentResult> {
  const steps: AgentStep[] = [];
  const fail = (
    ticker: string | null,
    marketOpen: boolean,
    step: AgentStep,
  ): AgentResult => ({
    steps: [...steps, step],
    ticker,
    marketOpen,
    transactions: null,
    route: null,
    buildReason: null,
  });

  // 1. Observe: live reserves, same lib code as GET /api/reserves.
  const rows = await readReserveRows();
  const xstocks = rows.filter((r) => r.isXstock);
  const borrowable = xstocks.filter((r) => r.borrowable);
  steps.push({
    step: "reserves",
    observed: `${rows.length} reserves read live from Kamino, ${borrowable.length} borrowable xStocks (${borrowable.map((r) => r.symbol).join(", ") || "none"})`,
    decision: borrowable.length > 0 ? "continue with borrowable set" : "stop, no candidate",
    reason:
      borrowable.length > 0
        ? "borrowable is derived from live borrowLimit and available liquidity, not a static list"
        : xstocks.map((r) => `${r.symbol}: ${r.reason}`).join("; ") || "no xStock reserves in the market",
  });
  if (borrowable.length === 0) {
    return fail(null, false, {
      step: "select",
      observed: "empty candidate set",
      decision: "no ticker chosen",
      reason: "nothing borrowable on Kamino right now",
    });
  }

  // 2. Observe: US market state, same lib code as the ticket.
  const market = await readMarketOpenState();
  steps.push({
    step: "market",
    observed:
      market.error !== null
        ? `market-hours lookup failed: ${market.error}`
        : `US equities ${market.isOpen ? "open" : "closed"} (SPY Pyth feed)`,
    decision: market.isOpen ? "shorts allowed, continue" : "stop, opens refused while closed",
    reason: "Kamino Scope refresh and the /api/open gate both refuse opens while the market is closed",
  });
  if (!market.isOpen) {
    return fail(null, false, {
      step: "select",
      observed: "market closed",
      decision: "no ticker chosen",
      reason: "the agent never picks a short it cannot open",
    });
  }

  // 3. Observe: Pyth fair-value gap per candidate. A missing PYTH_API_KEY is
  // recorded, not fatal: the gap rule only applies when a price exists.
  const gaps = new Map<string, { gapBps: number | null; note: string }>();
  for (const r of borrowable) {
    try {
      const fair = await readPythFair(r.symbol);
      gaps.set(r.symbol, {
        gapBps: fair.gapBps,
        note:
          fair.gapBps !== null
            ? `gap ${fair.gapBps.toFixed(1)} bps (Jupiter ${fair.jupiterSellPrice?.toFixed(4)} vs Pyth ${fair.pythPrice?.toFixed(4)})`
            : (fair.reason ?? "no Pyth price"),
      });
    } catch (err) {
      gaps.set(r.symbol, {
        gapBps: null,
        note: `Pyth read failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  const overGap = borrowable.filter((r) => {
    const g = gaps.get(r.symbol)?.gapBps;
    return g !== null && g !== undefined && Math.abs(g) >= MAX_GAP_BPS;
  });
  steps.push({
    step: "pyth",
    observed: borrowable.map((r) => `${r.symbol}: ${gaps.get(r.symbol)?.note}`).join("; "),
    decision:
      overGap.length > 0
        ? `exclude ${overGap.map((r) => r.symbol).join(", ")} (gap at or over ${MAX_GAP_BPS} bps)`
        : "no candidate excluded on price",
    reason: "a wide Jupiter vs Pyth gap means the short would sell into a mispriced quote",
  });

  // 4. Decide: largest available borrow capacity among survivors.
  const survivors = borrowable
    .filter((r) => !overGap.includes(r))
    .map((r) => ({ row: r, capacity: capacityRaw(r) }))
    .filter((c) => c.capacity > 0n)
    .sort((a, b) => (b.capacity < a.capacity ? -1 : b.capacity > a.capacity ? 1 : 0));
  const picked = survivors[0];
  steps.push({
    step: "select",
    observed: survivors.map((c) => `${c.row.symbol} capacity ${c.capacity.toString()} raw`).join("; ") || "no survivor with capacity",
    decision: picked ? `pick ${picked.row.symbol}` : "no ticker chosen",
    reason: picked
      ? `largest live borrow capacity with a Pyth gap under ${MAX_GAP_BPS} bps when a price exists`
      : "every borrowable reserve failed the gap or capacity check",
  });
  if (!picked) {
    return fail(null, true, {
      step: "build",
      observed: "no candidate",
      decision: "no transaction built",
      reason: "nothing passed selection",
    });
  }

  // 5. Act: build the unsigned open transaction via the same lib code as
  // POST /api/open. Needs an owner, an open per-ticker session, and a live
  // oracle price to size the borrow.
  const owner = opts.owner?.trim() ?? "";
  if (owner === "") {
    return {
      steps: [
        ...steps,
        {
          step: "build",
          observed: `candidate ${picked.row.symbol}, no owner supplied`,
          decision: "no transaction built",
          reason: "pass ?owner=<address> and the agent hands back one transaction to sign",
        },
      ],
      ticker: picked.row.symbol,
      marketOpen: true,
      transactions: null,
      route: null,
      buildReason: null,
    };
  }
  if (!validOwner(owner)) {
    return fail(picked.row.symbol, true, {
      step: "build",
      observed: `"${owner}" is not a valid Solana address`,
      decision: "no transaction built",
      reason: "the owner becomes the transaction payer, so it must parse",
    });
  }
  try {
    const feed = await resolveEquityFeed(baseTicker(picked.row.symbol));
    if (!feed.isOpen) throw new MarketClosedError(baseTicker(picked.row.symbol), feed.nextOpenUnix);
  } catch (err) {
    return fail(picked.row.symbol, true, {
      step: "build",
      observed: err instanceof MarketClosedError ? err.message : `feed check failed: ${err instanceof Error ? err.message : String(err)}`,
      decision: "no transaction built",
      reason: "same per-ticker market-hours gate as POST /api/open",
    });
  }

  const usdc = rows.find((r) => r.symbol === "USDC");
  const price = picked.row.oracleValid && picked.row.priceUsd !== null ? picked.row.priceUsd : null;
  const borrowFactor = picked.row.pairBorrowFactor ?? picked.row.borrowFactor;
  const maxLtv = picked.row.pairMaxLtv ?? picked.row.maxLtv;
  if (!usdc || price === null || price <= 0 || borrowFactor === null || borrowFactor <= 0 || maxLtv <= 0) {
    return fail(picked.row.symbol, true, {
      step: "build",
      observed: `USDC reserve ${usdc ? "present" : "missing"}, oracle price ${price ?? "missing"}, borrow factor ${borrowFactor ?? "missing"}, max LTV ${maxLtv}`,
      decision: "no transaction built",
      reason: "sizing needs live price, borrow factor and LTV; refusing to guess any of them",
    });
  }

  const xDec = picked.row.decimals;
  const capacity = capacityRaw(picked.row);
  const diagBorrowRaw =
    BigInt(new Decimal(DIAGNOSTIC_NOTIONAL_USD).div(price).mul(new Decimal(10).pow(xDec)).floor().toFixed(0));
  let borrowRaw = diagBorrowRaw < capacity ? diagBorrowRaw : capacity;
  let collateralRaw: bigint;
  if (opts.usdcCollateralRaw !== undefined && opts.usdcCollateralRaw !== "") {
    try {
      collateralRaw = BigInt(opts.usdcCollateralRaw);
    } catch {
      return fail(picked.row.symbol, true, {
        step: "build",
        observed: `usdcCollateralRaw "${opts.usdcCollateralRaw}" is not an integer`,
        decision: "no transaction built",
        reason: "collateral must be raw USDC base units",
      });
    }
    const collateralUsdc = new Decimal(collateralRaw.toString()).div(new Decimal(10).pow(usdc.decimals));
    const sized = new Decimal(collateralUsdc.toString())
      .mul(maxLtv / 100)
      .div(borrowFactor)
      .div(2)
      .div(price)
      .mul(new Decimal(10).pow(xDec))
      .floor();
    const fromCollateral = BigInt(sized.toFixed(0));
    if (fromCollateral > 0n && fromCollateral < borrowRaw) borrowRaw = fromCollateral;
  } else {
    const borrowUi = new Decimal(borrowRaw.toString()).div(new Decimal(10).pow(xDec));
    collateralRaw = BigInt(
      borrowUi.mul(price).mul(borrowFactor).div(maxLtv / 100).mul(new Decimal(10).pow(usdc.decimals)).ceil().toFixed(0),
    );
  }
  if (borrowRaw <= 0n || collateralRaw <= 0n) {
    return fail(picked.row.symbol, true, {
      step: "build",
      observed: `sized borrow ${borrowRaw.toString()} raw, collateral ${collateralRaw.toString()} raw`,
      decision: "no transaction built",
      reason: "live capacity is too small for a whole base unit at the diagnostic size",
    });
  }

  const borrowUi = new Decimal(borrowRaw.toString()).div(new Decimal(10).pow(xDec)).toNumber();
  const collateralUi = new Decimal(collateralRaw.toString()).div(new Decimal(10).pow(usdc.decimals)).toNumber();
  let built;
  try {
    built = await buildOpenShort(web3Connection(), {
      owner,
      ticker: baseTicker(picked.row.symbol),
      usdcCollateral: collateralUi,
      borrowAmount: borrowUi,
    });
  } catch (err) {
    return fail(picked.row.symbol, true, {
      step: "build",
      observed: `build failed: ${err instanceof Error ? err.message : String(err)}`,
      decision: "no transaction built",
      reason: "the builder or the Jupiter quote refused the sized request; nothing was signed",
    });
  }
  const transactions = [Buffer.from(built.transaction.serialize()).toString("base64")];
  if (built.secondTransaction) {
    transactions.push(Buffer.from(built.secondTransaction.serialize()).toString("base64"));
  }
  return {
    steps: [
      ...steps,
      {
        step: "build",
        observed: `borrow ${borrowRaw.toString()} raw ${picked.row.symbol} against ${collateralRaw.toString()} raw USDC at live price ${price}`,
        decision: `built ${transactions.length} unsigned transaction${transactions.length > 1 ? "s" : ""} via ${built.route}`,
        reason: built.reason,
      },
    ],
    ticker: picked.row.symbol,
    marketOpen: true,
    transactions,
    route: built.route,
    buildReason: built.reason,
  };
}
