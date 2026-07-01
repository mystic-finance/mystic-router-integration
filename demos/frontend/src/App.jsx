import { useCallback, useState } from 'react';
import { ethers } from 'ethers';

const NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const ERC20 = [
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
];

export default function App() {
  const [base, setBase] = useState('https://router.mysticfinance.xyz');
  const [signer, setSigner] = useState(null);
  const [account, setAccount] = useState('');
  const [chainId, setChainId] = useState(0);
  const [sell, setSell] = useState('');
  const [buy, setBuy] = useState('');
  const [amount, setAmount] = useState('10');
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);

  const push = (m) => setLog((l) => [typeof m === 'string' ? m : JSON.stringify(m), ...l]);

  // Small API helper against the Mystic Router server.
  const api = useCallback(
    async (path, body) => {
      const r = await fetch(base + path, {
        method: body ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`${path} ${r.status}: ${j.message || j.code || JSON.stringify(j)}`);
      return j;
    },
    [base],
  );

  const connect = useCallback(async () => {
    if (!window.ethereum) return push('No injected wallet found (install MetaMask).');
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send('eth_requestAccounts', []);
    const s = await provider.getSigner();
    setSigner(s);
    setAccount(await s.getAddress());
    setChainId(Number((await provider.getNetwork()).chainId));
    push('Wallet connected.');
  }, []);

  // Step 1: resolve decimals, then build the wei amount.
  const toWei = useCallback(
    async (addr, human) => {
      if (addr.toLowerCase() === NATIVE.toLowerCase()) return ethers.parseUnits(human, 18).toString();
      const t = await api(`/v1/tokens/resolve?chainId=${chainId}&address=${addr}`);
      return ethers.parseUnits(human, t.decimals).toString();
    },
    [api, chainId],
  );

  // Step 2: price quote.
  const getQuote = useCallback(async () => {
    setBusy(true);
    try {
      const sellAmount = await toWei(sell.trim(), amount.trim());
      const q = await api('/v1/swap/quote', {
        chainId,
        sellToken: sell.trim(),
        buyToken: buy.trim(),
        sellAmount,
        taker: account,
        slippageBps: 50,
      });
      setQuote(q);
      const b = q.quotes[0];
      push(`Best: ${b.venueName || b.adapterId} — out ${b.buyAmount} (min ${b.minBuyAmount})`);
    } catch (e) {
      push('Quote failed: ' + e.message); // 404 INSUFFICIENT_LIQUIDITY = no route for this pair
    } finally {
      setBusy(false);
    }
  }, [api, toWei, sell, buy, amount, chainId, account]);

  // Steps 3–6: build -> allowance -> send -> track.
  const doSwap = useCallback(async () => {
    if (!quote) return;
    setBusy(true);
    try {
      const best = quote.quotes[0];
      const built = await api('/v1/swap/build', { quoteSetId: quote.quoteSetId, quoteId: best.quoteId, userAddress: account });
      push(`Built (feeMode ${built.feeMode}).`);

      if (built.approval) {
        const token = new ethers.Contract(built.approval.token, ERC20, signer);
        if ((await token.allowance(account, built.approval.spender)) < BigInt(built.approval.amount)) {
          push('Approving…');
          await (await token.approve(built.approval.spender, built.approval.amount)).wait();
        }
      }

      const tx = await signer.sendTransaction({
        to: built.txRequest.to,
        data: built.txRequest.data,
        value: BigInt(built.txRequest.value || '0'),
      });
      push(`Sent ${tx.hash} — waiting…`);
      const rc = await tx.wait();
      push(`Status: ${rc.status === 1 ? 'SUCCESS' : 'FAILED'}`);

      await api('/v1/tx', { chainId, hash: tx.hash, from: account, quoteSetId: quote.quoteSetId, quoteId: best.quoteId });
      push('Tracked. Done.');
    } catch (e) {
      push('Swap failed: ' + e.message);
    } finally {
      setBusy(false);
    }
  }, [api, quote, account, signer, chainId]);

  return (
    <>
      <h1>Mystic Router — React demo</h1>
      <p className="muted">Connect a wallet, pick a pair + amount, get a quote, and swap. Calls a self-hosted Mystic Router API.</p>

      <label>Mystic API base URL</label>
      <input value={base} onChange={(e) => setBase(e.target.value)} />

      <div style={{ marginTop: 12 }}>
        <button onClick={connect}>{account ? 'Reconnect' : 'Connect wallet'}</button>
        {account && <span className="muted" style={{ marginLeft: 8 }}>{account.slice(0, 6)}…{account.slice(-4)} · chain {chainId}</span>}
      </div>

      <div className="row">
        <div>
          <label>Sell token (address)</label>
          <input value={sell} onChange={(e) => setSell(e.target.value)} placeholder="0x… or 0xEeee…EEeE for native" />
        </div>
        <div>
          <label>Buy token (address)</label>
          <input value={buy} onChange={(e) => setBuy(e.target.value)} placeholder="0x…" />
        </div>
      </div>

      <label>Sell amount (human, e.g. 10)</label>
      <input value={amount} onChange={(e) => setAmount(e.target.value)} />

      <div className="row">
        <button disabled={!account || busy} onClick={getQuote}>1) Get quote</button>
        <button disabled={!quote || busy} onClick={doSwap}>2) Swap</button>
      </div>

      <label>Log</label>
      <pre>{log.join('\n') || '—'}</pre>
    </>
  );
}
