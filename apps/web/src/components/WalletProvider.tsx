"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { listSolanaWallets, connectWallet } from "@/lib/wallet";

type WalletState = {
  wallets: Wallet[];
  wallet: Wallet | null;
  account: WalletAccount | null;
  connecting: boolean;
  error: string | null;
  connect: (wallet: Wallet) => Promise<void>;
  disconnect: () => Promise<void>;
};

const WalletContext = createContext<WalletState | null>(null);
const LAST_WALLET_KEY = "contra:wallet";

type ConnectFeature = { connect: (input?: { silent?: boolean }) => Promise<{ accounts: readonly WalletAccount[] }> };
type EventsFeature = { on: (event: "change", cb: (props: { accounts?: readonly WalletAccount[] }) => void) => () => void };
type DisconnectFeature = { disconnect: () => Promise<void> };

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => setWallets(listSolanaWallets());
    refresh();
    const api = getWallets();
    const offRegister = api.on("register", refresh);
    const offUnregister = api.on("unregister", refresh);
    return () => {
      offRegister();
      offUnregister();
    };
  }, []);

  // A full page load (the /hedge GET form) drops React state; reconnect without a prompt
  // if the wallet already trusts this site. A wallet that does not, returns no account.
  useEffect(() => {
    if (wallet !== null) return;
    const last = localStorage.getItem(LAST_WALLET_KEY);
    const w = last ? wallets.find((x) => x.name === last) : undefined;
    if (!w) return;
    const feature = w.features["standard:connect"] as ConnectFeature;
    feature
      .connect({ silent: true })
      .then(({ accounts }) => {
        if (accounts[0]) {
          setWallet(w);
          setAccount(accounts[0]);
        }
      })
      .catch(() => localStorage.removeItem(LAST_WALLET_KEY));
  }, [wallets, wallet]);

  useEffect(() => {
    const events = wallet?.features["standard:events"] as EventsFeature | undefined;
    if (!events) return;
    return events.on("change", ({ accounts }) => {
      if (accounts === undefined) return;
      setAccount(accounts[0] ?? null);
      if (accounts[0] === undefined) setWallet(null);
    });
  }, [wallet]);

  const connect = useCallback(async (w: Wallet) => {
    setError(null);
    setConnecting(true);
    try {
      const acc = await connectWallet(w);
      setWallet(w);
      setAccount(acc);
      localStorage.setItem(LAST_WALLET_KEY, w.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    const feature = wallet?.features["standard:disconnect"] as DisconnectFeature | undefined;
    localStorage.removeItem(LAST_WALLET_KEY);
    setWallet(null);
    setAccount(null);
    setError(null);
    await feature?.disconnect().catch(() => undefined);
  }, [wallet]);

  return (
    <WalletContext.Provider value={{ wallets, wallet, account, connecting, error, connect, disconnect }}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (ctx === null) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
