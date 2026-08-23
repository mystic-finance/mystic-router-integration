# Mystic Router

Mystic Router is a leading DEX aggregator that finds the best prices across 100+ liquidity sources on multiple chains.

| | |
|---|---|
| **Base URL** | `https://router.mysticfinance.xyz` |
| **Interactive API docs** | [Swagger](https://router.mysticfinance.xyz/docs) |
| **Machine-readable spec** (for AI agents / codegen) | [`/llm.txt`](https://router.mysticfinance.xyz/llm.txt) |
| **Health** | [`/health`](https://router.mysticfinance.xyz/health) |
| **Runnable demos (frontend)** | [`demos/frontend`](demos/frontend) (React + Vite) |
| **Runnable demos (backend)** | [`demos/backend`](demos/backend) (Node.js) |
| **Support** | Contact the Mystic team at [joao.moreira@mysticfinance.xyz](mailto:joao.moreira@mysticfinance.xyz) for an API key, and partner onboarding. |

---

## Contents

- [Why Mystic](#why-mystic)
- [Authentication](#authentication)
- [Quickstart](#quickstart)
- [API reference](#api-reference)
- [Supported chains & coverage](#supported-chains--coverage)
- [Fees](#fees)
- [Errors](#errors)

---

## Why Mystic

Access the best swap rates, deep liquidity and reliable execution across 12 chains and 100+ liquidity sources with a single API.

### Core capabilities

- **Two-layer aggregation.** A first-party routing engine that prices pools directly from on-chain dexes, plus a meta-aggregator over every major external aggregator. Both are quoted in parallel on every request, so you get the best price possible in one single API.
- **Smart order routing.** Multi-hop and split routes across pools, ranked by net output rather than by whichever venue answered first, giving unified access to 100+ liquidity sources
- **Coverage where others are thin.** Mystic aggregates on the major EVM chains, plus chains the big aggregators serve poorly (Flare, Plume, Citrea), giving a unified interface for 12+ chains
- **Built-in monetisation.** Route swaps under your API key and earn a share of every fee. See [Fees](#fees).

---


## Authentication

The API is **open**: quoting, building and tracking work with no credentials. An API key buys throughput and fee attribution.

### Using a key

Send it as the `x-api-key` header (`Authorization: Bearer <key>` is also accepted) on your `quote` and `build` calls:

```js
const http = axios.create({
  baseURL: BASE,
  headers: { 'x-api-key': process.env.MYSTIC_API_KEY },
});

await http.post('/v1/swap/quote', {
  chainId, sellToken, buyToken, sellAmount, taker, slippageBps: 50,
});
```

- **With a valid key** → your revenue share is applied and attributed to you, and you get the higher rate limit. See [Fees](#fees).
- **With an invalid key** → `401 Invalid API key`. (Omitting the key entirely is fine; sending a bad one is not.)
- **Without a key** → anonymous: the standard 0.15% fee, no attribution, rate limit of 20 requests per second.

You can also earn fees without a key at all, by passing a `referrer` address on the swap. See [Referral fees](#referral-fees).

### Keeping your key safe

Your API key is a secret tied to your revenue share. Keep it server-side and proxy browser traffic through your own backend. CORS is open, so a key shipped to the frontend can be read and used by anyone. Keys can be rotated by the operator at any time, and partner accounts support an origin allowlist for browser-facing setups.


## Quickstart

Swap tokens in 6 steps:

1. Get token info
2. Get price quote
3. Build transaction from quote
4. Set a token allowance
5. Send transaction
6. Get transaction status (optional)

Steps 2 and 3 can be collapsed into a single call if you'd rather not hold a quote id, see [step 3](#3-build-transaction-from-quote).

Two conventions before you start:

> **Amounts are integers in the token's smallest unit.** Every amount in every request and response is a decimal string in wei, never a float and never a human-readable number. `1 USDC` (6 decimals) is `"1000000"`; `1 WETH` (18 decimals) is `"1000000000000000000"`. Step 1 gets you the `decimals` to build it with.

> **Native assets** use the sentinel address `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` as `sellToken` or `buyToken`. No wrapping on your side, and no approval needed when selling native.


All examples use JavaScript with **axios** for HTTP and **ethers.js** for chain interactions.

```js
import axios from 'axios';
import { ethers } from 'ethers';

const BASE = 'https://router.mysticfinance.xyz';
```

### 1. Get token info

List the supported tokens for a chain (use this to populate a token picker):

```js
async function tokenList(chainId) {
  const { data } = await axios.get(`${BASE}/v1/tokens?chainId=${chainId}`);
  return data;
}
```

**Example response** (`GET /v1/tokens?chainId=14`):

```json
[
  { "chainId": 14, "address": "0x1d80c49bbbcd1c0911346656b529df9e5c2f783d", "symbol": "WFLR", "decimals": 18, "name": "Wrapped Flare", "coingeckoId": "wrapped-flare", "tags": [] },
  { "chainId": 14, "address": "0xfbda5f676cb37624f28265a144a48b0d6e87d3b6", "symbol": "USDC.e", "decimals": 6, "name": "Bridged USDC (Stargate)", "tags": ["stable"] }
]
```

When a user pastes an unknown asset address, resolve its on-chain metadata (this also adds it to the registry):

```js
async function resolveToken(chainId, address) {
  const { data } = await axios.get(`${BASE}/v1/tokens/resolve?chainId=${chainId}&address=${address}`);
  return data;
}
```

**Example response** (`GET /v1/tokens/resolve?chainId=14&address=0x1D80…783d`):

```json
{ "chainId": 14, "address": "0x1d80c49bbbcd1c0911346656b529df9e5c2f783d", "symbol": "WFLR", "decimals": 18, "name": "Wrapped Flare" }
```

> `resolveToken` returns metadata only, it does not tell you whether the token is tradeable. To check if there's a route for this pair, run the quote in Step 2: a result means tradeable; a `404 INSUFFICIENT_LIQUIDITY` means no available route. There is no separate pool-check endpoint, the quote is the check.

### 2. Get price quote

Fan out across every DEX + aggregator and return routes ranked best-first (`quotes[0]` is the best):

```js
async function quote({ chainId, sellToken, buyToken, sellAmount, taker, slippageBps = 50 }) {
  const { data } = await axios.post(`${BASE}/v1/swap/quote`, {
    chainId, sellToken, buyToken, sellAmount, taker, slippageBps,
  });
  return data;
}
```

**Example response** (selling 10 WFLR for USDC.e on chain 14). The winning route is flattened onto the root, and `quotes` holds the full ranked list, best first:

```json
{
  "quoteSetId": "qs_58b12f0b-6a2e-4b0c-9f4e-1c2d3e4f5a6b",
  "partner": { "partnerId": "protocol", "feeBps": 15, "recipient": "0x0F44298b5C26259425f982F8Fe5eEE1C30FaBBe4" },
  "mevAdvice": { "protect": false },
  "chainId": 14,
  "inToken": { "address": "0x1d80c49bbbcd1c0911346656b529df9e5c2f783d", "symbol": "WFLR", "name": "Wrapped Flare", "decimals": 18 },
  "outToken": { "address": "0xfbda5f676cb37624f28265a144a48b0d6e87d3b6", "symbol": "USDC.e", "name": "Bridged USDC (Stargate)", "decimals": 6 },
  "inAmount": "10000000000000000000",
  "outAmount": "64199",
  "minOutAmount": "63878",
  "estimatedGas": 250000,
  "price_impact": "0.12%",
  "from": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "to": "0x69D57B9D705eaD73a5d2f2476C30c55bD755cc2F",
  "value": "0",
  "adapterId": "algebra",
  "quoteId": "algebra::qs_58b12f0b-6a2e-4b0c-9f4e-1c2d3e4f5a6b",
  "quotes": [
    {
      "quoteId": "algebra::qs_58b12f0b-6a2e-4b0c-9f4e-1c2d3e4f5a6b",
      "adapterId": "algebra",
      "rank": 1,
      "venueName": "SparkDEX V4",
      "routeSummary": "Algebra (SparkDEX V4, dyn fee 500bps)",
      "sellAmount": "10000000000000000000",
      "buyAmount": "64199",
      "minBuyAmount": "63878",
      "priceImpactBps": 12,
      "estimatedGas": "250000",
      "partnerFeeBps": 15,
      "validUntil": 1782931426325
    }
  ]
}
```

`outAmount` is the expected output (`64199` = `0.064199` USDC.e, since USDC.e has 6 decimals); `minOutAmount` is the worst case after slippage. Both are reported before Mystic's fee, see [Fees](#fees) for the net-output formula.

To execute, keep the root `quoteSetId` and `quoteId` and pass both to Step 3. Read `quotes[]` only when you want to show alternatives or let the user pick a venue; set `bestOnly: true` to drop it from the response entirely.

Native asset in/out: use `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` as the token. Optional fields: `recipient` (send output elsewhere), `deadlineSeconds`, `minOutput`, `bestOnly`, `referrer`/`referrerFee`, `includeDexes`/`excludeDexes`, `partnerId`, `mevProtect`. See the [API reference](#post-v1swapquote) for all of them.

### 3. Build transaction from quote

Turn the chosen quote into an unsigned transaction (and learn what approval it needs):

```js
async function swap({ quoteSetId, quoteId, userAddress }) {
  const { data } = await axios.post(`${BASE}/v1/swap/build`, { quoteSetId, quoteId, userAddress });
  return data;
}
```

**Example response** (data truncated for readability):

```json
{
  "quoteSetId": "qs_58b12f0b-6a2e-4b0c-9f4e-1c2d3e4f5a6b",
  "adapterId": "algebra",
  "feeMode": "augustus",
  "txRequest": {
    "chainId": 14,
    "to": "0x75FaCE9583A037bf0870Ef6D24f08e207D2CCdDc",
    "data": "0x54e3f31b0000000000000000000000000000000000000000000000000000000000000020…",
    "value": "0",
    "from": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
  },
  "approval": {
    "token": "0x1d80c49bbbcd1c0911346656b529df9e5c2f783d",
    "spender": "0x6352B36E5f938C0FdA3BA8da48D5aD14f1DD78E7",
    "amount": "10000000000000000000"
  },
  "simulation": { "ok": true },
  "partner": { "partnerId": "protocol", "feeBps": 15, "protocolBps": 15, "partnerBps": 0, "partnerRecipient": null }
}
```

`txRequest` is what you send from the wallet (Step 5). `approval` tells you which token/spender to approve in Step 4, it's `null` when no approval is needed. If `feeMode` is `augustus`, the fee handling is already baked into `txRequest.data`; you don't need to add anything.

> **Approve the `approval.spender`, not `txRequest.to`.** They are usually different contracts. Approving the wrong address is the single most common integration bug.

**One-call swap.** If you don't want to hold a `quoteSetId`/`quoteId` between calls, send the swap parameters straight to `build`. It quotes, picks the winner and returns its transaction in one round trip:

```js
const { data } = await axios.post(`${BASE}/v1/swap/build`, {
  chainId: 14, sellToken: SELL_TOKEN, buyToken: BUY_TOKEN, sellAmount,
  userAddress: taker, slippageBps: 50,
});
// same response shape: data.txRequest, data.approval, data.partner
```

The trade-off is that you never see the ranked alternatives, and the price is fixed at build time rather than shown to the user first. Use the two-step flow when a human is confirming the trade.

### 4. Set a token allowance

If `approval` is returned and the current allowance is insufficient, approve the `spender`. You can read the allowance on-chain as below, or from [`GET /v1/allowance`](#get-v1allowance) if you'd rather ask the API, for instance to show the Approve step before the user has a quote:

```js
async function ensureAllowance(signer, approval) {
  if (!approval) return;
  const erc20 = new ethers.Contract(
    approval.token,
    ['function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'],
    signer,
  );
  const owner = await signer.getAddress();
  if ((await erc20.allowance(owner, approval.spender)) < BigInt(approval.amount)) {
    await (await erc20.approve(approval.spender, approval.amount)).wait();
  }
}
```

### 5. Send transaction

```js
async function send(signer, txRequest) {
  const tx = await signer.sendTransaction({
    to: txRequest.to, data: txRequest.data, value: BigInt(txRequest.value || '0'),
  });
  return tx.wait(); // receipt
}
```

`tx.wait()` resolves once the transaction is mined. The receipt you get back from ethers looks like:

```json
{
  "hash": "0x9c1f…4e7a",
  "status": 1,
  "blockNumber": 39218844,
  "gasUsed": "142318"
}
```

> `status: 1` means success, `status: 0` means the transaction reverted. `hash` is what you register in Step 6.

**Gas.** `txRequest` carries no `gas` field on purpose. Let your wallet or provider run `eth_estimateGas` on it. The `estimatedGas` on a quote is a ranking input, not a gas limit; if you set a limit from it, add a buffer of 1.25×–2.5×, or the transaction may run out of gas on a route whose real cost differs from the estimate. To price the fee yourself, or to show the user a speed choice, read [`GET /v1/gas-price`](#get-v1gas-price).

### 6. Get transaction status (optional)

Read a swap's status back from the API. Nothing needs to be registered first: a Mystic swap carries a correlation id in its calldata, so the API recognises the hash and attaches it to the quote that produced it.

```js
async function status(hash) {
  const { data } = await axios.get(`${BASE}/v1/tx/${hash}`);
  return data;
}
```

**Example response** (`GET /v1/tx/0x9c1f…4e7a`):

```json
{
  "chainId": 14,
  "hash": "0x9c1f…4e7a",
  "status": "SUCCESS",
  "blockNumber": 39218844,
  "gasUsed": "142318",
  "from": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
}
```

`status` is `SUCCESS` or `FAILED` once the receipt is on-chain. A hash the API hasn't indexed yet comes back as `{ hash, status: "UNKNOWN", adopting: true }`; poll again shortly. Referral and partner fees are booked from the on-chain event, not from this call, so a spoofed or mismatched hash can't record a fee.

### Putting it all together

```js
async function doSwap() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  const chainId = 14, taker = await signer.getAddress();

  // 1. token info (get decimals to build the amount)
  const { decimals } = await resolveToken(chainId, SELL_TOKEN);
  const sellAmount = ethers.parseUnits('10', decimals).toString();

  // 2. quote
  const q = await quote({ chainId, sellToken: SELL_TOKEN, buyToken: BUY_TOKEN, sellAmount, taker });
  const best = q.quotes[0]; // 404 here = no route for this pair

  // 3. transaction body
  const built = await swap({ quoteSetId: q.quoteSetId, quoteId: best.quoteId, userAddress: taker });

  // 4. allowance  5. send  6. status
  await ensureAllowance(signer, built.approval);
  const receipt = await send(signer, built.txRequest);
  console.log(await status(receipt.hash));
}
```

---

## API reference

All business routes are versioned under `/v1`. Request and response bodies are JSON.

### `POST /v1/swap/quote`

Fans out across every routing source available for the chain and returns them ranked.

**Request**

| Field | Type | Required | Description |
|---|---|---|---|
| `chainId` | integer | ✅ | Target chain. See [Supported chains & coverage](#supported-chains--coverage). |
| `sellToken` | string | ✅ | ERC-20 address, or `0xEeee…EEeE` for native. |
| `buyToken` | string | ✅ | ERC-20 address, or `0xEeee…EEeE` for native. |
| `sellAmount` | string | ✅ | Integer string in the smallest unit. Must be > 0. |
| `taker` | string | ✅ | Wallet that signs and sends the swap. |
| `slippageBps` | integer | — | Basis points; `50` = 0.5%. Range `0`–`5000`. Default `50`. |
| `recipient` | string | — | Where the bought token is delivered. Defaults to `taker`. See the note below this table. |
| `deadlineSeconds` | integer | — | Execution deadline encoded into the route. Range `60`–`86400`. |
| `minOutput` | string | — | Hard floor on the bought amount, in base units. Routes whose guaranteed minimum can't meet it are dropped instead of quoted. Overrides the slippage-derived minimum. |
| `includeDexes` | string[] | — | Restrict the fan-out to these venues, by the `id` values from [`GET /v1/dexes`](#get-v1dexes). |
| `excludeDexes` | string[] | — | Quote every venue except these. |
| `includeAdapters` | string[] | — | Same idea at adapter granularity, using the `adapterId` values quotes report (e.g. `uniswap-v3`, `1inch`). Merged with the dex filters. |
| `excludeAdapters` | string[] | — | Quote everything except these adapters. |
| `referrer` | string | — | Any EOA you control. Identifies you as the fee payee with no API key and no registration. Pair with `referrerFee`. |
| `referrerFee` | number | — | Total fee to charge, as a **percent** (`1` = 1%), range `0.01`–`5`. Supersedes whatever fee your API key would have applied. See [Referral fees](#referral-fees). |
| `bestOnly` | boolean | — | Return only the flattened winner and omit the `quotes` array. The top-level `quoteId` still builds it. |
| `mevProtect` | boolean | — | Ask for MEV-aware routing. The response's `mevAdvice` reports whether a private RPC is available for the chain. |
| `useSmartAccount` | boolean | — | Caller settles through a smart account, which lets the first-party engine offer atomic cross-pool split routes. |
| `partnerId` | string | — | Usually set implicitly via your API key. Passing it explicitly can only request the same or a lower fee. |
| `partnerFeeBpsOverride` | integer | — | Request a lower fee than your default for this call. Rejected with `FEE_VIOLATION` if above the platform cap. |

**Response**

The winning route is flattened onto the root of the response, so you can read the numbers without walking into `quotes[0]`. Both views describe the same route.

| Field | Type | Description |
|---|---|---|
| `quoteSetId` | string | `qs_…`, identifies this fan-out. Pass to `build`. Retrievable for ~2 minutes. |
| `quoteId` | string | The winning route's id. Pass to `build`. |
| `adapterId` | string | Source that produced the winner. |
| `chainId` | integer | Echo of the request. |
| `inToken` / `outToken` | object | `{ address, symbol, name, decimals }` for each side. |
| `inAmount` | string | Input amount in base units. |
| `outAmount` | string | Expected output in base units, gross of the Mystic fee. |
| `minOutAmount` | string | Worst-case output after slippage, gross of the fee. |
| `estimatedGas` | number | Gas estimate for the winning route. |
| `price_impact` | string | Price impact as a percentage string, e.g. `"0.12%"`. |
| `from` | string | The `taker` you sent. |
| `to` | string | Contract the swap will call. |
| `value` | string | Native value the transaction carries, in wei. |
| `data` | string | Calldata, when the winning source produced it at quote time. Call `build` for the authoritative transaction. |
| `partner.partnerId` | string | `protocol` when anonymous, `referrer:0x…` when using a referrer, otherwise your partner id. |
| `partner.feeBps` | integer | **Total** fee in bps charged on this swap, in the bought token. |
| `partner.recipient` | string | On-chain fee collection address. |
| `mevAdvice.protect` | boolean | Whether MEV protection was requested. |
| `mevAdvice.privateRpc` | string \| null | Private RPC endpoint for the chain, when one is configured. |
| `dexFilter.notHonored` | string[] | Present only when a `includeDexes`/`excludeDexes` id could not be applied, either because it's unknown or because filtering it would have caught sibling venues on the same adapter. Filters are never applied silently. |
| `quotes[]` | array | Ranked routes, best first. Omitted when `bestOnly` is set. |

**Quote object** (each entry of `quotes[]`)

| Field | Type | Description |
|---|---|---|
| `quoteId` | string | `<adapterId>::<quoteSetId>`. Pass to `build`. |
| `adapterId` | string | Identifier of the source that produced the route. Also what `includeAdapters` / `excludeAdapters` take. |
| `rank` | integer | 1 = best. |
| `tier` | string | `tier-1` marks a route from Mystic's own pathfinder (`mystic-tier1`); every other source, including the direct-DEX adapters, reports `tier-2`. |
| `venueName` | string | Real DEX brand for display, e.g. `SparkDEX V3.1`, `Rooster Finance`. |
| `routeSummary` | string | Human-readable path description. |
| `fillType` | string | `single` or `split` (route divided across pools). Populated by the pathfinder. |
| `route[]` | array | Machine-readable breakdown: `{ protocol, dexId, tokens[], portionBps, pool }`. Populated by the pathfinder. |
| `sellAmount` | string | Echo of the requested input amount. |
| `buyAmount` | string | Expected output, **gross of the Mystic fee**. |
| `minBuyAmount` | string | Worst-case output after `slippageBps`, gross of the fee. |
| `priceImpactBps` | integer | Estimated price impact in bps. Evaluating and surfacing this is the integrator's responsibility; Mystic does not block high-impact trades. |
| `estimatedGas` | string | Gas estimate used for ranking, not a gas limit. See [step 5](#5-send-transaction). |
| `estimatedGasUsd` | number | Gas cost in USD, when pricing is available. |
| `estimatedAmountOutUsd` | number | Output value in USD, when pricing is available. |
| `partnerFeeBps` | integer | Fee applied to this route. |
| `partnerFeeApplied` | string | `native` (the venue skims it) or `pending` (applied at build time). |
| `validUntil` | integer | Epoch ms. Building after this returns `410 QUOTE_EXPIRED`. |
| `approvalTarget` | string | Spender this route would need. The authoritative value comes from `build`. |
| `permit2` | object \| null | Permit2 typed data, when the route supports approval-free spending. |
| `warnings[]` | string[] | Route-specific advisories, when present. |
| `score` | number | Internal ranking score. Informational. |
| `raw` | object | Opaque adapter payload. Internal, do not depend on its shape. |

Returns **404 `INSUFFICIENT_LIQUIDITY`** when no source can fill the trade.

**Quote lifetime.** A quote set stays retrievable for about two minutes, and each quote carries its own `validUntil` (epoch ms). Nothing is reserved or locked by quoting, so quote as often as you need. Build before `validUntil`, or you'll get `410 QUOTE_EXPIRED` and have to re-quote.

**Recipient.** Set `recipient ≠ taker` to deliver the bought token to a different address. Only sources that can honor a distinct recipient are offered for such a request, so funds never land on the taker by accident. If that filter leaves nothing routable you'll get `404 INSUFFICIENT_LIQUIDITY`; retry without `recipient` and transfer separately.

### `POST /v1/swap/quote/reverse`

The buy flow: state the output you want and get back the input required, along with a real quote you can build. Use it for "I want exactly 100 USDC" rather than "I want to sell 1 ETH".

**Request**

| Field | Type | Required | Description |
|---|---|---|---|
| `chainId` | integer | ✅ | Target chain. |
| `sellToken` | string | ✅ | Token being sold. |
| `buyToken` | string | ✅ | Token being bought. |
| `buyAmount` | string | ✅ | Desired **output**, in the buy token's base units. |
| `taker` | string | ✅ | Wallet that signs and sends the swap. |
| `slippageBps` | integer | — | Basis points; `50` = 0.5%. Range `0`–`5000`. Default `50`. |
| `toleranceBps` | integer | — | How close the solved output must land to `buyAmount`, in bps. Range `1`–`1000`. Default `50` (0.5%). |
| `recipient` | string | — | Where the bought token is delivered. Defaults to `taker`. |
| `includeDexes` | string[] | — | Venue filter, as on `quote`. |
| `excludeDexes` | string[] | — | Venue filter, as on `quote`. |
| `includeAdapters` | string[] | — | Adapter filter, as on `quote`. |
| `excludeAdapters` | string[] | — | Adapter filter, as on `quote`. |
| `referrer` | string | — | Referral payee, as on `quote`. |
| `referrerFee` | number | — | Total fee percent, as on `quote`. |
| `partnerId` | string | — | Usually implicit via API key. |

**Response**

Everything a normal quote returns, including `quoteSetId` and `quoteId`, so you can build the result directly. On top of that:

| Field | Type | Description |
|---|---|---|
| `reverse.requestedBuyAmount` | string | The output you asked for. |
| `reverse.achievedBuyAmount` | string | The output the solved input actually produces. |
| `reverse.sellAmount` | string | The input required. This is the number you wanted. |
| `reverse.offByBps` | integer | Distance between requested and achieved, in bps. |
| `reverse.withinTolerance` | boolean | Whether `offByBps` came in under `toleranceBps`. |
| `reverse.passes` | integer | How many quote passes the solver used, up to 3. |

The solver quotes forward, measures the rate and corrects, up to three passes. AMM pricing is non-linear, so the result is an approximation: check `withinTolerance` before treating the input as exact, and remember the quote's own `minOutAmount` still applies at execution. Returns `404 INSUFFICIENT_LIQUIDITY` when no input size produces output for the pair.

### `POST /v1/swap/build`

Two ways to call it. Either pass the ids from a quote, or pass the swap parameters and let `build` quote and pick the winner itself.

**Request, from a quote**

| Field | Type | Required | Description |
|---|---|---|---|
| `quoteSetId` | string | ✅ | From the quote response. |
| `quoteId` | string | ✅ | The chosen route. |
| `userAddress` | string | ✅ | Wallet that will send the transaction. |
| `recipient` | string | — | Overrides the quote's recipient. Defaults to the quote's recipient, then `userAddress`. |
| `referrer` | string | — | Accepted, but the value used is the one from the original quote's request, so a build can never change the payee the swap was quoted with. |
| `referrerFee` | number | — | Accepted, but the value used is the one from the original quote's request, so a build can never raise the fee the user was quoted. |

**Request, without a quote**

Omit **both** `quoteSetId` and `quoteId` and send the swap parameters instead. `build` runs the fan-out and builds the best route in the same call.

| Field | Type | Required | Description |
|---|---|---|---|
| `userAddress` | string | ✅ | Wallet that will send the transaction, and the taker for the internal quote. |
| `chainId` | integer | ✅ | Target chain. |
| `sellToken` | string | ✅ | ERC-20 address, or `0xEeee…EEeE` for native. |
| `buyToken` | string | ✅ | ERC-20 address, or `0xEeee…EEeE` for native. |
| `sellAmount` | string | ✅ | Integer string in the smallest unit. |
| `slippageBps` | integer | — | Basis points; `50` = 0.5%. Range `0`–`5000`. Default `50`. |
| `minOutput` | string | — | Hard floor on the bought amount, in base units. |
| `includeDexes` | string[] | — | Restrict the fan-out to these venues, by the `id` values from [`GET /v1/dexes`](#get-v1dexes). |
| `excludeDexes` | string[] | — | Quote every venue except these. |
| `includeAdapters` | string[] | — | Restrict the fan-out to these adapters. |
| `excludeAdapters` | string[] | — | Quote everything except these adapters. |
| `referrer` | string | — | Any EOA you control. Identifies you as the fee payee. Pair with `referrerFee`. |
| `referrerFee` | number | — | Total fee to charge, as a **percent** (`1` = 1%), range `0.01`–`5`. |
| `recipient` | string | — | Where the bought token is delivered. Defaults to `userAddress`. |

Missing parameters return `404` naming which ones are absent.

**Response**

| Field | Type | Description |
|---|---|---|
| `quoteSetId` | string | Echo. |
| `adapterId` | string | Source that built the transaction. |
| `txRequest` | object | `{ chainId, to, data, value, from }`. Send this. `value` is a decimal string in wei. |
| `approval` | object \| null | `{ token, spender, amount }`. `null` when no ERC-20 approval is needed (native sells, or a Permit2 flow). |
| `permit2` | object \| null | Typed data to sign instead of approving, when the route supports it. |
| `feeMode` | string | How the fee is collected: `augustus` (atomic, inside `txRequest.data`), `native` (the venue's own referral mechanism), `bundle` (smart-account bundle), `none`. In every case there is nothing extra for you to do. |
| `partner` | object | `{ partnerId, feeBps, protocolBps, partnerBps, partnerRecipient }`, the fee split for this swap. |
| `simulation` | object | Advisory pre-flight result. `{ ok: true }` by default. |
| `directTxRequest` | object | The un-wrapped venue transaction, before Mystic's fee wrapper. Informational: send `txRequest`, not this. |

Returns **404** for an unknown `quoteSetId`/`quoteId`, **410 `QUOTE_EXPIRED`** for a stale quote.

### `GET /v1/swap/quote/:quoteSetId`

Re-read a quote set you already fetched (debugging, or picking a different route later without re-quoting). Returns the stored per-route documents. Individual quotes still expire on their own `validUntil`.

### `GET /v1/tokens?chainId=`

Registry list for a chain: `[{ chainId, address, symbol, decimals, name, coingeckoId?, tags[] }]`. `tags` drives fee tiering (`stable`, `correlated`, `common`, `exotic`) and is useful for grouping in a picker.

### `GET /v1/tokens/resolve`

| Param | Required | Description |
|---|---|---|
| `chainId` | ✅ | Chain to read from. |
| `address` | ✅ | Token address, or the native sentinel. |

Reads `symbol`/`decimals`/`name` on-chain and adds the token to the registry. A non-ERC-20 address resolves to `UNKNOWN`/`Unknown` with `decimals: 18` rather than erroring, so treat "unknown symbol" as a signal to warn the user, and rely on the quote to decide tradeability.

### `GET /v1/chains`

Live chain support with the contracts Mystic uses:

```json
[
  {
    "chainId": 14,
    "name": "Flare",
    "shortName": "flr",
    "isEip1559": true,
    "multicall3": "0xcA11bde05977b3631167028862bE2a173976CA11",
    "permit2": "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    "weth": "0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d",
    "uniswapV3": [ … ],
    "algebra": [ … ],
    "rollupParent": null
  }
]
```

### `GET /v1/allowance`

Current ERC-20 allowances for a wallet, so a UI can decide whether to show an Approve step before it has a quote.

| Param | Required | Description |
|---|---|---|
| `chainId` | ✅ | Chain to read from. |
| `account` | ✅ | Wallet whose allowances you're checking. |
| `tokens` | ✅ | Comma-separated token addresses. |
| `spender` | ✅  | You can Pass `approval.spender` from `build` once a route is chosen. |
| `amount` | — | Base units. When present, each row gains a `sufficient` boolean. |

```json
[
  {
    "token": "0x1d80c49bbbcd1c0911346656b529df9e5c2f783d",
    "spender": "0x6352B36E5f938C0FdA3BA8da48D5aD14f1DD78E7",
    "allowance": "0",
    "sufficient": false
  }
]
```

Selling the native asset needs no approval, so the sentinel address reports an unlimited allowance rather than making you special-case it. A token that can't be read, whether it's not an ERC-20 or the RPC is down, reports `0`, so the answer is always the safe one.

This is a pre-flight convenience, not the source of truth. External aggregators use their own spender, which is only known once a route is picked, so `approval.spender` from [`POST /v1/swap/build`](#post-v1swapbuild) remains authoritative. Chains without a canonical pull address return `400` telling you to pass `spender` explicitly.

### `GET /v1/gas-price`

Current gas price in three speed tiers. You don't need this to swap, `txRequest` is signable as returned, but it's useful for showing a fee estimate or setting your own gas fields.

| Param | Required | Description |
|---|---|---|
| `chainId` | — | One chain. Omit it to get every supported chain as an array; a chain whose RPC is unreachable is left out rather than failing the request. |

```json
{
  "chainId": 14,
  "isEip1559": true,
  "baseFeePerGas": "25000000000",
  "standard": { "legacyGasPrice": "26500000000", "maxPriorityFeePerGas": "1500000000", "maxFeePerGas": "51500000000", "waitTimeEstimate": 30 },
  "fast":     { "legacyGasPrice": "33125000000", "maxPriorityFeePerGas": "1875000000", "maxFeePerGas": "51875000000", "waitTimeEstimate": 15 },
  "instant":  { "legacyGasPrice": "39750000000", "maxPriorityFeePerGas": "2250000000", "maxFeePerGas": "52250000000", "waitTimeEstimate": 5 }
}
```

| Field | Type | Description |
|---|---|---|
| `chainId` | integer | Chain the reading is for. |
| `isEip1559` | boolean | Which fields to use. `true`: send `maxFeePerGas` + `maxPriorityFeePerGas`. `false`: send `legacyGasPrice` as `gasPrice`. |
| `baseFeePerGas` | string \| null | Base fee of the latest block. `null` on legacy chains. |
| `standard` / `fast` / `instant` | object | The three tiers. |
| `<tier>.legacyGasPrice` | string | Type-0 gas price. |
| `<tier>.maxPriorityFeePerGas` | string | Tip. `"0"` on legacy chains. |
| `<tier>.maxFeePerGas` | string | Priority fee plus headroom over the current base fee. |
| `<tier>.waitTimeEstimate` | integer | Rough seconds to inclusion. Indicative only, the mempool isn't sampled. |

All values are **wei strings**, the same units `txRequest` uses, so nothing needs converting before you sign. Readings are cached for a few seconds per chain, so polling is cheap.

### `GET /v1/tx/:hash`

Status of a swap transaction.

| Field | Type | Description |
|---|---|---|
| `chainId` | integer | Chain the transaction was sent on. |
| `hash` | string | Transaction hash. |
| `status` | string | `SUCCESS` or `FAILED` once the receipt is on-chain. |
| `blockNumber` | integer | Block it landed in. |
| `gasUsed` | string | Gas consumed. |
| `effectiveGasPrice` | string | Gas price actually paid. |
| `from` | string | Sender. |
| `to` | string | Contract called. |
| `quoteSetId` / `quoteId` | string | The quote this transaction executed, once matched. |
| `receipt` | object | Full receipt. |

A hash that hasn't been indexed yet returns `{ hash, status: "UNKNOWN", adopting: true }`. The matching runs in the background, so poll again shortly rather than treating it as an error.

### `GET /v1/dexes`

Every venue quotable on a chain, which is what `includeDexes` / `excludeDexes` filter on. Pass `?chainId=` for one chain, or omit it for all of them.

```json
[
  { "id": "sparkdex", "name": "SparkDEX V4", "chainId": 14, "type": "dex", "protocol": "algebra", "router": "0x69D57B9D705eaD73a5d2f2476C30c55bD755cc2F", "adapter": "algebra" },
  { "id": "openocean", "name": "openocean", "chainId": 14, "type": "aggregator", "adapter": "openocean" }
]
```

| Field | Type | Description |
|---|---|---|
| `id` | string | Stable id to use in `includeDexes` / `excludeDexes`. |
| `name` | string | Display name. |
| `chainId` | integer | Chain the venue is on. |
| `type` | string | `dex` for a liquidity venue Mystic routes through itself, `aggregator` for a third-party router it asks for a quote. |
| `protocol` | string | Pool family, e.g. `uniswap-v3`, `algebra`, `curve`. |
| `router` | string | Router contract, for first-party venues. |
| `adapter` | string | Adapter that serves it, which is the granularity filtering operates at. |

### `POST /v1/swap/decode`

Explain a transaction's calldata before or after you send it.

| Field | Type | Required | Description |
|---|---|---|---|
| `data` | string | ✅ | Transaction input data, `0x`-prefixed. |
| `chainId` | integer | — | The decoder is chain-agnostic; accepted to keep request shapes uniform. |

```json
{
  "kind": "augustus-simple-swap",
  "augustus": {
    "fromToken": "0x1d80…783d",
    "toToken": "0xfbda…d3b6",
    "beneficiary": "0xd8dA…6045",
    "partner": "0x0F44…BBe4",
    "feePercent": "15",
    "deadline": "1782931426",
    "uuid": "0x9a3f…"
  },
  "calls": [
    { "selector": "0x095ea7b3", "function": "approve", "to": "0x1d80…783d", "args": ["0x6352…78E7", "10000000000000000000"] },
    { "selector": "0xbc651188", "function": "exactInputSingle", "to": "0x69D5…cc2F", "args": [ … ] }
  ]
}
```

`kind` is `augustus-simple-swap` for a fee-wrapped Mystic swap, or `call` for a plain adapter call. An unrecognised selector comes back with `function: null` rather than failing, so a partially-recognised route still tells you what it can.

### Service endpoints

| Route | Purpose |
|---|---|
| `GET /health` | Liveness and dependency check. |
| `GET /docs` | Swagger UI (interactive, always current). |
| `GET /llm.txt` | Compact machine-readable API contract for AI agents and codegen. |
| `GET /integration.md` | This guide, served by the API. |
| `GET /metrics` | Operational metrics snapshot. |

---

## Supported chains & coverage

Mystic aggregates 100+ liquidity sources across 12 chains. `GET /v1/chains` returns each chain's metadata plus the Multicall3, Permit2 and WETH addresses Mystic uses there.

| Chain | chainId | Native | Explorer | Liquidity covered |
|---|---|---|---|---|
| Ethereum | `1` | ETH | etherscan.io | Uniswap v3 & forks, Curve, CoW Protocol · 0x, 1inch, ParaSwap, KyberSwap, OpenOcean, Odos, OKX, Unizen, Enso, LI.FI, Beam, Nordstern |
| Base | `8453` | ETH | basescan.org | Uniswap v3 & forks (BaseSwap V3), Algebra pools, CoW Protocol · 0x, 1inch, ParaSwap, KyberSwap, OpenOcean, Odos, OKX, Unizen, Enso, LI.FI, fly.trade |
| Arbitrum One | `42161` | ETH | arbiscan.io | Uniswap v3 & forks, Camelot V3, Curve, CoW Protocol · 0x, 1inch, ParaSwap, KyberSwap, OpenOcean, Odos, OKX, Unizen, Enso, LI.FI, fly.trade |
| Optimism | `10` | ETH | optimistic.etherscan.io | Uniswap v3 & forks, Curve, CoW Protocol · 0x, 1inch, ParaSwap, KyberSwap, OpenOcean, Odos, OKX, Unizen, Enso, LI.FI, fly.trade |
| Polygon | `137` | POL | polygonscan.com | Uniswap v3 & forks, QuickSwap V3, Curve, CoW Protocol · 0x, 1inch, ParaSwap, KyberSwap, OpenOcean, Odos, OKX, Unizen, Enso, LI.FI, fly.trade |
| BNB Smart Chain | `56` | BNB | bscscan.com | Uniswap v3 & forks, Algebra pools · 0x, 1inch, ParaSwap, KyberSwap, OpenOcean, Odos, OKX, Unizen, LI.FI, fly.trade |
| Avalanche | `43114` | AVAX | snowtrace.io | Uniswap v3 & forks, Algebra pools · 0x, 1inch, ParaSwap, KyberSwap, OpenOcean, Odos, OKX, Unizen, LI.FI, fly.trade |
| Linea | `59144` | ETH | lineascan.build | Uniswap v3 & forks, Algebra pools · 1inch, KyberSwap, OpenOcean, Odos, OKX, LI.FI |
| Sonic | `146` | S | sonicscan.org | Uniswap v3 & forks, Algebra pools · KyberSwap, OpenOcean, Odos, LI.FI |
| Flare | `14` | FLR | flarescan.com | SparkDEX V2 / V3.1 / V4, BlazeSwap, Enosys · KyberSwap, OpenOcean, LI.FI |
| Plume | `98866` | PLUME | explorer.plume.org | Rooster Finance, Uniswap v3 forks, Curve, Nest RWA mints · OpenOcean |
| Citrea | `4114` | cBTC | explorer.citrea.xyz | Satsuma, Uniswap v3 forks · Fibrous, LI.FI |


---

## Fees

### Trading fee

Mystic charges a **flat 15 bps (0.15%)** on every swap, on every chain, taken in the **bought token** and collected on-chain into Mystic's fee contract at swap time.

Fees are priced by token category. Today all four categories carry the same rate:

| Category | Rate | Example |
|---|---|---|
| Stable | 0.15% | USDC ↔ USDT |
| Correlated | 0.15% | USDC ↔ ETH; ETH ↔ stETH |
| Common | 0.15% | Top 200 tokens by market cap (excluding stable/correlated) |
| Exotic | 0.15% | All other token combinations |

> **These rates can change.** The tiers may be differentiated in future (cheaper stables, higher exotics). Always read `partner.feeBps` from the quote response and apply it dynamically rather than hardcoding `15`.

### Referral fees

The fastest way to monetise, with no API key and no onboarding: pass an address you control as `referrer`, and the total fee you want charged as `referrerFee`.

```js
await axios.post(`${BASE}/v1/swap/quote`, {
  chainId, sellToken, buyToken, sellAmount, taker,
  referrer: '0xYourWallet',
  referrerFee: 1,            // percent, so 1 = 1%
});
```

- `referrerFee` is a **percent** and must be between `0.01` and `5`. Anything higher returns `400 FEE_VIOLATION`.
- It replaces the standard fee rather than adding to it. It is the whole fee charged on that swap, and it supersedes whatever an API key would have applied.
- You keep **85%** of what's collected and Mystic keeps the rest.
- The address is the identity. Nothing to register, and it keys the payout ledger the same way a partner does, so accruals settle through the same path.
- Referral inputs are read from the **quote** when you build from a `quoteId`, so a build can never change the payee or raise the fee the user was quoted.

Fee Collection is not immediate and is done in batches, it accumulates trades rbought by referrer or partner and disburses fees twice every hour.

### Partner fees

Partners earn a cut of the fee on the swaps they route. The default arrangement is **revenue share at 75/25**: the user pays the standard 0.15% and you receive your share of it (11.25 bps), while Mystic keeps the other half. Attaching your key never makes a quote worse for your user.

You can choose either model when your account is provisioned:

| Model | Total charged to the user | You earn |
|---|---|---|
| **Revenue share** (default) | Unchanged, 0.15% | Your configured percentage of the fee. Default **75%**, so 0.1125% |
| **Surcharge** | 0.15% **+** your bps | Your full bps, on top of Mystic's cut |

On the surcharge model your bps is capped by 100 bps (1%); requesting more returns `400 FEE_VIOLATION`. `partnerFeeBpsOverride` can only ever request less than your configured default, for a promotional pair or a fee-free campaign.

### How you get paid

1. The **total** fee is collected on-chain into Mystic's fee contract at swap time, one collection whichever model you're on.
2. Your share is booked to an off-chain ledger once the swap confirms on-chain. Mystic's indexer reads the correlation id embedded in the swap event and matches it to the quote that produced it, so attribution needs no call from you and a spoofed hash books nothing.
3. Balances are settled to your payout wallet on the operator's settlement cycle.

You can start routing before you have a payout wallet. Fees accrue and are held until you set one, then become payable at the next settlement.

---

## Errors

Domain errors return a machine-readable body:

```json
{ "code": "INSUFFICIENT_LIQUIDITY", "message": "No adapter could fulfil the requested route" }
```

Branch on `code`, not on the message text.

| HTTP | `code` | Meaning | What to do |
|---|---|---|---|
| 400 | — | Request validation failed (bad address, unknown field, out-of-range `slippageBps`). | Fix the request. |
| 400 | `UNSUPPORTED_CHAIN` | `chainId` isn't served. | Check `GET /v1/chains`. |
| 400 | `UNSUPPORTED_TOKEN` | Token rejected, or `sellAmount` ≤ 0. | Fix the token or amount. |
| 400 | `FEE_VIOLATION` | Requested fee exceeds your cap, or unknown/inactive partner. | Lower `partnerFeeBpsOverride`, or check your account. |
| 401 | — | Invalid API key. | Check the key; omit it to fall back to anonymous. |
| 404 | `INSUFFICIENT_LIQUIDITY` | No route, including the case where no source can honor your `recipient`. | Try a different size or pair, or drop `recipient`. |
| 404 | — | Unknown `quoteSetId`, `quoteId` or adapter. | Re-quote. |
| 410 | `QUOTE_EXPIRED` | The quote passed its `validUntil`. | Re-quote and rebuild. |
| 429 | — | Rate limited. | Back off using `Retry-After`. |
| 502 | `ADAPTER_*` | An upstream venue failed. | Retry; the fan-out normally routes around this on its own. |
| 500 | — | Server error. | Retry with backoff; contact the operator if it persists. |

Request bodies are strictly validated: an unrecognised field returns `400` rather than being ignored, so send only the documented parameters.
