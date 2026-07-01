// Mystic Router — Swap API backend demo (Node.js, axios + ethers v6).
// Mirrors the 6 steps in docs/INTEGRATION.md: token info -> quote -> tx body -> allowance -> send -> track.
//   cp .env.example .env  &&  fill it in  &&  node index.mjs
import 'dotenv/config';
import axios from 'axios';
import { ethers } from 'ethers';

const BASE = process.env.MYSTIC_BASE_URL || 'https://router.mysticfinance.xyz';
const { RPC_URL, PRIVATE_KEY } = process.env;
const CHAIN_ID = Number(process.env.CHAIN_ID);
const SELL_TOKEN = process.env.SELL_TOKEN;   // ERC-20 address, or 0xEeee…EEeE for native
const BUY_TOKEN = process.env.BUY_TOKEN;
const SELL_HUMAN = process.env.SELL_AMOUNT_HUMAN || '10'; // human amount, e.g. "10"
const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS || 50);

const NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const ERC20 = ['function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'];
const http = axios.create({ baseURL: BASE, headers: process.env.MYSTIC_API_KEY ? { 'x-api-key': process.env.MYSTIC_API_KEY } : {} });

// 1. Get token info
async function resolveToken(chainId, address) {
  if (address.toLowerCase() === NATIVE.toLowerCase()) return { symbol: 'NATIVE', decimals: 18 };
  const { data } = await http.get(`/v1/tokens/resolve?chainId=${chainId}&address=${address}`);
  return data;
}
// 2. Price quote
async function quote(body) {
  const { data } = await http.post('/v1/swap/quote', body);
  return data;
}
// 3. Get transaction body
async function swap(body) {
  const { data } = await http.post('/v1/swap/build', body);
  return data;
}
// 4. Set a token allowance
async function ensureAllowance(signer, approval) {
  if (!approval) return;
  const erc20 = new ethers.Contract(approval.token, ERC20, signer);
  const owner = await signer.getAddress();
  if ((await erc20.allowance(owner, approval.spender)) < BigInt(approval.amount)) {
    console.log(`Approving ${approval.spender}…`);
    await (await erc20.approve(approval.spender, approval.amount)).wait();
  }
}
// 5. Send transaction
async function send(signer, txRequest) {
  const tx = await signer.sendTransaction({ to: txRequest.to, data: txRequest.data, value: BigInt(txRequest.value || '0') });
  console.log(`Sent ${tx.hash} — waiting…`);
  return tx.wait();
}
// 6. Track transaction
async function track(body) {
  await http.post('/v1/tx', body);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  const taker = await signer.getAddress();
  console.log(`Wallet ${taker} on chain ${CHAIN_ID}`);

  const t = await resolveToken(CHAIN_ID, SELL_TOKEN);
  const sellAmount = ethers.parseUnits(SELL_HUMAN, t.decimals).toString();
  console.log(`Selling ${SELL_HUMAN} ${t.symbol} (${sellAmount})`);

  const q = await quote({ chainId: CHAIN_ID, sellToken: SELL_TOKEN, buyToken: BUY_TOKEN, sellAmount, taker, slippageBps: SLIPPAGE_BPS });
  const best = q.quotes[0]; // a 404 above means "no route for this pair"
  console.log(`Best: ${best.venueName || best.adapterId} -> ${best.buyAmount} (min ${best.minBuyAmount})`);

  const built = await swap({ quoteSetId: q.quoteSetId, quoteId: best.quoteId, userAddress: taker });
  console.log(`Build feeMode=${built.feeMode}, to=${built.txRequest.to}`);

  await ensureAllowance(signer, built.approval);
  const receipt = await send(signer, built.txRequest);
  console.log(`Status: ${receipt.status === 1 ? 'SUCCESS' : 'FAILED'} in block ${receipt.blockNumber}`);

  await track({ chainId: CHAIN_ID, hash: receipt.hash, from: taker, quoteSetId: q.quoteSetId, quoteId: best.quoteId });
  console.log('Tracked. Done.');
}

main().catch((e) => { console.error('Error:', e.response?.data ? JSON.stringify(e.response.data) : e.message); process.exit(1); });
