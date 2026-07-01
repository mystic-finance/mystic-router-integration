# API Integration Guide

In the following guide, we introduce how to use the Mystic Router API in the most efficient way. 

For detailed parameter settings, see the interactive API docs at:
- [Swagger](https://router.mysticfinance.xyz/docs)
- [LLM](https://router.mysticfinance.xyz/llm.txt)

## Demos

Two runnable end-to-end demos live in this repo.

### Frontend

[`demos/frontend`](demos/frontend) — a React + Vite app

### Backend

[`demos/backend`](demos/backend) — a Node.js script that runs all 6 steps from the command line.


## Swap Overview

The swap function enables users to seamlessly exchange one asset for another directly at the best swap rate. 
Mystic is a two-layer aggregator, a DEX aggregator engine built on Augustus V5, and a meta aggregator on available external aggregators (0x, 1inch, OpenOcean, Kyber, LI.FI, Paraswap). and supports over 10 chains including Ethereum, Flare, Plume, Citrea.

You make one API call to get ranked routes, and another one to get a ready-to-send transaction, then submit it from the user's wallet.


> **Amounts are in the token's smallest unit (wei).** `1 USDC` (6 decimals) = `"1000000"`. Use Step 1 (`resolveToken`) to get a token's `decimals`.

## Swap Tokens in 6 Steps

1. Get token info
2. Get price quote 
3. Build transaction from quote
4. Set a token allowance
5. Send transaction 
6. Track transaction 

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

> `resolveToken` returns metadata only, it does not tell you whether the token is tradeable. To check if there's a route for this pair, run the quote in Step 2: a result means tradeable; a `404 INSUFFICIENT_LIQUIDITY` means no available route.

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

**Example response** (selling 10 WFLR for USDC.e on chain 14). `quotes` is sorted best-first, so **`quotes[0]` is the route you want**:

```json
{
  "quoteSetId": "qs_58b12f0b-6a2e-4b0c-9f4e-1c2d3e4f5a6b",
  "partner": { "partnerId": "protocol", "feeBps": 20, "recipient": "0x0F44298b5C26259425f982F8Fe5eEE1C30FaBBe4" },
  "mevAdvice": { "protect": false },
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
      "estimatedGas": "250000",
      "validUntil": 1782931426325
    }
  ]
}
```

`buyAmount` is the expected output (`64199` = `0.064199` USDC.e, since USDC.e has 6 decimals); `minBuyAmount` is the worst case after slippage. Keep the `quoteSetId` and the chosen `quoteId`, you pass both to Step 3.

Native asset in/out: use `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` as the token. Optional fields: `recipient` (send output elsewhere), `deadlineSeconds`, `partnerId`.

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
  }
}
```

`txRequest` is what you send from the wallet (Step 5). `approval` tells you which token/spender to approve in Step 4, it's `null` when no approval is needed. If `feeMode` is `augustus`, the fee handling is already baked into `txRequest.data`; you don't need to add anything.

### 4. Set a token allowance

If `approval` is returned and the current allowance is insufficient, approve the `spender` (skip for native sells, or use `permit2` if present):

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

### 6. (Optional) Save transaction

Register the hash so the operator can confirm status. This is necessary for partners to call to book partner fees gained from this swap.

```js
async function track({ chainId, hash, from, quoteSetId, quoteId }) {
  await axios.post(`${BASE}/v1/tx`, { chainId, hash, from, quoteSetId, quoteId });
}
```

**Example response** (`GET /v1/tx/0x9c1f…4e7a`):

```json
{
  "chainId": 14,
  "hash": "0x9c1f…4e7a",
  "status": "SUCCESS",
  "blockNumber": 39218844,
  "from": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
}
```

`status` is `PENDING` right after you submit, then becomes `SUCCESS` (success) or `FAILED` (reverted) once the operator confirms it on-chain. Only a `SUCCESS` swap that matches the original quote books the partner fee — so a spoofed or mismatched hash can't record a fee.

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

  // 4. allowance  5. send  6. track
  await ensureAllowance(signer, built.approval);
  const receipt = await send(signer, built.txRequest);
  await track({ chainId, hash: receipt.hash, from: taker, quoteSetId: q.quoteSetId, quoteId: best.quoteId });
}
```

---

## Quote parameters (reference)

| Field | Required | Notes |
|---|---|---|
| `chainId` | ✅ | Target chain. |
| `sellToken` / `buyToken` | ✅ | ERC-20 address; native = `0xEeee…EEeE`. |
| `sellAmount` | ✅ | Integer string, smallest unit (wei). |
| `taker` | ✅ | Wallet that signs & sends. |
| `recipient` | — | Where the bought token goes; default `taker`. |
| `slippageBps` | — | Basis points, 50 = 0.5% (default 50). |
| `deadlineSeconds` | — | Quote/tx deadline. |
| `partnerId` | — | Usually set via API key; override requests a *lower* fee. |

A quote returns `venueName` (real DEX brand, e.g. `Rooster Finance`, `SparkDEX V3.1`, `JuiceSwap`) for display, and `validUntil`, re-quote if it has passed.

## Partners & API keys

If you're a **partner** (you earn a fee on the swaps you route). The Mystic team provisions your account and gives you two things:

- a `partnerId` (your identifier), and
- an **API key** (a secret).

### Using your key

Send the key as the **`x-api-key`** header on your `quote` (step 2) and `build` (step 3) calls. That authenticates you and applies your configured fee + payout automatically:

```js
const http = axios.create({ baseURL: BASE, headers: { 'x-api-key': process.env.MYSTIC_API_KEY } });

await http.post('/v1/swap/quote', { chainId, sellToken, buyToken, sellAmount, taker, slippageBps: 50, partnerId: process.env.MYSTIC_PARTNER_ID });
```

- **With a valid key** → the partner's fee (defaultFeeBps is set when creating partner account, capped by maxFeeBps) is added to the swap fee. The total fee is collected on-chain into Mystic's Fee Claimer contract, while the partner's share is tracked in an off-chain settlement ledger.
- **Without a key** → the request is anonymous and uses the default **protocol fee** only (no partner attribution).


## Recipient

Set `recipient ≠ taker` to redirect output. Only adapters that can honor it are offered so funds never land on the taker.

## Errors

| HTTP | Meaning | Action |
|---|---|---|
| 400 | Validation (bad address, amount ≤ 0). | Fix the request. |
| 404 `INSUFFICIENT_LIQUIDITY` | No route (incl. none honoring `recipient`). | Try another size/pair, or drop `recipient`. |
| 404 `Unknown quote` / `QuoteExpired` | Expired or wrong ids. | Re-quote. |
| 429 | Rate limited. | Back off (`x-ratelimit-*`). |
| 500 | Server/upstream error. | Retry / contact operator. |

See the [Demos](#demos) section at the top for runnable frontend and backend examples.
