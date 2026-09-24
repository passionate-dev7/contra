import type { Metadata } from "next";
import { Spectral, Work_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const spectral = Spectral({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-spectral",
  display: "swap",
});

const workSans = Work_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-work-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
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
