'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSettings } from '@/lib/clientState';
import Insights from './Insights';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.GeideaCheckout && window.__gdSdk === src) return resolve();
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => { window.__gdSdk = src; resolve(); };
    el.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(el);
  });
}

export default function CardsClient({ tokens, pub }) {
  const router = useRouter();
  const [s, setS] = useSettings();
  const [save, setSave] = useState({ usage: 'CIT', currency: 'AED' });
  const [mit, setMit] = useState({ tokenId: '', agreementId: '', agreementType: 'Unscheduled', amount: '1.00', currency: 'AED', operation: 'Pay' });
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);

  async function standalone() {
    setBusy('save'); setResult(null);
    try {
      const r = await fetch('/api/tokens/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ env: s.env, ...save }) });
      const j = await r.json();
      if (!r.ok) { setResult({ error: j.error, insights: j.insights, ref: j.ref }); return; }
      await loadScript(j.sdkUrl);
      const back = () => router.refresh();
      new window.GeideaCheckout(back, back, back).startPayment(j.sessionId);
    } catch (e) { setResult({ error: e.message }); } finally { setBusy(''); }
  }
  async function chargeMit() {
    setBusy('mit'); setResult(null);
    const r = await fetch('/api/tokens/mit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ env: s.env, ...mit }) });
    const j = await r.json();
    setBusy('');
    setResult(r.ok ? { ref: j.ref, insights: j.insights, ok: j.ok } : { error: j.error });
    router.refresh();
  }
  async function remove(id) {
    await fetch(`/api/tokens/${id}`, { method: 'DELETE' });
    router.refresh();
  }
  const pick = (t) => setMit({ ...mit, tokenId: t.token_id || '', agreementId: t.agreement_id || '', agreementType: t.agreement_type || 'Unscheduled' });
  const ccys = Array.from(new Set(['AED', ...pub.currencies]));

  return (
    <div>
      <h1>Saved cards</h1>
      <p className="sub">Tokens created here or during checkout. Environment follows the shop setting: <span className="pill">{s.env}</span></p>
      <div className="grid g2">
        <div className="card">
          <h2>Save a card (no payment)</h2>
          <p className="muted" style={{ fontSize: 12 }}>POST /payment-intent/api/v1/direct/session/saveCard, then the HPP collects the card. Tokenization must be enabled on the MID.</p>
          <label className="f">Use the card for</label>
          <select value={save.usage} onChange={(e) => setSave({ ...save, usage: e.target.value })}><option value="CIT">CIT: customer pays later (CVV / OTP)</option><option value="MIT">MIT: merchant charges later</option><option value="CIT+MIT">CIT + MIT</option></select>
          <label className="f">Currency</label>
          <select value={save.currency} onChange={(e) => setSave({ ...save, currency: e.target.value })}>{ccys.map((c) => <option key={c}>{c}</option>)}</select>
          <div style={{ marginTop: 12 }}><button disabled={!!busy} onClick={standalone}>{busy === 'save' ? 'Opening…' : 'Save a card'}</button></div>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>For an MIT agreement token, it is usually better to save during a payment: Shop → Save card → MIT. That sends cardOnFile and a cofAgreement.</p>
        </div>
        <div className="card">
          <h2>Charge a token (MIT)</h2>
          <p className="muted" style={{ fontSize: 12 }}>Session with initiatedBy Merchant + agreement, then POST /pgw/api/v2/direct/pay/token. No payment page, no 3DS.</p>
          <label className="f">Token ID</label><input value={mit.tokenId} onChange={(e) => setMit({ ...mit, tokenId: e.target.value })} />
          <label className="f">Agreement ID</label><input value={mit.agreementId} onChange={(e) => setMit({ ...mit, agreementId: e.target.value })} />
          <div className="grid g3">
            <div><label className="f">Agreement type</label><select value={mit.agreementType} onChange={(e) => setMit({ ...mit, agreementType: e.target.value })}><option>Unscheduled</option><option>Recurring</option></select></div>
            <div><label className="f">Amount</label><input value={mit.amount} onChange={(e) => setMit({ ...mit, amount: e.target.value })} /></div>
            <div><label className="f">Currency</label><select value={mit.currency} onChange={(e) => setMit({ ...mit, currency: e.target.value })}>{ccys.map((c) => <option key={c}>{c}</option>)}</select></div>
          </div>
          <label className="f">Operation</label>
          <select value={mit.operation} onChange={(e) => setMit({ ...mit, operation: e.target.value })}><option value="Pay">Sale</option><option value="PreAuthorize">Pre-auth</option></select>
          <div style={{ marginTop: 12 }}><button disabled={!!busy} onClick={chargeMit}>{busy === 'mit' ? 'Charging…' : 'Charge (MIT)'}</button></div>
        </div>
      </div>
      {result && (
        <div className="card">
          {result.error && <div className="msg bad">{result.error}</div>}
          {result.ref && <p>Order <Link className="mono" href={`/orders/${result.ref}`}>{result.ref}</Link></p>}
          {result.insights && <Insights items={result.insights} />}
        </div>
      )}
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Card</th><th>Use</th><th>Status</th><th>Token / agreement</th><th>Actions</th></tr></thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id}>
                <td>{t.card?.brand ? `${t.card.brand} ${t.card.masked || ''}` : `Card #${t.id}`}<div className="muted" style={{ fontSize: 12 }}>{t.env} · {t.source === 'payment' ? 'saved at payment' : 'stand-alone'} · {new Date(t.created_at).toLocaleString()} · {t.created_by}{t.order_ref && <> · <Link href={`/orders/${t.order_ref}`}>{t.order_ref}</Link></>}</div></td>
                <td>{t.usage}</td>
                <td><span className={`pill ${t.status === 'ACTIVE' ? 'good' : t.status === 'FAILED' ? 'bad' : 'warn'}`}>{t.status}</span></td>
                <td className="mono">{t.token_id || '—'}{t.agreement_id && <div className="muted">agr: {t.agreement_id} ({t.agreement_type})</div>}</td>
                <td><div className="row">
                  {t.token_id && t.usage !== 'MIT' && <button className="ghost" onClick={() => setS({ ...s, tokenId: t.token_id, env: t.env })}>{s.tokenId === t.token_id ? 'Selected for CIT' : 'Use at checkout (CIT)'}</button>}
                  {t.token_id && t.agreement_id && <button className="ghost" onClick={() => pick(t)}>Charge (MIT)</button>}
                  <button className="ghost" onClick={() => remove(t.id)}>Remove</button>
                </div></td>
              </tr>
            ))}
            {!tokens.length && <tr><td colSpan={5} className="muted">No saved cards yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
