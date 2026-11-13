'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function OrderActions({ refId, currency, detailed, authorized, captured, refunded, amount }) {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [capAmt, setCapAmt] = useState((authorized - captured || amount).toFixed(2));
  const [refAmt, setRefAmt] = useState((captured - refunded || 0).toFixed(2));

  async function act(type, amt) {
    setBusy(type); setMsg(null);
    const r = await fetch(`/api/orders/${encodeURIComponent(refId)}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, amount: amt }) });
    const j = await r.json().catch(() => ({}));
    setBusy('');
    setMsg(r.ok ? { tone: j.ok ? 'good' : 'bad', text: j.summary } : { tone: 'bad', text: j.error });
    router.refresh();
  }
  const canCapture = detailed === 'Authorized' && authorized > captured;
  const canVoid = detailed === 'Authorized' || (detailed === 'Paid' && refunded === 0);
  const canRefund = captured > refunded;
  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="ghost" disabled={!!busy} onClick={() => act('fetch')}>{busy === 'fetch' ? 'Fetching…' : 'Fetch order from Geidea'}</button>
      </div>
      <label className="f">Capture ({currency})</label>
      <div className="row"><input style={{ width: 120 }} value={capAmt} onChange={(e) => setCapAmt(e.target.value)} /><button disabled={!!busy || !canCapture} onClick={() => act('capture', capAmt)}>{busy === 'capture' ? 'Capturing…' : 'Capture'}</button></div>
      <label className="f">Refund ({currency})</label>
      <div className="row"><input style={{ width: 120 }} value={refAmt} onChange={(e) => setRefAmt(e.target.value)} /><button disabled={!!busy || !canRefund} onClick={() => act('refund', refAmt)}>{busy === 'refund' ? 'Refunding…' : 'Refund'}</button></div>
      <label className="f">Void</label>
      <div className="row"><button className="danger" disabled={!!busy || !canVoid} onClick={() => act('void')}>{busy === 'void' ? 'Voiding…' : 'Void (release / cancel)'}</button></div>
      <p className="muted" style={{ fontSize: 12 }}>Buttons follow the last fetched status. Fetch first if they look wrong.</p>
      {msg && <div className={`msg ${msg.tone}`}>{msg.text}</div>}
    </div>
  );
}
