'use client';
import { useEffect, useState } from 'react';
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
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ ok: r.ok, j: await r.json().catch(() => ({})) }));

const STATUS = {
  ACTIVE: ['Ready to use', 'good'],
  PENDING: ['Waiting for Geidea', 'warn'],
  FAILED: ['Not saved', 'bad'],
  CANCELLED: ['Cancelled', ''],
};
const exp = (e) => (e?.month ? `${String(e.month).padStart(2, '0')}/${String(e.year).slice(-2)}` : '');

function CardFace({ t }) {
  const c = t.card || {};
  const brand = (c.brand || '').toLowerCase();
  return (
    <div className={`cardface ${brand}`}>
      <div className="cf-bank">{c.issuer || 'Bank not known yet'}</div>
      <div className="cf-number">{c.masked ? c.masked.replace(/\*+/, ' •••• •••• ') : '•••• •••• •••• ••••'}</div>
      <div className="cf-foot"><span>{exp(c.expiry) || 'MM/YY'}</span><span className="cf-brand">{c.brand || 'card'}</span></div>
    </div>
  );
}

function SavedCard({ t, s, setS, ccys, onChanged }) {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [mitOpen, setMitOpen] = useState(false);
  const [mit, setMit] = useState({ amount: '1.00', currency: 'AED', operation: 'Pay' });
  const [result, setResult] = useState(null);
  const [st, tone] = STATUS[t.status] || [t.status, ''];
  const isMpgs = t.route === 'mpgs';
  const sc = t.scheme;
  const canMit = t.status === 'ACTIVE' && t.token_id && t.agreement_id;
  const canCit = t.status === 'ACTIVE' && t.token_id;

  async function check() {
    setBusy('check'); setResult(null);
    const { ok, j } = await post('/api/tokens/check', { id: t.id });
    setBusy('');
    if (!ok) setResult({ error: j.error });
    onChanged();
  }
  async function retryToken() {
    setBusy('retry'); setResult(null);
    const { ok, j } = await post('/api/tokens/mpgs-retry', { id: t.id });
    setBusy('');
    setResult(ok ? { insights: j.insights } : { error: j.error, insights: j.insights });
    onChanged();
  }
  async function checkScheme() {
    setBusy('scheme'); setResult(null);
    const { ok, j } = await post('/api/tokens/mpgs-check', { id: t.id });
    setBusy('');
    setResult(ok ? { insights: j.insights } : { error: j.error, insights: j.insights });
    onChanged();
  }
  async function chargeMit() {
    setBusy('mit'); setResult(null);
    const { ok, j } = isMpgs
      ? await post('/api/tokens/mpgs-mit', { env: t.env, token: t.token_id, agreementId: t.agreement_id, agreementType: t.agreement_type || 'Unscheduled', ...mit })
      : await post('/api/tokens/mit', { env: t.env, tokenId: t.token_id, agreementId: t.agreement_id, agreementType: t.agreement_type || 'Unscheduled', ...mit });
    setBusy('');
    setResult(ok ? { ref: j.ref, insights: j.insights } : { error: j.error });
    onChanged();
  }
  function payCit() {
    setS(isMpgs ? { ...s, route: 'mpgs', mpgsToken: t.token_id, mpgsAgreementId: t.agreement_id || '', saveCard: 'none', env: t.env, auth: '3ds' } : { ...s, route: 'geidea', tokenId: t.token_id, env: t.env, auth: '3ds' });
    router.push('/checkout');
  }
  async function remove() {
    await fetch(`/api/tokens/${t.id}`, { method: 'DELETE' });
    onChanged();
  }

  return (
    <div className="savedcard">
      <CardFace t={t} />
      <div className="sc-body">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row"><span className={`pill ${tone}`}>{st}</span><span className="muted" style={{ fontSize: 13 }}>{t.env === 'production' ? 'Production' : t.env === 'staging' ? 'Staging' : 'Test'} · {isMpgs ? 'MPGS direct' : 'Geidea PGW'}</span></div>
          <button className="ghost small" onClick={remove}>Remove</button>
        </div>
        {t.note && <p className="sc-note">{t.note}</p>}
        <dl className="sc-facts">
          <dt>Token ID</dt><dd className="mono">{t.token_id || 'Not received yet'}</dd>
          <dt>Can be used for</dt><dd>{t.usage === 'CIT' ? 'Customer payments (CIT): the customer enters only CVV / OTP' : t.usage === 'MIT' ? 'Merchant charges (MIT) without the customer' : 'Customer payments (CIT) and merchant charges (MIT)'}</dd>
          {t.agreement_id && (<><dt>MIT agreement</dt><dd><span className="mono">{t.agreement_id}</span> ({t.agreement_type || 'Unscheduled'})</dd></>)}
          <dt>Token type</dt><dd>{isMpgs ? 'MPGS gateway token (saved through MPGS direct, not known to PGW)' : 'Geidea gateway token'}</dd>
          <dt>Network token</dt><dd>{!sc ? <span className="muted">Not checked on MPGS yet{isMpgs ? '' : '. PGW keeps an MPGS token under the Geidea token ID without dashes, if the card went through MPGS.'}</span>
            : !sc.found ? <span>Not found on MPGS{sc.error ? ` (${sc.error})` : ''}. {isMpgs ? '' : 'The card may have been processed on CYBS, or saved before PGW created MPGS tokens.'}</span>
            : sc.provider ? <span><b>Yes, {sc.provider === 'VTS' ? 'Visa (VTS)' : sc.provider === 'MDES' ? 'Mastercard (MDES)' : sc.provider}</b>{sc.status ? `, ${sc.status}` : ''} · repository {sc.repositoryId}</span>
            : <span>No network token yet · repository {sc.repositoryId}. Provisioning is asynchronous; check again later.</span>}
            {t.checked_at && <span className="muted" style={{ fontSize: 12 }}> · checked {new Date(t.checked_at).toLocaleString()}</span>}</dd>
          <dt>Card</dt><dd>{[t.card?.funding && t.card.funding.toLowerCase(), t.card?.brand].filter(Boolean).join(' ') || 'Details arrive with the save result'}{t.card?.issuer ? `, ${t.card.issuer}` : ''}</dd>
          <dt>Saved</dt><dd>{new Date(t.created_at).toLocaleString()} by {t.created_by}, {t.source === 'payment' ? 'during payment ' : 'without a payment '}{t.order_ref && <Link href={`/orders/${t.order_ref}`} className="mono">{t.order_ref}</Link>}</dd>
          {t.last_used_at && (<><dt>Last used</dt><dd>{new Date(t.last_used_at).toLocaleString()} on <Link href={`/orders/${t.last_used_ref}`} className="mono">{t.last_used_ref}</Link></dd></>)}
        </dl>
        <div className="row">
          {canCit && t.usage !== 'MIT' && <button onClick={payCit}>Pay with this card (CIT)</button>}
          {canMit && <button className={mitOpen ? 'ghost' : ''} onClick={() => setMitOpen(!mitOpen)}>{mitOpen ? 'Close MIT' : 'Charge without the customer (MIT)'}</button>}
          {t.status !== 'ACTIVE' && !isMpgs && <button className="ghost" disabled={!!busy} onClick={check}>{busy === 'check' ? 'Checking…' : 'Check status with Geidea'}</button>}
          {isMpgs && !t.token_id && t.order_ref && <button disabled={!!busy} onClick={retryToken}>{busy === 'retry' ? 'Tokenizing…' : 'Retry token creation'}</button>}
          {t.token_id && <button className="ghost" disabled={!!busy} onClick={checkScheme}>{busy === 'scheme' ? 'Asking MPGS…' : 'Check network token on MPGS'}</button>}
        </div>
        {t.status === 'ACTIVE' && t.usage !== 'CIT' && !t.agreement_id && <p className="sc-note">No MIT agreement is stored for this card, so it can't be charged without the customer. Save it during a payment with Save card set to MIT.</p>}
        {mitOpen && (
          <div className="sc-mit">
            <div className="grid g3">
              <div><label className="f">Amount</label><input value={mit.amount} onChange={(e) => setMit({ ...mit, amount: e.target.value })} /></div>
              <div><label className="f">Currency</label><select value={mit.currency} onChange={(e) => setMit({ ...mit, currency: e.target.value })}>{ccys.map((c) => <option key={c}>{c}</option>)}</select></div>
              <div><label className="f">Operation</label><select value={mit.operation} onChange={(e) => setMit({ ...mit, operation: e.target.value })}><option value="Pay">Sale</option><option value="PreAuthorize">Pre-auth</option></select></div>
            </div>
            <div style={{ marginTop: 12 }}><button disabled={!!busy} onClick={chargeMit}>{busy === 'mit' ? 'Charging…' : `Charge ${mit.currency} ${Number(mit.amount || 0).toFixed(2)}`}</button></div>
          </div>
        )}
        {result?.error && <div className="msg bad">{result.error}</div>}
        {result?.ref && <p>MIT order <Link className="mono" href={`/orders/${result.ref}`}>{result.ref}</Link></p>}
        {result?.insights && <Insights items={result.insights} />}
      </div>
    </div>
  );
}

export default function CardsClient({ tokens, pub }) {
  const router = useRouter();
  const [s, setS] = useSettings();
  const [usage, setUsage] = useState('CIT');
  const [currency, setCurrency] = useState('AED');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [manual, setManual] = useState({ tokenId: '', agreementId: '', agreementType: 'Unscheduled', amount: '1.00', currency: 'AED', operation: 'Pay' });
  const [manualRes, setManualRes] = useState(null);
  const ccys = Array.from(new Set(['AED', ...pub.currencies]));

  // Redirect flow: /cards?saved=<ref> → ask Geidea for the result straight away
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('saved');
    if (ref) post('/api/tokens/check', { ref }).then(() => { window.history.replaceState(null, '', '/cards'); router.refresh(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveNew() {
    setBusy(true); setErr(null);
    try {
      const { ok, j } = await post('/api/tokens/save', { env: s.env, usage, currency });
      if (!ok) { setErr({ error: j.error, insights: j.insights }); return; }
      await loadScript(j.sdkUrl);
      const done = (outcome) => async (data) => { await post('/api/tokens/check', { ref: j.ref, outcome, data: data ?? null }); router.refresh(); };
      new window.GeideaCheckout(done('success'), done('error'), done('cancel')).startPayment(j.sessionId);
    } catch (e) { setErr({ error: e.message }); } finally { setBusy(false); }
  }
  async function chargeManual() {
    const { ok, j } = await post('/api/tokens/mit', { env: s.env, ...manual });
    setManualRes(ok ? { ref: j.ref, insights: j.insights } : { error: j.error });
    router.refresh();
  }

  const active = tokens.filter((t) => t.status === 'ACTIVE');
  const other = tokens.filter((t) => t.status !== 'ACTIVE');
  return (
    <div>
      <h1>Saved cards</h1>
      <p className="sub">Cards saved as Geidea tokens or, through MPGS direct, as MPGS tokens. Pay with one as the customer (CIT), charge it without the customer (MIT) when it has an agreement, or ask MPGS whether a network token sits behind it.</p>

      <div className="grid cards-layout">
        <div>
          {!tokens.length && <div className="card"><p style={{ margin: 0 }}>No saved cards yet. Save one on the right, or tick Save card in the shop settings before paying.</p></div>}
          {active.map((t) => <SavedCard key={t.id} t={t} s={s} setS={setS} ccys={ccys} onChanged={() => router.refresh()} />)}
          {other.length > 0 && <h2 style={{ marginTop: 24 }}>Not ready</h2>}
          {other.map((t) => <SavedCard key={t.id} t={t} s={s} setS={setS} ccys={ccys} onChanged={() => router.refresh()} />)}
        </div>

        <div>
          <div className="card">
            <h2>Save a new card</h2>
            <p className="muted" style={{ fontSize: 14, marginTop: 0 }}>Opens the Geidea card form without charging anything. Uses the {s.env} credentials. To save an MPGS token, pay through MPGS direct with Save card on.</p>
            <label className="f">The card will be used for</label>
            <div className="seg">
              {[['CIT', 'Customer payments'], ['MIT', 'Merchant charges'], ['CIT+MIT', 'Both']].map(([v, l]) => <button key={v} type="button" className={usage === v ? 'on' : ''} onClick={() => setUsage(v)}>{l}</button>)}
            </div>
            {usage !== 'CIT' && <p className="sc-note">Merchant charges need an agreement ID. A stand-alone save doesn't create one, so save during a payment instead (shop settings: Save card set to MIT).</p>}
            <label className="f">Currency</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>{ccys.map((c) => <option key={c}>{c}</option>)}</select>
            <div style={{ marginTop: 14 }}><button disabled={busy} onClick={saveNew}>{busy ? 'Opening card form…' : 'Open card form'}</button></div>
            {err && <div style={{ marginTop: 10 }}><div className="msg bad">{err.error}</div>{err.insights && <Insights items={err.insights} />}</div>}
          </div>

          <details className="card">
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Charge a token that isn't in this list (MIT)</summary>
            <label className="f">Token ID</label><input className="mono" value={manual.tokenId} onChange={(e) => setManual({ ...manual, tokenId: e.target.value })} />
            <label className="f">Agreement ID</label><input className="mono" value={manual.agreementId} onChange={(e) => setManual({ ...manual, agreementId: e.target.value })} />
            <div className="grid g2">
              <div><label className="f">Amount</label><input value={manual.amount} onChange={(e) => setManual({ ...manual, amount: e.target.value })} /></div>
              <div><label className="f">Currency</label><select value={manual.currency} onChange={(e) => setManual({ ...manual, currency: e.target.value })}>{ccys.map((c) => <option key={c}>{c}</option>)}</select></div>
            </div>
            <label className="f">Agreement type</label>
            <select value={manual.agreementType} onChange={(e) => setManual({ ...manual, agreementType: e.target.value })}><option>Unscheduled</option><option>Recurring</option></select>
            <div style={{ marginTop: 12 }}><button onClick={chargeManual} disabled={!manual.tokenId || !manual.agreementId}>Charge</button></div>
            {manualRes?.error && <div className="msg bad">{manualRes.error}</div>}
            {manualRes?.ref && <p>MIT order <Link className="mono" href={`/orders/${manualRes.ref}`}>{manualRes.ref}</Link></p>}
            {manualRes?.insights && <Insights items={manualRes.insights} />}
          </details>
        </div>
      </div>
    </div>
  );
}
