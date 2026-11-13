'use client';
import { useState } from 'react';
import { useSettings } from '@/lib/clientState';
import Insights from '@/components/Insights';

export default function Lookup() {
  const [s] = useSettings();
  const [env, setEnv] = useState(null);
  const [orderId, setOrderId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const e = env || s.env;

  async function go(ev) {
    ev.preventDefault();
    setBusy(true); setErr(null);
    const r = await fetch('/api/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ env: e, orderId }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErr(j);
    window.location.href = `/orders/${encodeURIComponent(j.ref)}`;
  }
  return (
    <div>
      <h1>Order lookup</h1>
      <p className="sub">Fetch any Geidea order on this environment's MID by its order ID (for example one made through BESO), then capture, void or refund it from the order page.</p>
      <form className="card" onSubmit={go} style={{ maxWidth: 640 }}>
        <label className="f">Environment</label>
        <div className="seg">
          {[['test', 'Test'], ['staging', 'Staging'], ['production', 'Production']].map(([v, l]) => (
            <button type="button" key={v} className={e === v ? 'on' : ''} onClick={() => setEnv(v)}>{l}</button>
          ))}
        </div>
        <label className="f">Geidea order ID</label>
        <input className="mono" placeholder="1c65a2c8-12c4-4098-f3cd-08df31653829" value={orderId} onChange={(x) => setOrderId(x.target.value)} />
        <p className="muted" style={{ fontSize: 12 }}>Uses the credentials saved for this environment, so the order must belong to that MID. Actions on Production move real money.</p>
        <button disabled={busy || !orderId.trim()}>{busy ? 'Fetching…' : 'Fetch order'}</button>
        {err && <div style={{ marginTop: 12 }}><div className="msg bad">{err.error}</div>{err.insights && <Insights items={err.insights} />}</div>}
      </form>
    </div>
  );
}
