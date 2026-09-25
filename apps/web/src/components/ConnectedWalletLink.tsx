"use client";

import Link from "next/link";
import { shortAddr } from "@/lib/format";
import { useWallet } from "@/components/WalletProvider";

/** Shortcut to read the navbar's connected wallet instead of pasting its address. */
export function ConnectedWalletLink({ path, param }: { path: string; param: string }) {
  const { account } = useWallet();
  if (!account) return null;
  return (
    <Link
      href={`${path}?${param}=${encodeURIComponent(account.address)}`}
      className="press-scale inline-flex whitespace-nowrap text-sm text-[var(--accent)] underline underline-offset-2"
    >
      Use connected wallet {shortAddr(account.address)}
    </Link>
  );
}
