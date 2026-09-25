import Image from "next/image";

export const CAPTURED = "2026-09-25";

/** A captured third-party page, pinned with its letter, source and capture date. */
export function Exhibit({
  letter,
  src,
  width,
  height,
  alt,
  href,
  label,
  note,
  sizes = "(min-width: 1024px) 60vw, 100vw",
}: {
  letter: string;
  src: string;
  width: number;
  height: number;
  alt: string;
  href: string;
  label: string;
  note?: React.ReactNode;
  sizes?: string;
}) {
  return (
    <figure className="min-w-0 self-start border border-[var(--rule-strong)] bg-[var(--paper-raised)]">
      <div className="flex items-baseline justify-between gap-3 border-b border-[var(--rule)] px-3 py-1.5 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.1em]">
        <span className="text-[var(--accent)]">Exhibit {letter}</span>
        <span className="tabular text-[var(--ink-dim)]">Captured {CAPTURED}</span>
      </div>
      <Image src={src} width={width} height={height} alt={alt} sizes={sizes} className="block h-auto w-full" />
      <figcaption className="border-t border-[var(--rule)] px-3 py-2 text-xs text-[var(--ink-dim)]">
        {note ? <p className="mb-1 text-sm text-[var(--ink)]">{note}</p> : null}
        <a href={href} className="break-all font-[family-name:var(--font-mono)] text-[var(--accent)] underline underline-offset-2">
          {label}
        </a>
      </figcaption>
    </figure>
  );
}

type Tweet = {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  date: string;
  text: string;
  likes: number;
  reposts: number;
  image?: { src: string; width: number; height: number; alt: string };
};

// Text is tweet.text exactly as returned by https://api.fxtwitter.com/<handle>/status/<id>, read 2026-09-25.
// Counts are as of that read.
export const LEAD_TWEET: Tweet = {
  id: "2047693104682299699",
  name: "Kamino",
  handle: "kamino",
  avatar: "/evidence/x/kamino.webp",
  date: "24 Apr 2026",
  text: "USDC can now be used as collateral in the xStocks Market.\n\nYou can deposit USDC, borrow tokenized equities, and take a directional position against SPYx, TSLAx, QQQx, or NVDAx, all onchain.\n\nAccess 24/7 capital markets on Kamino.",
  likes: 117,
  reposts: 14,
  image: {
    src: "/evidence/x/kamino-2047693104682299699.webp",
    width: 960,
    height: 540,
    alt: "Kamino announcement card: USDC Collateral is now live in the xStocks Market. Short SPYx, TSLAx, QQQx, and NVDAx.",
  },
};

export const TWEETS: Tweet[] = [
  {
    id: "1940487019450585298",
    name: "Loopscale",
    handle: "Loopscale",
    avatar: "/evidence/x/loopscale.webp",
    date: "2 Jul 2025",
    text: "Borrow against NVDAx at 2% interest.\n\nOr go short CRCLx, with leverage.\n\nOr provide liquidity to the CRCLx-USDC pair on @orca_so - and borrow stables or more CRCLx off of it.\n\nNow possible with Loopscale.",
    likes: 23,
    reposts: 2,
  },
  {
    id: "1939790164769087690",
    name: "Jupiter",
    handle: "JupiterExchange",
    avatar: "/evidence/x/jupiterexchange.webp",
    date: "30 Jun 2025",
    text: "Buy TSLA on Jupiter\n\nLike how you would buy SOL\nLike how you would buy JUP\nLike how you would buy FART\n\nJust use Jupiter",
    likes: 1480,
    reposts: 226,
  },
  {
    id: "1945183668361945230",
    name: "Wasabi Protocol 🟢",
    handle: "wasabi_protocol",
    avatar: "/evidence/x/wasabi_protocol.webp",
    date: "15 Jul 2025",
    text: "Wasabi x @xStocksFi\n\nLeverage trading on tokenized stocks is now live, fully onchain.\n\nWasabi integrated xStocks to launch the first leveraged trading venue for tokenized equities, such as TSLAx, SPYx, and NVDAx.\n\nAll trades settle onchain. All value stays on @solana.\n\n(Not intended for US/UK users).",
    likes: 63,
    reposts: 10,
  },
  {
    id: "2074262512279998973",
    name: "Jupiter Earn",
    handle: "jupiter_earn",
    avatar: "/evidence/x/jupiter_earn.webp",
    date: "6 Jul 2026",
    text: "Tokenized stock volume is hitting record highs on Solana.\n\nBut you don't need to sell your xStocks to access liquidity.\n\nBorrow against your SPYx on Jupiter Lend for:\n\n✅ The lowest borrow rate for stables on the platform \n✅ A 2% Rewards APY on top of xPoints\n✅ LTVs up to 75% + an 85% liquidation threshold\n\nStack multiple rewards with the best terms on your xStocks, when you Just Use Jupiter Lend.",
    likes: 140,
    reposts: 13,
  },
  {
    id: "2097323135452475859",
    name: "kash",
    handle: "kashdhanda",
    avatar: "/evidence/x/kashdhanda.webp",
    date: "8 Sep 2026",
    text: "jupiter is the best place to trade tokenized equities onchain.\n\nwe want you to delete your brokerage account.\n\ncome give us feedback on how to make that happen.",
    likes: 207,
    reposts: 16,
  },
];

export function TweetCard({ t, lead = false }: { t: Tweet; lead?: boolean }) {
  const url = `https://x.com/${t.handle}/status/${t.id}`;
  return (
    <article className="mb-4 min-w-0 break-inside-avoid border border-[var(--rule-strong)] bg-[var(--paper-raised)] p-4">
      <header className="flex items-center gap-3">
        <Image src={t.avatar} width={40} height={40} alt="" className="h-10 w-10 shrink-0 rounded-full border border-[var(--rule)]" />
        <div className="min-w-0 leading-tight">
          <p className="truncate font-medium">{t.name}</p>
          <p className="truncate font-[family-name:var(--font-mono)] text-xs text-[var(--ink-dim)]">@{t.handle}</p>
        </div>
      </header>
      <p className={`mt-3 whitespace-pre-line break-words ${lead ? "text-lg" : "text-sm"}`}>{t.text}</p>
      {t.image ? (
        <Image src={t.image.src} width={t.image.width} height={t.image.height} alt={t.image.alt} sizes="(min-width: 1024px) 50vw, 100vw" className="mt-3 block h-auto w-full border border-[var(--rule)]" />
      ) : null}
      <footer className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-[var(--rule)] pt-2 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-dim)] tabular">
        <span>
          {t.date} · {t.likes.toLocaleString("en-US")} likes · {t.reposts} reposts
        </span>
        <a href={url} className="text-[var(--accent)] underline underline-offset-2">
          View on X
        </a>
      </footer>
    </article>
  );
}

// Each quote is a verbatim substring of the page HTML, checked 2026-09-25.
export const CLIPPINGS = [
  {
    outlet: "Steakhouse Financial",
    date: "4 May 2026",
    title: "DeFi Markets Update 2026-05-04",
    quote: "It is also expanding borrow markets for tokenised equities. USDC can now be used as collateral to borrow xStocks",
    href: "https://kitchen.steakhouse.financial/p/defi-markets-update-2026-05-04",
  },
  {
    outlet: "The Cryptonomist",
    date: "22 Jul 2026",
    title: "Solana tokenized equities set $51.9M lending record with 95% dominance",
    quote: "Solana now controls roughly 95% of all onchain tokenized equity volume, with cumulative transactions exceeding $10 billion by June 2026.",
    href: "https://en.cryptonomist.ch/2026/07/22/solana-tokenized-equities-lending/",
    note: "Article states it was AI-assisted and editor reviewed; figures cite SolanaFloor.",
  },
  {
    outlet: "Cointelegraph, via TradingView",
    date: "30 Jun 2025",
    title: "Tokenized stock trading live on Kraken, Bybit and Solana's DeFi ecosystem",
    quote: "With this integration, stocks can now be used to provide liquidity on Raydium, be traded on Jupiter or swapped to and from Kamino.",
    href: "https://www.tradingview.com/news/cointelegraph:04555ea71094b:0-tokenized-stock-trading-live-on-kraken-bybit-and-solana-s-defi-ecosystem/",
  },
];

export function Clipping({ c }: { c: (typeof CLIPPINGS)[number] }) {
  return (
    <article className="min-w-0 border-t-2 border-[var(--ink)] pt-3">
      <p className="flex flex-wrap justify-between gap-x-3 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.08em] text-[var(--ink-dim)]">
        <span>{c.outlet}</span>
        <span className="tabular">{c.date}</span>
      </p>
      <a href={c.href} className="mt-1 block font-[family-name:var(--font-display)] text-lg font-semibold leading-snug underline-offset-2 hover:underline">
        {c.title}
      </a>
      <blockquote className="mt-2 border-l-2 border-[var(--accent)] pl-3 text-sm text-[var(--ink-dim)]">&ldquo;{c.quote}&rdquo;</blockquote>
      {"note" in c && c.note ? <p className="mt-1 text-[11px] text-[var(--ink-dim)]">{c.note}</p> : null}
    </article>
  );
}
