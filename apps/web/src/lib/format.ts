export function fmtUsd(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtPct(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "-";
  return `${n.toFixed(digits)}%`;
}

export function fmtNum(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

export function shortAddr(addr: string, head = 4, tail = 4): string {
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function rawToUi(raw: string, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

export function uiToRaw(ui: number, decimals: number): string {
  return Math.round(ui * 10 ** decimals).toString();
}
