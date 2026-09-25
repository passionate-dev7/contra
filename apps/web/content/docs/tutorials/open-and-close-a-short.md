# Open and close a short in the app

This walks through one short from the order ticket to the close button. It uses the Next.js app in `apps/web`. You need a Wallet Standard wallet (Phantom, Backpack, Solflare) holding USDC and a little SOL for fees on mainnet. This moves real funds.

## 1. Run the app

```bash
pnpm install
pnpm --filter @contra/web dev
```

The app reads `SOLANA_RPC_URL` (then `RPC_URL`, then the public mainnet endpoint) on the server (`packages/short/src/rpc.ts:8`). The browser confirms signatures against `NEXT_PUBLIC_SOLANA_RPC_URL`, or the public mainnet endpoint if unset (`apps/web/src/lib/wallet.ts:27`). `PYTH_API_KEY` is optional; without it the Pyth fair-value line says so instead of showing a price.

Open `http://localhost:3000`.

## 2. Read the header and blotter

The header states two live facts computed on the server (`apps/web/src/app/page.tsx`):

- **"N of M xStocks shortable now"**: the count of xStock reserves whose `borrowable` flag is true in `/api/reserves`.
- **"US market open" or "closed"**: `market_hours.is_open` of Pyth's `Equity.US.SPY/USD` feed, read from Hermes' free `/v2/price_feeds` endpoint (`apps/web/src/lib/reserves.ts:157`).

The blotter lists every reserve with its borrow factor, borrow APY, available liquidity, and a status. A reserve is borrowable only if its borrow limit is above zero, the cap is not reached, and liquidity is available. Otherwise the row carries the reason: `borrow limit 0 on Kamino`, `borrow cap reached on Kamino`, or `no available liquidity on Kamino` (`apps/web/src/lib/reserves.ts:61`).

## 3. Fill the ticket

The ticket (`apps/web/src/components/Ticket.tsx`) has three inputs:

| Field | Default | Meaning |
|---|---|---|
| Ticker | first borrowable xStock | blocked tickers are listed but disabled, with the reason in the option label |
| Size (USD notional) | `100` | how much of the xStock to borrow and sell, in USD at Kamino's oracle price |
| Collateral (USDC) | `220` | USDC deposited as collateral |

As you type, the ticket computes (`apps/web/src/lib/ticket-math.ts`):

- **Live LTV**: `size * borrowFactor / collateral`, using the USDC/xStock pair borrow factor from Kamino. This is the weighted ratio klend checks, not raw notional over collateral.
- **Liquidation price**: the xStock price at which that weighted ratio reaches the pair's liquidation LTV.
- **Borrow APY**: the reserve's current `totalBorrowAPY`.

Below that, an "On-chain guarantees" box shows the Pyth fair-value line (TSLAx and QQQx only, see [oracle-and-pricing](../explanation/oracle-and-pricing.md)) and the Lighthouse guard. The dollar figure in the guard sentence is `size * 0.99`, an approximation for display. The bound actually enforced on-chain is computed in `packages/short/src/build.ts:161` from your USDC balance and the Jupiter quote's minimum out.

The **Open short** button stays disabled unless all of these hold: the ticker is borrowable, the Pyth SPY feed reports the market open, Kamino's oracle price for the reserve is valid, LTV is under the pair's max LTV, and both inputs are positive (`Ticket.tsx:75`).

## 4. Connect and sign

1. Click **Connect wallet**. The ticket connects the first Wallet Standard wallet that supports Solana.
2. Click **Open short**. The browser posts to `/api/open` with raw amounts. The server builds the transaction and returns it unsigned.
3. Your wallet shows one transaction (two if the combined message was over 1232 bytes, see [transaction-anatomy](../explanation/transaction-anatomy.md)). Approve it.
4. `signAndSendAll` sends each transaction and waits for `confirmed` before sending the next (`apps/web/src/lib/wallet.ts:34`).
5. The ticket lists each signature with a Solscan link.

If the builder refuses (for example `MarketClosedError` from the Scope freshness check), the ticket shows the error text returned by `/api/open`.

## 5. Check the position

Open `/positions?owner=<your address>`, or use **View a position** in the header and paste the address. The page reads your Kamino vanilla obligation on the xStocks market and shows:

- deposits and borrows with USD values
- total LTV against liquidation LTV, with a warning within 5 LTV points of liquidation
- one card per xStock borrow: the borrowed amount in displayed (scaled-UI) shares, pair borrow factor, Kamino mark, Jupiter mark, the gap between them (red above 1%), liquidation price, interest accrued since the last borrow or repay, and the time of that last activity

If the address has no obligation, the page says "No obligation for ... on the xStocks market yet." See [oracle-and-pricing](../explanation/oracle-and-pricing.md#positions-pl) for what the marks mean and what they do not.

## 6. Close

Each short card has a **Close position** button when the obligation holds a USDC deposit (`apps/web/src/components/ShortCard.tsx:87`). Clicking it:

1. connects the wallet and refuses if the connected address is not the position owner
2. posts to `/api/close` with:
   - `repayRaw` = borrowed amount x 1.001
   - `withdrawRaw` = the whole USDC deposit
   - `maxUsdcInRaw` = the borrow's Kamino USD value x 1.05
   (`apps/web/src/components/CloseButton.tsx:29`)
3. signs and sends the returned transaction(s) the same way as the open

The builder rejects the close before signing if Jupiter's quote cannot cover the repay, or if the buy-back needs more USDC than `maxUsdcInRaw`. The close transaction carries no Lighthouse guard; see [risk-and-trust](../explanation/risk-and-trust.md).

## Hedging an existing holding

`/hedge?wallet=<address>` reads the wallet's Token-2022 xStock balances and proposes shorting half of the largest borrowable holding, capped by the reserve's remaining capacity. **Open hedge** links to the home page with `ticker`, `borrowRaw`, `usdcCollateral`, `usdcCollateralRaw` and `sizeUsd` prefilled (`apps/web/src/app/hedge/page.tsx:199`). The flow from there is steps 3 to 6.
