'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSettings } from '@/lib/clientState';
import Insights from './Insights';
import { fmtDT } from '@/lib/time';

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

function SavedCard({ t, s, setS, onChanged, me, repeatOf }) {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const [st, tone] = STATUS[t.status] || [t.status, ''];
  const isMpgs = t.route === 'mpgs';
  const isCybs = t.route === 'cybs';
  const gwName = isCybs ? 'CYBS' : 'MPGS';
  const sc = t.scheme;
  // PGW keeps the MPGS token under the Geidea token ID without dashes, upper case
  const mpgsFromGeidea = !isMpgs && !isCybs && t.token_id ? t.token_id.replace(/-/g, '').toUpperCase() : '';
  const own = t.created_by === me;
  // Payments start on the Transaction page, whose pickers hold only your own cards
  const canMit = own && t.status === 'ACTIVE' && t.token_id && t.agreement_id;
  const canCit = own && t.status === 'ACTIVE' && t.token_id;

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
  // R19: payments start on the Transaction page with this card picked
  function openTxn(txType) {
    setS({ ...s, env: t.env, route: t.route || 'geidea', txType, [txType === 'mit' ? 'mitId' : 'citId']: t.id });
    router.push('/');
  }
  async function remove() {
    if (!own && !window.confirm(`Remove ${t.created_by}'s card from the shop?`)) return;
    await fetch(`/api/tokens/${t.id}`, { method: 'DELETE' });
    onChanged();
  }

  return (
    <div className="savedcard">
      <CardFace t={t} />
      <div className="sc-body">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row"><span className={`pill ${tone}`}>{st}</span>{repeatOf && <span className="pill warn">Repeat save · same token</span>}{!own && <span className="pill owner">Belongs to {t.created_by || 'nobody'}</span>}<span className="muted" style={{ fontSize: 13 }}>{t.env === 'production' ? 'Production' : t.env === 'staging' ? 'Staging' : 'Test'} · {isCybs ? 'CYBS direct' : isMpgs ? 'MPGS direct' : 'Geidea PGW'}</span></div>
          <button className="ghost small" onClick={remove}>Remove</button>
        </div>
        {t.note && <p className="sc-note">{t.note}</p>}
        {repeatOf && <p className="sc-note">The same card was saved again and {isCybs ? 'CYBS' : isMpgs ? 'MPGS' : 'PGW'} returned the token it already had (first saved {fmtDT(repeatOf.created_at)} on <Link href={`/orders/${repeatOf.order_ref}`} className="mono">{repeatOf.order_ref}</Link>). No new token was created; this entry only records this save{t.agreement_id ? ' and its MIT agreement' : ''}.</p>}
        <dl className="sc-facts">
          <dt>{isCybs ? 'CYBS instrument identifier' : isMpgs ? 'MPGS token' : 'Geidea token'}</dt><dd className="mono">{t.token_id || 'Not received yet'}</dd>
          {mpgsFromGeidea && (<><dt>MPGS token</dt><dd><span className="mono">{mpgsFromGeidea}</span> {sc?.found ? <span className="muted">(found on MPGS)</span> : sc && !sc.found ? <span className="muted">(not found in the repository linked to the MID now: it may sit in another repository, or the card went through CYBS)</span> : <span className="muted">(expected value if the card went through MPGS; confirm with "Check network token on MPGS")</span>}</dd></>)}
          <dt>Can be used for</dt><dd>{t.usage === 'CIT' ? 'Customer payments (CIT): the customer enters only CVV / OTP' : t.usage === 'MIT' ? 'Merchant charges (MIT) without the customer' : 'Customer payments (CIT) and merchant charges (MIT)'}</dd>
          {t.agreement_id && (<><dt>{isCybs ? 'First CIT network txn ID' : 'MIT agreement'}</dt><dd><span className="mono">{t.agreement_id}</span>{isCybs ? ' (sent as previousTransactionId on MITs)' : ` (${t.agreement_type || 'Unscheduled'})`}</dd></>)}
          <dt>Saved through</dt><dd>{isCybs ? 'CYBS direct (not known to PGW)' : isMpgs ? 'MPGS direct (not known to PGW)' : 'Geidea PGW'}</dd>
          <dt>Token repository</dt><dd>{isCybs ? 'CYBS TMS' : sc?.repositoryId ? <span className="mono">{sc.repositoryId}</span> : sc && !sc.found ? <span className="muted">Not found on MPGS</span> : <span className="muted">Not known yet: use "Check network token on MPGS"</span>}</dd>
          <dt>Network token</dt><dd>{!sc ? <span className="muted">Not checked on {gwName} yet{isMpgs || isCybs ? '' : '. PGW keeps an MPGS token under the Geidea token ID without dashes, if the card went through MPGS.'}</span>
            : !sc.found ? <span>Not found on {gwName}{sc.error ? ` (${sc.error})` : ''}. {isMpgs || isCybs ? '' : 'MPGS only searches the repository linked to the MID now, so the token may sit in another repository (e.g. after a repository change). Otherwise the card went through CYBS, or was saved before PGW created MPGS tokens.'}</span>
            : sc.provider ? <span><b>Yes, {sc.provider === 'VTS' ? 'Visa (VTS)' : sc.provider === 'MDES' ? 'Mastercard (MDES)' : sc.provider}</b>{sc.status ? `, ${sc.status}` : ''}{sc.number ? ` · ${sc.number}` : ''}{sc.expiry ? ` exp ${sc.expiry}` : ''}</span>
            : <span>No network token yet. Provisioning is asynchronous; check again later (or NT is off for the repository).</span>}
            {t.checked_at && <span className="muted" style={{ fontSize: 12 }}> · checked {fmtDT(t.checked_at)}</span>}</dd>
          <dt>Card</dt><dd>{[t.card?.funding && t.card.funding.toLowerCase(), t.card?.brand].filter(Boolean).join(' ') || 'Details arrive with the save result'}{t.card?.issuer ? `, ${t.card.issuer}` : ''}</dd>
          <dt>Saved</dt><dd>{fmtDT(t.created_at)} by {t.created_by}, {t.source === 'payment' ? 'during payment ' : 'without a payment '}{t.order_ref && <Link href={`/orders/${t.order_ref}`} className="mono">{t.order_ref}</Link>}</dd>
          {t.last_used_at && (<><dt>Last used</dt><dd>{fmtDT(t.last_used_at)} on <Link href={`/orders/${t.last_used_ref}`} className="mono">{t.last_used_ref}</Link></dd></>)}
        </dl>
        <div className="row">
          {canCit && t.usage !== 'MIT' && <button onClick={() => openTxn('cit')}>Pay with this card (CIT)</button>}
          {canMit && <button onClick={() => openTxn('mit')}>Charge without the customer (MIT)</button>}
          {t.status !== 'ACTIVE' && !isMpgs && <button className="ghost" disabled={!!busy} onClick={check}>{busy === 'check' ? 'Checking…' : 'Check status with Geidea'}</button>}
          {isMpgs && !t.token_id && t.order_ref && <button disabled={!!busy} onClick={retryToken}>{busy === 'retry' ? 'Tokenizing…' : 'Retry token creation'}</button>}
          {t.token_id && <button className="ghost" disabled={!!busy} onClick={checkScheme}>{busy === 'scheme' ? `Asking ${gwName}…` : `Check network token on ${gwName}`}</button>}
        </div>
        {!own && t.status === 'ACTIVE' && <p className="sc-note">Only {t.created_by} can pay with this card from New transaction. You can still check it here, or paste its token.</p>}
        {t.status === 'ACTIVE' && t.usage !== 'CIT' && !t.agreement_id && <p className="sc-note">No MIT agreement is stored for this card, so it can't be charged without the customer. Save a card during a Sale with Save the card set to For MIT.</p>}
        {result?.error && <div className="msg bad">{result.error}</div>}
        {result?.ref && <p>MIT order <Link className="mono" href={`/orders/${result.ref}`}>{result.ref}</Link></p>}
        {result?.insights && <Insights items={result.insights} />}
      </div>
    </div>
  );
}

export default function CardsClient({ tokens, pub, role, me, all }) {
  const router = useRouter();
  const [s, setS] = useSettings();
  // Redirect flow: /cards?saved=<ref> → ask Geidea for the result straight away
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('saved');
    if (ref) post('/api/tokens/check', { ref }).then(() => { window.history.replaceState(null, '', '/cards'); router.refresh(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const active = tokens.filter((t) => t.status === 'ACTIVE');
  // Repeat saves: the gateway returned a token an earlier save already holds (same route, env and token)
  const firstSave = {};
  [...tokens].filter((t) => t.token_id).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).forEach((t) => {
    const k = `${t.route || 'geidea'}|${t.env}|${t.token_id}`;
    if (!firstSave[k]) firstSave[k] = t;
  });
  const repeatOf = (t) => { const f = t.token_id && firstSave[`${t.route || 'geidea'}|${t.env}|${t.token_id}`]; return f && f.id !== t.id ? f : null; };
  const other = tokens.filter((t) => t.status !== 'ACTIVE');
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <h1 style={{ marginBottom: 0 }}>Saved cards</h1>
        {role === 'admin' && (
          <div className="seg" role="radiogroup" aria-label="Whose cards">
            <Link href="/cards" className={`segl ${!all ? 'on' : ''}`} aria-checked={!all} role="radio">Mine</Link>
            <Link href="/cards?all=1" className={`segl ${all ? 'on' : ''}`} aria-checked={all} role="radio">All users</Link>
          </div>
        )}
      </div>
      <p className="sub">{all ? 'Every user\'s saved cards, with the owner on each. ' : <>Cards saved by your own transactions (signed in as <b>{me}</b>). </>}Cards saved as Geidea tokens or, through MPGS direct, as MPGS tokens. Check a card's network token, or start a customer payment (CIT) or merchant charge (MIT) with it on the New transaction page.</p>

      <div>
        {!tokens.length && <div className="card"><p style={{ margin: 0 }}>No saved cards yet for this user. On <Link href="/">New transaction</Link>, run a Sale with Save the card on, or pick Save card.</p></div>}
        {active.map((t) => <SavedCard key={t.id} t={t} s={s} setS={setS} me={me} repeatOf={repeatOf(t)} onChanged={() => router.refresh()} />)}
        {other.length > 0 && <h2 style={{ marginTop: 24 }}>Not ready</h2>}
        {other.map((t) => <SavedCard key={t.id} t={t} s={s} setS={setS} me={me} repeatOf={repeatOf(t)} onChanged={() => router.refresh()} />)}
      </div>
    </div>
  );
}
