"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CaretDown, SignOut, Wallet as WalletIcon, WarningCircle } from "@phosphor-icons/react";
import { shortAddr } from "@/lib/format";
import { useWallet } from "@/components/WalletProvider";

const LINKS = [
  { href: "/", label: "Ticket" },
  { href: "/hedge", label: "Hedge" },
  { href: "/positions", label: "Positions" },
  { href: "/pitch", label: "Pitch" },
];

export function SiteNav() {
  const pathname = usePathname();
  // The deck is a full-bleed presentation with its own DeckNav.
  if (pathname.startsWith("/pitch")) return null;

  return (
    <div className="border-b border-[var(--rule-strong)] bg-[var(--paper)]">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
        <Link href="/" className="font-[family-name:var(--font-display)] text-lg font-semibold">
          Contra
        </Link>
        <nav aria-label="Main" className="order-3 flex w-full gap-5 text-sm sm:order-2 sm:w-auto">
          {LINKS.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`press-scale whitespace-nowrap underline-offset-4 ${active ? "text-[var(--ink)] underline" : "text-[var(--ink-dim)] hover:text-[var(--accent)]"}`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="order-2 ml-auto sm:order-3">
          <WalletButton />
        </div>
      </div>
    </div>
  );
}

function WalletButton() {
  const { wallets, account, wallet, connecting, error, connect, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (account) setOpen(false);
  }, [account]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const btn =
    "press-scale flex items-center gap-2 whitespace-nowrap rounded-[var(--radius-ticket)] border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div ref={rootRef} className="relative">
      {account ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          className={`${btn} border-[var(--rule-strong)] bg-[var(--paper-raised)] font-[family-name:var(--font-mono)]`}
        >
          {wallet?.icon && <img src={wallet.icon} alt="" width={16} height={16} className="h-4 w-4" />}
          {shortAddr(account.address)}
          <CaretDown size={12} weight="bold" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          className={`${btn} border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]`}
        >
          <WalletIcon size={16} weight="bold" aria-hidden="true" />
          {connecting ? "Connecting…" : "Connect wallet"}
        </button>
      )}

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-64 max-w-[calc(100vw-3rem)] rounded-[var(--radius-ticket)] border border-[var(--rule-strong)] bg-[var(--paper-raised)] p-1 text-sm"
        >
          {account ? (
            <>
              <p className="px-3 py-2 text-xs text-[var(--ink-dim)]">
                {wallet?.name} <span className="font-[family-name:var(--font-mono)] break-all text-[var(--ink)]">{account.address}</span>
              </p>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  void disconnect();
                }}
                className="flex w-full items-center gap-2 rounded-[var(--radius-ticket)] px-3 py-2 text-left hover:bg-[var(--paper)]"
              >
                <SignOut size={16} aria-hidden="true" />
                Disconnect
              </button>
            </>
          ) : wallets.length === 0 ? (
            <p className="px-3 py-2 text-[var(--ink-dim)]">No Solana wallet found. Install a Wallet Standard wallet (Phantom, Backpack, Solflare).</p>
          ) : (
            wallets.map((w) => (
              <button
                key={w.name}
                type="button"
                role="menuitem"
                disabled={connecting}
                onClick={() => void connect(w)}
                className="flex w-full items-center gap-2 rounded-[var(--radius-ticket)] px-3 py-2 text-left hover:bg-[var(--paper)] disabled:opacity-40"
              >
                <img src={w.icon} alt="" width={20} height={20} className="h-5 w-5" />
                {w.name}
              </button>
            ))
          )}
          {error && !account && (
            <p role="alert" className="flex items-start gap-1.5 px-3 py-2 text-xs text-[var(--negative)]">
              <WarningCircle size={14} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
