import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const spectral = localFont({
  src: [
    { path: "../../public/fonts/spectral-500.ttf", weight: "500", style: "normal" },
    { path: "../../public/fonts/spectral-600.ttf", weight: "600", style: "normal" },
  ],
  variable: "--font-spectral",
  display: "swap",
});

const workSans = localFont({
  src: [
    { path: "../../public/fonts/work-sans-400.ttf", weight: "400", style: "normal" },
    { path: "../../public/fonts/work-sans-500.ttf", weight: "500", style: "normal" },
    { path: "../../public/fonts/work-sans-600.ttf", weight: "600", style: "normal" },
  ],
  variable: "--font-work-sans",
  display: "swap",
});

const plexMono = localFont({
  src: [
    { path: "../../public/fonts/ibm-plex-mono-400.ttf", weight: "400", style: "normal" },
    { path: "../../public/fonts/ibm-plex-mono-500.ttf", weight: "500", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Contra: short xStocks on Solana",
  description: "Deposit USDC, borrow a tokenized US stock on Kamino, sell it through Jupiter. One ticket to open a short, one to close it.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${spectral.variable} ${workSans.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
