# Mystic Router — Frontend demo (React + Vite)

A small React app that connects an injected wallet (MetaMask), quotes, and swaps through the Mystic Router API. Mirrors the [Integration Guide](../../README.md) steps: resolve → quote → build → approve → send.

## Run

```bash
cd demos/frontend
npm install
npm run dev        # opens a Vite dev server (http://localhost:5173)
```

Then in the page:
1. Set the **Mystic API base URL** (default `https://router.mysticfinance.xyz`).
2. **Connect wallet** (on the chain you want to trade).
3. Paste **sell/buy token** addresses (or `0xEeee…EEeE` for native) and an **amount**.
4. **Get quote** → shows the best route/output.
5. **Swap** → approves if needed and sends.

Build for production with `npm run build` (outputs to `dist/`).

## Structure

- `src/App.jsx` — the whole flow (state + the API calls).
- `src/main.jsx` — React entry.
- `index.html` / `vite.config.js` — Vite setup.

## Notes

- If the API is on a different origin, ensure CORS allows it (the Mystic API enables permissive CORS by default).
- `404 INSUFFICIENT_LIQUIDITY` on quote = no route for that pair.
- Full reference: [the Integration Guide](../../README.md), the Swagger UI at `/docs`, or `GET /llm.txt`.
