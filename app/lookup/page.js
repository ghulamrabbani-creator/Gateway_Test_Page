'use client';
import { useState } from 'react';
import { useSettings } from '@/lib/clientState';
import Insights from '@/components/Insights';
import CopyButton from '@/components/CopyButton';

const GW = {
  geidea: { label: 'Geidea order', field: 'Geidea order ID', ph: '1c65a2c8-12c4-4098-f3cd-08df31653829', note: "Imports the order into this shop so you can capture, void or refund it. Uses the environment's Geidea credentials, so the order must belong to that MID." },
  mpgs: { label: 'MPGS order', field: 'MPGS order ID', ph: 'Geidea orderId for a PGW order, or MP-… for a direct one', note: 'View only, straight from MPGS: shows what PGW (or the shop) actually sent, e.g. sourceOfFunds.type SCHEME_TOKEN vs CARD. For a PGW order the MPGS order ID is the Geidea orderId. Uses the MPGS merchant ID set for this environment.' },
  cybs: { label: 'CYBS transaction', field: 'CYBS transaction / payment ID', ph: '7943857634526797404891', note: 'View only, from CYBS Transaction Search (/tss/v2/transactions). Shows the token BIN, paymentSolution 014/015 and the network transaction ID. Uses the CYBS merchant ID set for this environment.' },
};

export default function Lookup() {
  const [s] = useSettings();
  const [env, setEnv] = useState(null);
  const [gw, setGw] = useState('geidea');
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [res, setRes] = useState(null);
  const e = env || s.env;

  async function go(ev) {
    ev.preventDefault();
    setBusy(true); setErr(null); setRes(null);
    const geidea = gw === 'geidea';
    const r = await fetch(geidea ? '/api/lookup' : '/api/lookup/gateway', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(geidea ? { env: e, orderId: id } : { env: e, gateway: gw, id }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErr(j);
    if (geidea) window.location.href = `/orders/${encodeURIComponent(j.ref)}`;
    else setRes(j);
  }
  const raw = res ? JSON.stringify(res.body ?? res.error, null, 2) : '';
  return (
    <div>
      <h1>Order lookup</h1>
      <p className="sub">Fetch an order by ID: a Geidea order to manage it here, or the same payment as MPGS or CYBS sees it.</p>
      <form className="card" onSubmit={go} style={{ maxWidth: 720 }}>
        <label className="f">Look up</label>
        <div className="seg">{Object.entries(GW).map(([k, v]) => <button type="button" key={k} className={gw === k ? 'on' : ''} onClick={() => { setGw(k); setRes(null); setErr(null); }}>{v.label}</button>)}</div>
        <label className="f">Environment</label>
        <div className="seg">
          {[['test', 'Test'], ['staging', 'Staging'], ['production', 'Production']].map(([v, l]) => (
            <button type="button" key={v} className={e === v ? 'on' : ''} onClick={() => setEnv(v)}>{l}</button>
          ))}
        </div>
        <label className="f">{GW[gw].field}</label>
        <input className="mono" placeholder={GW[gw].ph} value={id} onChange={(x) => setId(x.target.value)} />
        <p className="muted" style={{ fontSize: 12 }}>{GW[gw].note}</p>
        <button disabled={busy || !id.trim()}>{busy ? 'Fetching…' : 'Fetch'}</button>
        {err && <div style={{ marginTop: 12 }}><div className="msg bad">{err.error}</div>{err.insights && <Insights items={err.insights} />}</div>}
      </form>
      {res && (
        <div className="card">
          <h2>Key insights</h2>
          <Insights items={res.insights} />
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}><h3 style={{ margin: 0 }}>Response (HTTP {res.status})</h3><CopyButton text={raw} /></div>
          <pre className="json">{raw}</pre>
        </div>
      )}
    </div>
  );
}
