'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useSettings, useCart } from '@/lib/clientState';
import { SettingsChips } from '@/components/SettingsPanel';
import Insights from '@/components/Insights';
import { PRODUCTS } from '@/lib/products';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.GeideaCheckout && window.__gdSdk === src) return resolve();
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => { window.__gdSdk = src; resolve(); };
    el.onerror = () => reject(new Error(`Could not load the Geidea checkout script from ${src}. The session was created; your browser could not reach the SDK host (network, VPN, firewall or ad-blocker). Open ${src} in a new tab to check.`));
    document.head.appendChild(el);
  });
}

export default function Checkout() {
  const [s] = useSettings();
  const [cart, setCart] = useCart();
  const [c, setC] = useState({ firstName: 'Test', lastName: 'Customer', email: 'test@example.com', phone: '', phoneCountryCode: '+971', city: 'Dubai', street: '' });
  const [customAmount, setCustomAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const lines = Object.entries(cart.items).filter(([, q]) => q > 0).map(([id, q]) => ({ p: PRODUCTS.find((x) => x.id === id), q })).filter((l) => l.p);
  const total = lines.reduce((a, l) => a + l.p.price * l.q, 0);
  const amount = customAmount !== '' ? Number(customAmount) : total;
  const setQty = (id, q) => setCart((x) => ({ items: { ...x.items, [id]: Math.max(0, q) } }));

  async function pay() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: cart.items, settings: s, customer: c, customAmount }) });
      const j = await r.json();
      if (!r.ok) { setErr(j); setBusy(false); return; }
      const go = (outcome) => { window.location.href = `/return?ref=${encodeURIComponent(j.ref)}&sdk=${outcome}`; };
      if (j.mode === 'redirect') { window.location.href = j.hppUrl; return; }
      await loadScript(j.sdkUrl);
      const payment = new window.GeideaCheckout(() => go('success'), () => go('error'), () => go('cancel'));
      payment.startPayment(j.sessionId);
      setBusy(false);
    } catch (e) {
      setErr({ error: e.message });
      setBusy(false);
    }
  }

  const f = (k, label, type = 'text') => (<div><label className="f">{label}</label><input type={type} value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} /></div>);
  return (
    <div>
      <SettingsChips s={s} />
      <h1>Checkout</h1>
      <p className="sub">Change gateway options on the <Link href="/">Shop</Link> page.</p>
      <div className="grid g2">
        <div className="card">
          <h2>Customer</h2>
          <div className="grid g2">{f('firstName', 'First name')}{f('lastName', 'Last name')}</div>
          {f('email', 'Email', 'email')}
          <div className="grid g2">{f('phoneCountryCode', 'Country code')}{f('phone', 'Phone')}</div>
          <div className="grid g2">{f('city', 'City')}{f('street', 'Street')}</div>
        </div>
        <div className="card">
          <h2>Order</h2>
          {lines.length === 0 && <p className="muted">Cart is empty. Add items in the shop or set a custom amount.</p>}
          <table><tbody>
            {lines.map(({ p, q }) => (
              <tr key={p.id}><td>{p.name}</td><td style={{ width: 120 }}><div className="row"><button className="ghost" onClick={() => setQty(p.id, q - 1)}>−</button>{q}<button className="ghost" onClick={() => setQty(p.id, q + 1)}>+</button></div></td><td className="right">{(p.price * q).toFixed(2)}</td></tr>
            ))}
          </tbody></table>
          <label className="f">Custom amount (overrides cart, e.g. to test decline amounts)</label>
          <input type="number" step="0.01" min="0" value={customAmount} onChange={(e) => setCustomAmount(e.target.value)} placeholder={total.toFixed(2)} />
          <div className="kv" style={{ marginTop: 14 }}>
            <div>Operation</div><div>{s.operation === 'Pay' ? 'Sale (charged now)' : 'Pre-authorization (capture later from the order page)'}</div>
            <div>Authentication</div><div>{s.auth === 'moto' ? 'MOTO (no 3DS)' : '3-D Secure'}</div>
            <div>Card</div><div>{s.tokenId ? `Saved token ${s.tokenId.slice(0, 8)}… (CVV only)` : 'New card'}{s.saveCard !== 'none' ? ` · save as ${s.saveCard.toUpperCase()}` : ''}</div>
          </div>
          <div style={{ marginTop: 16 }}><button onClick={pay} disabled={busy || !(amount > 0)}>{busy ? 'Opening payment page…' : `Pay ${s.currency} ${(amount || 0).toFixed(2)}`}</button></div>
          {err && (
            <div style={{ marginTop: 14 }}>
              <div className="msg bad">{err.error}{err.ref && <> · <Link href={`/orders/${err.ref}`}>open order {err.ref}</Link></>}</div>
              {err.insights && <Insights items={err.insights} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
