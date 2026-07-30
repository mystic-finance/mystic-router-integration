# Mystic Router — Backend demo (Node.js)

A short script (axios + ethers) that runs the **6 steps** from the [Integration Guide](../../README.md): token info → quote → tx body → allowance → send → status.

## Run

```bash
cd demos/backend
npm install
cp .env.example .env      # then edit .env
npm start
```

## What it does

1. `GET /v1/tokens/resolve` — reads the sell token's on-chain metadata (symbol/decimals) for display.
2. `POST /v1/swap/quote` — gets ranked routes; `quotes[0]` is the best. (A `404 INSUFFICIENT_LIQUIDITY` means no route exists for the pair.)
3. `POST /v1/swap/build` — gets the unsigned `txRequest` and any required `approval`.
4. Approves the `spender` if the current allowance is insufficient.
5. Signs & sends `txRequest`, waits for the receipt.
6. `GET /v1/tx/:hash` — reads the swap's status back. Optional: fees are booked from the on-chain swap event, so nothing has to be registered.

## Notes

- Set `SELL_AMOUNT_HUMAN` as a human amount (e.g. `10`) — the demo fetches `decimals` via `resolveToken` and converts to wei. (The raw API always takes integer wei strings.)
- Native asset: use `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` as `SELL_TOKEN`/`BUY_TOKEN` (no approval needed for a native sell; `value` is set for you).
- Use a **throwaway key** with a little gas + the sell token. Never commit `.env`.
- Full reference: [the Integration Guide](../../README.md), the Swagger UI at `/docs`, or `GET /llm.txt`.
