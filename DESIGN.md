# Contra — design system

Contra is a broker's order ticket for shorting tokenized US equities on Solana,
not a crypto dashboard. The direction is a light, dense clearinghouse ledger:
a printed exchange sheet on the left, a fixed order ticket clipped beside it
on the right, the way a floor broker's blotter and pad sit together.

`uicraft read` lock (`apps/web/.uicraft-read.json`):
`--as "trading ticket for shorting tokenized stocks, for a non-US professional trader" --dials 4/2/3 --type Spectral --surface cream --accent #B5541F --radius 4 --showpiece none`

## Macrostructure: Broker Ticket Blotter

Two fixed columns above 1024px, stacked below it:

- **Left — the blotter.** A ledger-ruled table of the market: the xStock
  reserves, each row showing symbol, borrow factor, borrow APY,
  available liquidity, and a status stamp (`BORROWABLE` or `LIMIT 0`). Above
  it, a ticker strip states the two live facts: the number of xStocks that
  can be shorted right now and the US market open/closed state. Below it, the
  `/positions` obligation summary when an owner is loaded.
- **Right — the ticket.** A single fixed order-pad card: ticker select,
  size in USD, collateral in USDC, live LTV / liquidation price / borrow
  APY readout, and the Open Short action. This card never scrolls out of
  view on desktop; on mobile it follows the blotter in document order.
  USDC's collateral limits are stated once in the ticket
  ("USDC collateral: max LTV …, liquidation …", live from the USDC
  reserve), never repeated per xStock row.

No hero, no marketing scroll. The ticket is visible on load, which is the
uicontract's "CTA on first screen" requirement read literally for a tool
rather than a landing page.

## Theme: clearinghouse ledger

Warm off-white ledger paper, hairline rules instead of shadows, a rubber-stamp
ink accent for status and the short action. Numbers are always tabular and
right-aligned, like a printed statement. No card shadows; borders only.

## Tokens

```
--paper:        #F1ECDF   /* page background, warm ledger paper */
--paper-raised: #FBF8F0   /* ticket card, table header band */
--ink:          #201A12   /* off-black, primary text */
--ink-dim:      #6B6252   /* secondary text, labels */
--rule:         #D9D0BC   /* hairline borders, table rules */
--rule-strong:  #B7AC90   /* emphasised rules, input borders */
--accent:       #B5541F   /* burnt-sienna stamp ink: SHORT action, live dot, links */
--accent-ink:   #FBF8F0   /* text on accent */
--positive:     #3F6B3A   /* borrowable / long-side numbers, deep bottle green */
--negative:     #A3271F   /* blocked / liquidation-risk numbers, oxblood */
--focus:        #1C3FAA   /* focus ring, distinct from accent so focus never reads as a stamp */
```

Radius: 4px everywhere (`--radius: 4px`). This is a ledger, not a bubble UI;
radius exists only to soften hairlines, not to round cards into pills.

## Type

- Display / numerals of record (headline, ticker prices, the live reserve count):
  **Spectral** (serif, self-hosted with `next/font/local`), weight 500/600.
  Roman only, no italic headings.
- Body and labels: **Work Sans**, weight 400/500.
- Tabular data (the blotter table, the ticket's size/collateral/APY figures):
  **IBM Plex Mono**, `font-variant-numeric: tabular-nums`, weight 400/500.

2+1 discipline: Spectral for display, Work Sans for reading, Plex Mono only
where numbers must align in columns.

## Spacing & layout

4px base scale (4/8/12/16/24/32/48/64). Container max-width 1180px, 24px
side gutters below 1024px, 48px above. Blotter/ticket split: `1fr` /
`380px` with a 1px `--rule` divider, collapsing to a single column under
1024px with the ticket rendered second... no: rendered **first** on mobile,
since it is the primary action, then the blotter beneath it.

## Components

- **Ticker strip**: single row, monospace, live dot (accent, pulses only
  without `prefers-reduced-motion`), the two computed facts separated by a
  hairline.
- **Blotter row**: ticker, borrow factor plus the numeric columns, a stamp badge
  (`BORROWABLE` in `--positive` outline, or `LIMIT 0` in `--negative`
  outline with the reason as a tooltip/subtext — never just greyed out).
- **Order ticket card**: `--paper-raised` fill, 1px `--rule-strong` border,
  radius 4px. Disabled tickers cannot be selected and show the reason
  inline, not just disabled styling.
- **Signature receipt**: after submit, a monospace list of transaction
  signatures, each linked to `https://solscan.io/tx/<sig>`.
- **Positions card**: obligation deposits/borrows/health/liquidation price,
  owner address linked to `https://solscan.io/account/<address>`, Close
  button.
- **States**: every fetch (`/api/reserves`, `/api/open`, `/api/close`,
  positions load) renders loading (skeleton rows, not a spinner over blank
  space), empty (named, e.g. "No obligation for this address on the xStocks
  market yet"), and error (the real error message, never swallowed) states.

## Motion (dial 2/5 — restrained)

Only the live-market dot pulses (opacity, 2.4s ease-in-out loop) and a
180ms transform+opacity on button press (`scale(0.97)`) / card entry
(`scale(0.95)` + opacity). No `transition-all`, no `ease-in`. Every
animation is wrapped in `@media (prefers-reduced-motion: no-preference)`.

## Icons

Phosphor, regular weight, 1 family, no hand-rolled SVG icons.

## Diversification from the design log

Checked against every entry in `~/.config/agent-rules/frontend/design-log.jsonl`:
this is the first light-surface, ledger-macrostructure entry with Spectral as
the display face and a burnt-sienna accent — differs from every prior entry on
macrostructure, display font and accent at minimum (Last Call: flight-board /
Geist Mono / signal red; the two closest palette neighbours, graph-paper and
newsprint-audit, use Space Grotesk/Newsreader and blue/red accents on a
different macrostructure family).
