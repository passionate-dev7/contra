"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function OwnerForm({ initial }: { initial?: string }) {
  const [value, setValue] = useState(initial ?? "");
  const router = useRouter();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) router.push(`/positions?owner=${encodeURIComponent(value.trim())}`);
      }}
      className="flex flex-col gap-2 sm:flex-row"
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Wallet address"
        className="flex-1 rounded-[var(--radius-ticket)] border border-[var(--rule-strong)] bg-[var(--paper-raised)] px-3 py-2 font-[family-name:var(--font-mono)] text-sm"
      />
      <button type="submit" className="press-scale rounded-[var(--radius-ticket)] bg-[var(--accent)] px-4 py-2 font-medium text-[var(--accent-ink)]">
        View position
      </button>
    </form>
  );
}
