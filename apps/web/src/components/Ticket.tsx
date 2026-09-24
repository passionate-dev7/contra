"use client";

import { useMemo, useState } from "react";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { ArrowSquareOut, CircleNotch, Wallet as WalletIcon, WarningCircle } from "@phosphor-icons/react";
import { fmtPct, fmtUsd, fmtNum, shortAddr, uiToRaw } from "@/lib/format";
import { computeTicketMath } from "@/lib/ticket-math";
import { listSolanaWallets, connectWallet, signAndSendAll } from "@/lib/wallet";
import type { PublicReserveRow } from "@/lib/types";

type Status = "idle" | "connecting" | "building" | "awaiting-signature" | "sending" | "done" | "error";

export function Ticket({ rows, marketOpen, pythKeyPresent }: { rows: PublicReserveRow[]; marketOpen: boolean; pythKeyPresent: boolean }) {
  const xstocks = useMemo(() => rows.filter((r) => r.isXstock), [rows]);
  const firstBorrowable = xstocks.find((r) => r.borrowable);

  const [ticker, setTicker] = useState(firstBorrowable?.symbol ?? xstocks[0]?.symbol ?? "");
  const [sizeUsd, setSizeUsd] = useState("100");
  const [collateralUsdc, setCollateralUsdc] = useState("220");

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [signatures, setSignatures] = useState<string[]>([]);

  const selected = xstocks.find((r) => r.symbol === ticker);
  const usdcRow = rows.find((r) => r.symbol === "USDC");

  const math =
    selected && selected.priceUsd !== null && selected.pairBorrowFactor !== null
      ? computeTicketMath({
          sizeUsd: Number(sizeUsd) || 0,
          collateralUsdc: Number(collateralUsdc) || 0,
          priceUsd: selected.priceUsd,
          pairMaxLtv: selected.maxLtv,
          pairLiqLtv: selected.liqLtv,
          pairBorrowFactor: selected.pairBorrowFactor,
        })
      : null;

  const canOpen =
    selected !== undefined &&
    selected.borrowable &&
    marketOpen &&
    selected.oracleValid &&
    math !== null &&
    !math.overMaxLtv &&
    Number(sizeUsd) > 0 &&
    Number(collateralUsdc) > 0;

  async function handleConnect() {
    setError(null);
    setStatus("connecting");
    try {
      const wallets = listSolanaWallets();
      const first = wallets[0];
      if (first === undefined) {
        throw new Error("No Solana wallet found. Install a Wallet Standard wallet (Phantom, Backpack, Solflare).");
      }
      const acc = await connectWallet(first);
      setWallet(first);
      setAccount(acc);
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  async function handleOpen() {
    if (!selected || !math || !account || !wallet || !usdcRow) return;
    setError(null);
    setSignatures([]);
    setStatus("building");
    try {
      const res = await fetch("/api/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          owner: account.address,
          ticker: selected.symbol,
          usdcCollateral: uiToRaw(Number(collateralUsdc), usdcRow.decimals),
          borrowRaw: uiToRaw(math.xstockAmount, selected.decimals),
        }),
      });
      const body = (await res.json()) as { transactions?: string[]; error?: string };
      if (!res.ok || !body.transactions) {
        throw new Error(body.error ?? `open build failed: ${res.status}`);
      }
      setStatus("awaiting-signature");
      setStatus("sending");
      const sigs = await signAndSendAll(wallet, account, body.transactions);
      setSignatures(sigs);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  const busy = status === "building" || status === "awaiting-signature" || status === "sending";

  return (
    <aside className="enter-scale border border-[var(--rule-strong)] bg-[var(--paper-raised)] rounded-[var(--radius-ticket)] p-5 lg:sticky lg:top-6 lg:self-start">
      <h2 className="font-[family-name:var(--font-display)] text-lg">Open short</h2>
      <p className="mt-1 text-sm text-[var(--ink-dim)]">Deposit USDC, borrow the xStock, sell it through Jupiter. One ticket, one transaction.</p>

      <div className="mt-4 space-y-4">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-[var(--ink-dim)]">Ticker</span>
          <select
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            className="mt-1 w-full rounded-[var(--radius-ticket)] border border-[var(--rule-strong)] bg-[var(--paper)] px-3 py-2 font-[family-name:var(--font-mono)] text-sm"
          >
            {xstocks.length === 0 && <option value="">No xStock reserves</option>}
            {xstocks.map((r) => (
              <option key={r.symbol} value={r.symbol} disabled={!r.borrowable}>
                {r.symbol}
                {r.borrowable ? "" : ` - ${r.reason}`}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs uppercase tracking-wide text-[var(--ink-dim)]">Size (USD notional)</span>
          <input
            inputMode="decimal"
            value={sizeUsd}
            onChange={(e) => setSizeUsd(e.target.value)}
            className="mt-1 w-full rounded-[var(--radius-ticket)] border border-[var(--rule-strong)] bg-[var(--paper)] px-3 py-2 font-[family-name:var(--font-mono)] text-sm tabular"
          />
        </label>

        <label className="block">
          <span className="text-xs uppercase tracking-wide text-[var(--ink-dim)]">Collateral (USDC)</span>
          <input
            inputMode="decimal"
            value={collateralUsdc}
            onChange={(e) => setCollateralUsdc(e.target.value)}
            className="mt-1 w-full rounded-[var(--radius-ticket)] border border-[var(--rule-strong)] bg-[var(--paper)] px-3 py-2 font-[family-name:var(--font-mono)] text-sm tabular"
          />
        </label>

        <dl className="grid grid-cols-2 gap-y-1.5 border-y border-[var(--rule)] py-3 text-sm font-[family-name:var(--font-mono)] tabular">
          <dt className="text-[var(--ink-dim)]">Live LTV</dt>
          <dd className={`text-right ${math?.overMaxLtv ? "text-[var(--negative)]" : ""}`}>{math ? fmtPct(math.initialLtvPct) : "-"}</dd>
          <dt className="text-[var(--ink-dim)]">Max LTV</dt>
          <dd className="text-right">{selected ? fmtPct(selected.maxLtv, 0) : "-"}</dd>
          <dt className="text-[var(--ink-dim)]">Liquidation price</dt>
          <dd className="text-right">{math && math.liquidationPriceUsd > 0 ? fmtUsd(math.liquidationPriceUsd) : "-"}</dd>
          <dt className="text-[var(--ink-dim)]">Borrow APY</dt>
          <dd className="text-right">{selected ? fmtPct(selected.borrowApy * 100) : "-"}</dd>
        </dl>

        {selected && !selected.oracleValid && (
          <p className="flex items-start gap-1.5 text-sm text-[var(--negative)]">
            <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0" />
            {selected.symbol}&apos;s Kamino oracle is stale right now, so a live price cannot be shown.
          </p>
        )}
        {!marketOpen && (
          <p className="flex items-start gap-1.5 text-sm text-[var(--negative)]">
            <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0" />
            US market closed. Kamino&apos;s equity oracle only refreshes during market hours, so opens are only possible while it&apos;s open.
          </p>
        )}
        {!pythKeyPresent && (
          <p className="text-xs text-[var(--ink-dim)]">Live prices shown here come from Kamino&apos;s own oracle. A fresher Pyth cross-check needs PYTH_API_KEY in .env.</p>
        )}
        {math?.overMaxLtv && <p className="text-sm text-[var(--negative)]">This size exceeds the {selected?.symbol} pair&apos;s max LTV. Reduce size or add collateral.</p>}

        {account ? (
          <button
            type="button"
            onClick={handleOpen}
            disabled={!canOpen || busy}
            className="press-scale flex w-full items-center justify-center gap-2 rounded-[var(--radius-ticket)] bg-[var(--accent)] px-4 py-2.5 font-medium text-[var(--accent-ink)] disabled:opacity-40"
          >
            {busy && <CircleNotch size={16} className="animate-spin" weight="bold" />}
            {status === "building" && "Building transaction…"}
            {status === "awaiting-signature" && "Waiting for wallet…"}
            {status === "sending" && "Sending…"}
            {!busy && "Open short"}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleConnect}
            disabled={status === "connecting"}
            className="press-scale flex w-full items-center justify-center gap-2 rounded-[var(--radius-ticket)] border border-[var(--rule-strong)] px-4 py-2.5 font-medium disabled:opacity-40"
          >
            <WalletIcon size={16} weight="bold" />
            {status === "connecting" ? "Connecting…" : "Connect wallet"}
          </button>
        )}

        {account && <p className="text-center text-xs text-[var(--ink-dim)]">Connected as {shortAddr(account.address)}</p>}

        {status === "error" && error && (
          <p className="flex items-start gap-1.5 text-sm text-[var(--negative)]">
            <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}

        {status === "done" && signatures.length > 0 && (
          <div className="rounded-[var(--radius-ticket)] border border-[var(--positive)] bg-[var(--positive)]/5 p-3 text-sm">
            <p className="font-medium text-[var(--positive)]">Short opened.</p>
            <ul className="mt-1.5 space-y-1 font-[family-name:var(--font-mono)]">
              {signatures.map((sig) => (
                <li key={sig}>
                  <a href={`https://solscan.io/tx/${sig}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--accent)] underline">
                    {shortAddr(sig, 6, 6)}
                    <ArrowSquareOut size={12} weight="bold" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {math && (
          <p className="text-center text-xs text-[var(--ink-dim)]">
            ≈ {fmtNum(math.xstockAmount, 6)} {selected?.symbol} borrowed and sold
          </p>
        )}
      </div>
    </aside>
  );
}
