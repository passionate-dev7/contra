"use client";

import { useState } from "react";
import { ArrowSquareOut, CircleNotch, WarningCircle } from "@phosphor-icons/react";
import { shortAddr, uiToRaw } from "@/lib/format";
import { signAndSendAll } from "@/lib/wallet";
import { useWallet } from "@/components/WalletProvider";
import type { PositionLine } from "@/lib/obligation";

type Status = "idle" | "building" | "sending" | "done" | "error";

export function CloseButton({ owner, borrow, deposit }: { owner: string; borrow: PositionLine; deposit: PositionLine }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [signatures, setSignatures] = useState<string[]>([]);
  const { wallet, account } = useWallet();
  const ownerMismatch = account !== null && account.address !== owner;

  async function handleClose() {
    if (!wallet || !account || ownerMismatch) return;
    setError(null);
    setStatus("building");
    try {
      const repayRaw = uiToRaw(borrow.amount * 1.001, borrow.decimals);
      const withdrawRaw = uiToRaw(deposit.amount, deposit.decimals);
      const maxUsdcInRaw = uiToRaw(borrow.marketValueUsd * 1.05, 6);
      const res = await fetch("/api/close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner, ticker: borrow.symbol, repayRaw, withdrawRaw, maxUsdcInRaw }),
      });
      const body = (await res.json()) as { transactions?: string[]; error?: string };
      if (!res.ok || !body.transactions) throw new Error(body.error ?? `close build failed: ${res.status}`);

      setStatus("sending");
      const sigs = await signAndSendAll(wallet, account, body.transactions);
      setSignatures(sigs);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  const busy = status === "building" || status === "sending";

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClose}
        disabled={busy || status === "done" || !account || ownerMismatch}
        className="press-scale flex items-center justify-center gap-2 rounded-[var(--radius-ticket)] bg-[var(--accent)] px-4 py-2.5 font-medium text-[var(--accent-ink)] disabled:opacity-40"
      >
        {busy && <CircleNotch size={16} className="animate-spin motion-reduce:animate-none" weight="bold" />}
        {status === "done" ? "Closed" : busy ? "Closing…" : "Close position"}
      </button>
      {!account && <p className="text-sm text-[var(--ink-dim)]">Connect the owner wallet from the top bar to close.</p>}
      {ownerMismatch && (
        <p className="text-sm text-[var(--negative)]">
          Connected wallet {shortAddr(account.address)} does not match this position&apos;s owner {shortAddr(owner)}.
        </p>
      )}
      {status === "error" && error && (
        <p className="flex items-start gap-1.5 text-sm text-[var(--negative)]">
          <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
      {status === "done" && (
        <ul className="space-y-1 font-[family-name:var(--font-mono)] text-sm">
          {signatures.map((sig) => (
            <li key={sig}>
              <a href={`https://solscan.io/tx/${sig}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--accent)] underline">
                {shortAddr(sig, 6, 6)}
                <ArrowSquareOut size={12} weight="bold" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
