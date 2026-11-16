'use client';
// R19: one Transaction page replaces Shop + Checkout. Left: the builder (context, transaction type, options for that
// type only, folded extras). Right: the ticket (amount, what will be sent, the action, card form, 3DS and the result).
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSettings } from '@/lib/clientState';
import Insights from '@/components/Insights';
import { genRef, genAgreement } from '@/lib/refs';
import { useLiveLog } from '@/lib/liveLog';
import LiveLog, { PauseBar } from '@/components/LiveLog';

function loadScript(src, ready) {
  return new Promise((resolve, reject) => {
    if (ready() && window.__loaded?.[src]) return resolve();
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => { window.__loaded = { ...(window.__loaded || {}), [src]: true }; resolve(); };
    el.onerror = () => reject(new Error(`Could not load ${src}. Your browser could not reach the gateway host (network, VPN, firewall or ad-blocker). Open it in a new tab to check.`));
    document.head.appendChild(el);
  });
}
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ ok: r.ok, j: await r.json().catch(() => ({})) }));

// Gateway HTML (3DS method / challenge) must run its scripts: innerHTML alone does not execute them.
function injectHtml(el, html) {
  el.innerHTML = html;
  el.querySelectorAll('script').forEach((old) => {
    const s = document.createElement('script');
    s.text = old.text;
    old.replaceWith(s);
  });
}
const browserInfo = () => ({ userAgent: navigator.userAgent, language: navigator.language, colorDepth: window.screen.colorDepth, screenHeight: window.screen.height, screenWidth: window.screen.width, timeZone: new Date().getTimezoneOffset() });

function Seg({ value, onChange, options }) {
  return (
    <div className="seg">
      {options.map(([v, label, disabled]) => (
        <button type="button" key={String(v)} disabled={disabled} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}
const Field = ({ label, children, hint }) => (<div className="fld"><label className="f">{label}</label>{children}{hint && <p className="hint">{hint}</p>}</div>);

const ROUTES = { geidea: 'Geidea PGW', mpgs: 'MPGS direct', cybs: 'CYBS direct' };
const ENVS = { test: 'Test', staging: 'Staging', production: 'Production' };
const TYPES = [
  ['sale', 'Sale', 'New card, charged now'],
  ['preauth', 'Pre-auth', 'New card, capture later'],
  ['cit', 'Token CIT', 'Customer pays with a saved card'],
  ['mit', 'Token MIT', 'Merchant charges a saved card'],
  ['save', 'Save card', 'Tokenize, no charge'],
];
const cardText = (t) => [t?.card?.brand, t?.card?.masked && t.card.masked.replace(/\*+/, ' •••• ')].filter(Boolean).join(' ');

export default function TransactionClient({ pub, role, tokens }) {
  const router = useRouter();
  const [s, setS] = useSettings();
  const up = (k) => (v) => setS((p) => ({ ...p, [k]: v }));
  const [c, setC] = useState({ firstName: 'Ghulam', lastName: 'Rabbani', email: 'test@example.com', phone: '562186147', phoneCountryCode: '+971', city: 'Dubai', street: 'Al Barsha' });
  const [merchantRef, setMerchantRef] = useState('');
  const [agreementId, setAgreementId] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState(null);
  const [result, setResult] = useState(null);
  const [dropin, setDropin] = useState(false);
  const [mp, setMp] = useState(null);
  const [cy, setCy] = useState(null);
  const [exp, setExp] = useState({ month: '', year: '' });
  const [stage, setStage] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const microformRef = useRef(null);
  const challengeRef = useRef(null);
  const methodRef = useRef(null);
  const live = useLiveLog(!!s.stepMode);

  const route = s.route || 'geidea';
  const env = s.env;
  const mpgsReady = !!pub.envs?.[env]?.mpgs?.ready;
  const cybsReady = !!pub.envs?.[env]?.cybs?.ready;
  const prodLocked = role !== 'admin' && !pub.allowDemoOnProduction;
  const mpgs = route === 'mpgs';
  const cybs = route === 'cybs';
  const direct = mpgs || cybs;
  const types = TYPES.filter(([k]) => k !== 'save' || route === 'geidea');
  const type = types.some(([k]) => k === (s.txType || 'sale')) ? s.txType || 'sale' : 'sale';
  const ccys = Array.from(new Set(['AED', ...(pub.currencies || [])]));
  const amountStr = s.amount ?? '1.00';
  const amount = Number(amountStr);
  const saveCard = type === 'sale' || type === 'preauth' ? s.saveCard || 'none' : 'none';
  const operation = type === 'sale' ? 'Pay' : type === 'preauth' ? 'PreAuthorize' : s.operation === 'PreAuthorize' ? 'PreAuthorize' : 'Pay';
  const auth = direct ? s.auth || '3ds' : s.auth === 'moto' ? 'moto' : '3ds';

  // Saved cards for this route + environment
  const mine = tokens.filter((t) => t.status === 'ACTIVE' && t.token_id && (t.route || 'geidea') === route && t.env === env);
  const citCards = mine.filter((t) => t.usage !== 'MIT');
  const mitCards = mine.filter((t) => t.agreement_id && t.usage !== 'CIT');
  const manualOk = !cybs; // a pasted CYBS instrument identifier also needs the card expiry: pick it from Saved cards
  const citSel = s.citId === 'manual' && manualOk ? 'manual' : citCards.find((t) => String(t.id) === String(s.citId)) || null;
  const mitSel = s.mitId === 'manual' && manualOk ? 'manual' : mitCards.find((t) => String(t.id) === String(s.mitId)) || null;
  const citToken = citSel === 'manual' ? (s.manualToken || '').trim() : citSel?.token_id || '';
  const citCardText = citSel && citSel !== 'manual' ? cardText(citSel) : '';
  const needsAgreement = !cybs && (saveCard === 'mit' || saveCard === 'citmit');
  const nameMode = s.merchantNameMode || (s.showMerchantName === false ? 'hide' : 'mid');

  // What the existing checkout APIs expect (they read token fields from settings)
  function sendSettings() {
    const base = { ...s, route, operation, auth, saveCard, showMerchantName: nameMode !== 'hide', merchantNameText: nameMode === 'custom' ? (s.merchantNameText || '').trim() : '', tokenId: '', mpgsToken: '', mpgsCard: '', mpgsAgreementId: '', cybsIi: '', cybsCard: '', cybsExpiry: null };
    if (type !== 'cit') return base;
    if (cybs) return { ...base, cybsIi: citToken, cybsCard: citCardText, cybsExpiry: citSel?.card?.expiry || null };
    if (mpgs) return { ...base, mpgsToken: citToken, mpgsCard: citCardText };
    return { ...base, tokenId: citToken };
  }

  useEffect(() => { setMp(null); setCy(null); setErr(null); setResult(null); setStage(''); setDropin(false); live.reset(); }, [route, env, type, s.citId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Geidea PGW (HPP) ----------
  async function payGeidea() {
    setBusy('pay'); setErr(null); setResult(null);
    try {
      // R21: the reference is fixed here so the live log can follow the order from its first call
      const ref = merchantRef.trim() || genRef('geidea');
      live.track(ref);
      const { ok, j } = await live.during('Create session (Geidea)', () => post('/api/checkout', { items: {}, settings: sendSettings(), customer: c, customAmount: amountStr, merchantRef: ref, agreementId: needsAgreement ? agreementId : '' }));
      if (!ok) { setErr(j); setBusy(''); return; }
      await live.gate(j.mode === 'redirect' ? 'redirect to the Geidea payment page' : 'open the Geidea payment page');
      const go = async (outcome, data) => {
        try { await post('/api/checkout/result', { ref: j.ref, outcome, data: data ?? null }); } catch {}
        window.location.href = `/return?ref=${encodeURIComponent(j.ref)}&sdk=${outcome}`;
      };
      if (j.mode === 'redirect') { window.location.href = j.hppUrl; return; }
      await loadScript(j.sdkUrl, () => !!window.GeideaCheckout);
      const payment = new window.GeideaCheckout((d) => go('success', d), (d) => go('error', d), (d) => go('cancel', d));
      if (j.mode === 'dropin') {
        setDropin(true);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        document.getElementById('gd-dropin')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        payment.startPayment(j.sessionId, null, 'gd-dropin');
      } else payment.startPayment(j.sessionId);
      setBusy('');
    } catch (e) { setErr({ error: e.message }); setBusy(''); }
  }

  // ---------- Geidea stand-alone save card (no charge) ----------
  async function saveGeidea() {
    setBusy('pay'); setErr(null); setResult(null);
    try {
      const { ok, j } = await live.during('Create save-card session (Geidea)', () => post('/api/tokens/save', { env, usage: 'CIT', currency: s.currency || 'AED' }));
      if (j.ref) await live.track(j.ref);
      if (!ok) { setErr({ error: j.error, insights: j.insights }); setBusy(''); return; }
      await live.gate('open the Geidea card form');
      await loadScript(j.sdkUrl, () => !!window.GeideaCheckout);
      const done = (outcome) => async (data) => {
        const r = await live.during('Check the save with Geidea', () => post('/api/tokens/check', { ref: j.ref, outcome, data: data ?? null }));
        setResult({ saved: outcome === 'success', ref: j.ref, insights: r.j?.insights });
        router.refresh();
      };
      new window.GeideaCheckout(done('success'), done('error'), done('cancel')).startPayment(j.sessionId);
    } catch (e) { setErr({ error: e.message }); }
    setBusy('');
  }

  // ---------- MIT on any route ----------
  async function chargeMit() {
    const t = mitSel;
    const manual = t === 'manual';
    const token = manual ? (s.manualToken || '').trim() : t?.token_id;
    const agr = manual ? (s.manualAgreementId || '').trim() : t?.agreement_id;
    const agrType = manual ? s.manualAgreementType || 'Unscheduled' : t?.agreement_type || 'Unscheduled';
    let confirmed = false;
    if (env === 'production') {
      confirmed = window.confirm(`Charge ${s.currency} ${amount.toFixed(2)} to ${manual ? `token ${token.slice(0, 8)}…` : cardText(t) || 'this card'} without the customer?\n\nThis is Production: real money.`);
      if (!confirmed) return;
    }
    setBusy('pay'); setErr(null); setResult(null);
    const body = { confirmed, env, amount: amountStr, currency: s.currency, operation };
    live.reset();
    const { ok, j } = await live.during(`merchant charge (${ROUTES[route]})`, () => cybs
      ? post('/api/tokens/cybs-mit', { ...body, iiId: token, expiry: t?.card?.expiry, ntid: agr, skipDm: !!s.cybsSkipDm })
      : mpgs
      ? post('/api/tokens/mpgs-mit', { ...body, token, agreementId: agr, agreementType: agrType })
      : post('/api/tokens/mit', { ...body, tokenId: token, agreementId: agr, agreementType: agrType }));
    if (j.ref) await live.track(j.ref);
    setBusy('');
    if (ok) setResult({ ref: j.ref, insights: j.insights }); else setErr({ error: j.error, insights: j.insights, ref: j.ref });
    router.refresh();
  }

  // ---------- MPGS direct: Hosted Session ----------
  async function startMpgs() {
    setBusy('session'); setErr(null); setFieldErr({});
    try {
      const ref = merchantRef.trim() || genRef('mpgs');
      live.track(ref);
      const { ok, j } = await live.during('Create session (MPGS)', () => post('/api/mpgs/checkout', { settings: sendSettings(), customer: c, amount, merchantRef: ref, agreementId: needsAgreement ? agreementId : '' }));
      if (!ok) { setErr(j); setBusy(''); return; }
      setMp({ ...j, ready: false });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await loadScript(j.sessionJs, () => !!window.PaymentSession);
      const fields = j.cvvOnly
        ? { card: { securityCode: '#mp-csc' } }
        : { card: { number: '#mp-number', expiryMonth: '#mp-month', expiryYear: '#mp-year', securityCode: '#mp-csc', nameOnCard: '#mp-name' } };
      window.PaymentSession.configure({
        session: j.sessionId,
        fields,
        frameEmbeddingMitigation: ['javascript'],
        interaction: { displayControl: { formatCard: 'EMBOSSED', invalidFieldCharacters: 'REJECT' } },
        callbacks: {
          initialized: (r) => { setMp((m) => ({ ...m, ready: r?.status !== 'system_error' })); if (r?.status === 'system_error') setErr({ error: `Hosted Session did not start: ${r.message || 'system error'}` }); },
          formSessionUpdate: (r) => onFormUpdate(j, r),
        },
      });
    } catch (e) { setErr({ error: e.message }); }
    setBusy('');
  }

  function submitCard() {
    setBusy('pay'); setErr(null); setFieldErr({}); setStage('Sending card to MPGS…');
    window.PaymentSession.updateSessionFromForm('card');
  }

  async function onFormUpdate(j, r) {
    await live.during('card details to the session (browser → MPGS)', () => post('/api/checkout/result', { ref: j.ref, outcome: `formSessionUpdate ${r?.status}`, data: r ?? null, action: `MPGS Hosted Session → formSessionUpdate ${r?.status}` }));
    if (r?.status !== 'ok') {
      if (r?.status === 'fields_in_error') setFieldErr(r.errors || {});
      setErr({ error: r?.status === 'fields_in_error' ? 'Check the highlighted card fields.' : `Card form: ${r?.status}${r?.errors?.message ? ` (${r.errors.message})` : ''}` });
      setBusy(''); setStage('');
      return;
    }
    const done = () => { window.location.href = `/mpgs/complete?ref=${encodeURIComponent(j.ref)}`; };
    if (auth !== '3ds') return done();
    try {
      await live.gate('INITIATE_AUTHENTICATION (3-D Secure: is the card enrolled?)');
      setStage('3-D Secure: checking the card…');
      const init = await live.during('INITIATE_AUTHENTICATION', () => post(`/api/mpgs/${encodeURIComponent(j.ref)}/authenticate`, { step: 'initiate' }));
      if (!init.ok) { setErr(init.j); setBusy(''); setStage(''); return; }
      if (init.j.recommendation !== 'PROCEED') return done();
      if (init.j.html && methodRef.current) {
        injectHtml(methodRef.current, init.j.html);
        if (init.j.methodSupported === 'SUPPORTED') await new Promise((res) => setTimeout(res, 3000));
      }
      await live.gate('AUTHENTICATE_PAYER (3-D Secure: frictionless or challenge)');
      setStage('3-D Secure: authenticating…');
      const a = await live.during('AUTHENTICATE_PAYER', () => post(`/api/mpgs/${encodeURIComponent(j.ref)}/authenticate`, { step: 'authenticate', browser: browserInfo() }));
      if (!a.ok) { setErr(a.j); setBusy(''); setStage(''); return; }
      if (a.j.challenge && a.j.html) {
        await live.gate('show the issuer\'s 3-D Secure challenge');
        setStage('3-D Secure: complete the challenge below');
        injectHtml(challengeRef.current, a.j.html);
        challengeRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      done();
    } catch (e) { setErr({ error: e.message }); setBusy(''); setStage(''); }
  }

  // ---------- CYBS direct: Microform v2 + payer authentication ----------
  async function startCybs() {
    setBusy('session'); setErr(null);
    try {
      const ref = merchantRef.trim() || genRef('cybs');
      live.track(ref);
      const { ok, j } = await live.during('Capture context (CYBS Microform)', () => post('/api/cybs/checkout', { settings: sendSettings(), customer: c, amount, merchantRef: ref }));
      if (!ok) { setErr(j); setBusy(''); return; }
      if (j.savedCard) { setCy({ ref: j.ref, savedCard: true, ready: true }); setBusy(''); return; }
      setCy({ ref: j.ref, ready: false });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      let lib = 'https://flex.cybersource.com/microform/bundle/v2.0/flex-microform.min.js', integrity;
      try {
        const payload = JSON.parse(atob(j.captureContext.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        const d = payload?.ctx?.[0]?.data || {};
        if (d.clientLibrary) { lib = d.clientLibrary; integrity = d.clientLibraryIntegrity; }
      } catch {}
      await new Promise((resolve, reject) => {
        if (window.Flex && window.__loaded?.[lib]) return resolve();
        const el = document.createElement('script');
        el.src = lib;
        if (integrity) { el.integrity = integrity; el.crossOrigin = 'anonymous'; }
        el.onload = () => { window.__loaded = { ...(window.__loaded || {}), [lib]: true }; resolve(); };
        el.onerror = () => reject(new Error(`Could not load Microform from ${lib}.`));
        document.head.appendChild(el);
      });
      const styles = { input: { 'font-size': '15px', 'font-family': 'monospace', color: '#16202b' }, '::placeholder': { color: '#9aa4ae' }, invalid: { color: '#b8322b' } };
      const microform = new window.Flex(j.captureContext).microform({ styles });
      microform.createField('number', { placeholder: '•••• •••• •••• ••••' }).load('#cy-number');
      microform.createField('securityCode', { placeholder: '•••' }).load('#cy-csc');
      microformRef.current = microform;
      setCy((x) => ({ ...x, ready: true }));
    } catch (e) { setErr({ error: e.message }); }
    setBusy('');
  }

  const CY_STEP = { token: 'card token to the shop', setup: 'payer authentication setup', enrol: '3DS enrolment check + authorization', pay: 'authorization' };
  async function cyStep(step, extra = {}) {
    const r = await live.during(CY_STEP[step] || step, () => post(`/api/cybs/${encodeURIComponent(cy.ref)}/step`, { step, ...extra }));
    if (!r.ok) throw Object.assign(new Error(r.j.error || `${step} failed`), { payload: r.j });
    return r.j;
  }

  async function submitCybs() {
    setBusy('pay'); setErr(null);
    const done = () => { window.location.href = `/cybs/complete?ref=${encodeURIComponent(cy.ref)}`; };
    try {
      if (!cy.savedCard) {
        setStage('Sending card to CyberSource…');
        const mm = String(exp.month).padStart(2, '0');
        const yyyy = String(exp.year).length === 2 ? `20${exp.year}` : String(exp.year);
        const token = await new Promise((resolve, reject) => microformRef.current.createToken({ expirationMonth: mm, expirationYear: yyyy }, (e, t) => (e ? reject(new Error(e.message || e.reason || 'Microform could not create a token')) : resolve(t))));
        await cyStep('token', { transientToken: token, expiry: { month: mm, year: yyyy } });
      }
      if (auth !== '3ds') { await live.gate('authorization (no 3-D Secure)'); setStage('Authorizing…'); await cyStep('pay'); return done(); }
      await live.gate('payer authentication setup');
      setStage('3-D Secure: device data collection…');
      const setup = await cyStep('setup');
      if (!setup.ok || !setup.url) throw Object.assign(new Error('Payer auth setup failed'), { payload: setup });
      await live.gate('device data collection (browser → Cardinal)');
      const ddcStart = Date.now();
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 10000);
        const on = (ev) => { let host = ''; try { host = new URL(ev.origin).hostname; } catch {} if (/cardinalcommerce\.com$/.test(host)) { clearTimeout(t); window.removeEventListener('message', on); resolve(); } };
        window.addEventListener('message', on);
        methodRef.current.innerHTML = `<iframe name="cy-ddc" height="1" width="1" style="display:none"></iframe><form id="cy-ddc-form" target="cy-ddc" method="POST" action="${setup.url}"><input type="hidden" name="JWT" value="${setup.accessToken}"></form>`;
        document.getElementById('cy-ddc-form').submit();
      });
      await live.during('device data collection (browser → Cardinal)', () => post('/api/checkout/result', { ref: cy.ref, outcome: 'ddc', data: { referenceId: setup.referenceId, finishedInMs: Date.now() - ddcStart }, action: 'Cardinal device data collection finished (browser)' }));
      await live.gate('3DS enrolment check + authorization');
      setStage('3-D Secure: checking enrolment and authorizing…');
      const enrol = await cyStep('enrol', { browser: browserInfo(), referenceId: setup.referenceId });
      if (enrol.challenge && enrol.stepUpUrl) {
        await live.gate('show the issuer\'s 3-D Secure challenge');
        setStage('3-D Secure: complete the challenge below');
        challengeRef.current.innerHTML = `<iframe name="cy-stepup" style="width:100%;min-height:600px;border:0"></iframe><form id="cy-stepup-form" target="cy-stepup" method="POST" action="${enrol.stepUpUrl}"><input type="hidden" name="JWT" value="${enrol.accessToken}"><input type="hidden" name="MD" value="${cy.ref}"></form>`;
        document.getElementById('cy-stepup-form').submit();
        challengeRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      done();
    } catch (e) { setErr({ error: e.message, insights: e.payload?.insights }); setBusy(''); setStage(''); }
  }

  // ---------- builder pieces ----------
  const f = (k, label, type = 'text') => (<div><label className="f">{label}</label><input type={type} value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} /></div>);
  const hf = (id, label, key, style) => (
    <div style={style}><label className="f">{label}</label><input id={id} readOnly className={`hosted ${fieldErr[key] ? 'err' : ''}`} />{fieldErr[key] && <div className="field-err">{fieldErr[key]}</div>}</div>
  );
  const started = !!(mp || cy);

  function CardPicker({ list, sel, idKey, emptyText }) {
    const value = sel === 'manual' ? 'manual' : sel ? String(sel.id) : '';
    return (<>
      <div className="picker">
        {list.map((t) => (
          <button type="button" key={t.id} className={`pick ${value === String(t.id) ? 'on' : ''}`} onClick={() => up(idKey)(t.id)}>
            <span className={`brand brand-${(t.card?.brand || '').toLowerCase()}`}>{t.card?.brand || 'Card'}</span>
            <span className="pick-num">{t.card?.masked ? t.card.masked.replace(/\*+/, ' •••• ') : t.token_id.slice(0, 12) + '…'}</span>
            <span className="pick-meta">{t.card?.issuer || 'Issuer not known'}{t.scheme?.provider ? `, network token ${t.scheme.provider}` : ''}</span>
          </button>
        ))}
        {manualOk && <button type="button" className={`pick paste ${value === 'manual' ? 'on' : ''}`} onClick={() => up(idKey)('manual')}><span className="pick-num">Paste a token</span><span className="pick-meta">Not in Saved cards</span></button>}
      </div>
      {!list.length && <p className="hint">{emptyText}</p>}
    </>);
  }

  // ---------- ticket ----------
  const tkType = { sale: 'Sale', preauth: 'Pre-auth', cit: operation === 'Pay' ? 'Token CIT, sale' : 'Token CIT, pre-auth', mit: operation === 'Pay' ? 'Token MIT, sale' : 'Token MIT, pre-auth', save: 'Save card, no charge' }[type];
  const tkCard = type === 'cit' ? (citSel === 'manual' ? (citToken ? `Token ${citToken.slice(0, 10)}…` : 'Paste a token') : citSel ? cardText(citSel) || citSel.token_id.slice(0, 10) : 'Pick a card')
    : type === 'mit' ? (mitSel === 'manual' ? ((s.manualToken || '').trim() ? `Token ${s.manualToken.trim().slice(0, 10)}…` : 'Paste a token') : mitSel ? cardText(mitSel) || mitSel.token_id.slice(0, 10) : 'Pick a card')
    : 'New card';
  const tkAuth = type === 'mit' ? 'None (merchant initiated)' : type === 'save' ? 'Set by the card form' : { '3ds': '3-D Secure', none: 'No 3DS', moto: 'MOTO' }[auth];
  const tkAgreement = type === 'mit' ? (mitSel === 'manual' ? s.manualAgreementId : mitSel?.agreement_id) : needsAgreement ? agreementId || 'Generated' : '';
  const blockers = [
    !(amount > 0) && type !== 'save' && 'Enter an amount above zero.',
    type === 'cit' && !citToken && 'Pick the saved card to pay with.',
    type === 'mit' && !mitSel && 'Pick the card to charge.',
    type === 'mit' && mitSel === 'manual' && !((s.manualToken || '').trim() && (s.manualAgreementId || '').trim()) && 'Paste the token and its agreement ID.',
    route === 'mpgs' && !mpgsReady && 'MPGS direct is not set up for this environment (Admin).',
    route === 'cybs' && !cybsReady && 'CYBS direct is not set up for this environment (Admin).',
  ].filter(Boolean);
  const label = type === 'save' ? 'Open card form' : type === 'mit' ? `Charge ${s.currency} ${(amount || 0).toFixed(2)}` : direct ? (cybs && type === 'cit' ? 'Continue with saved card' : 'Continue to card details') : `Pay ${s.currency} ${(amount || 0).toFixed(2)}`;
  const act = type === 'save' ? saveGeidea : type === 'mit' ? chargeMit : mpgs ? startMpgs : cybs ? startCybs : payGeidea;

  return (
    <>
      <section className="ctx" aria-label="Where the transaction goes">
        <div className="ctx-group">
          <span className="ctx-label">Environment</span>
          <div className="bigseg" role="radiogroup" aria-label="Environment">
            {[['test', 'Test', 'Test credentials'], ['staging', 'Staging', 'Pre-production'], ['production', 'Production', prodLocked ? 'Admin only' : 'Real money', prodLocked]].map(([k, l, sub, dis]) => (
              <button type="button" role="radio" aria-checked={env === k} key={k} disabled={dis} className={`big env-${k} ${env === k ? 'on' : ''}`} onClick={() => up('env')(k)}><span className="big-l">{l}</span><span className="big-s">{sub}</span></button>
            ))}
          </div>
        </div>
        <div className="ctx-group">
          <span className="ctx-label">Route</span>
          <div className="bigseg" role="radiogroup" aria-label="Route">
            {[['geidea', 'Geidea PGW', 'Hosted payment page', false], ['mpgs', 'MPGS direct', mpgsReady ? 'Mastercard Hosted Session' : 'Set up in Admin', !mpgsReady], ['cybs', 'CYBS direct', cybsReady ? 'CyberSource Microform' : 'Set up in Admin', !cybsReady]].map(([k, l, sub, dis]) => (
              <button type="button" role="radio" aria-checked={route === k} key={k} disabled={dis} className={`big route ${route === k ? 'on' : ''}`} onClick={() => up('route')(k)}><span className="big-l">{l}</span><span className="big-s">{sub}</span></button>
            ))}
          </div>
        </div>
        {cybs && (
          <div className="ctx-group">
            <span className="ctx-label">Decision Manager</span>
            <div className="bigseg">
              {[[false, 'Run', 'Fraud screening on'], [true, 'Skip', 'DECISION_SKIP']].map(([k, l, sub]) => (
                <button type="button" key={String(k)} className={`big route ${!!s.cybsSkipDm === k ? 'on' : ''}`} onClick={() => up('cybsSkipDm')(k)}><span className="big-l">{l}</span><span className="big-s">{sub}</span></button>
              ))}
            </div>
          </div>
        )}
        {direct && <p className="ctx-note">No PGW order is created, so nothing is federated to APEX. MID {pub.envs[env]?.[route]?.merchantId}.</p>}
      </section>
    <div className="txn">
      <div className="builder">
        <section className="types" role="radiogroup" aria-label="Transaction type" style={{ '--n': types.length }}>
          {types.map(([k, name, desc]) => (
            <button type="button" role="radio" aria-checked={type === k} key={k} className={`type ${type === k ? 'on' : ''}`} onClick={() => up('txType')(k)}>
              <span className="type-name">{name}</span>
              <span className="type-desc">{desc}</span>
            </button>
          ))}
        </section>

        <section className="opts">
          {(type === 'sale' || type === 'preauth') && (<>
            <div className="opt-row">
              <Field label="Authentication">
                {direct
                  ? <Seg value={auth} onChange={up('auth')} options={[['3ds', '3-D Secure'], ['none', 'No 3DS'], ['moto', 'MOTO']]} />
                  : <Seg value={auth} onChange={up('auth')} options={[['3ds', '3-D Secure'], ['moto', pub.offerMoto ? 'MOTO' : 'MOTO (off in Admin)', !pub.offerMoto]]} />}
              </Field>
              <Field label="Save the card">
                <Seg value={saveCard} onChange={up('saveCard')} options={[['none', 'No'], ['cit', 'For CIT'], ['mit', 'For MIT'], ['citmit', 'CIT + MIT']]} />
              </Field>
            </div>
            {direct && auth === 'none' && <p className="hint">Sent as an internet payment without authentication (ECI 07): no liability shift, and the issuer may soft-decline.</p>}
            {needsAgreement && (
              <div className="opt-row sub">
                <Field label="Agreement type"><Seg value={s.agreementType || 'Unscheduled'} onChange={up('agreementType')} options={[['Unscheduled', 'Unscheduled'], ['Recurring', 'Recurring']]} /></Field>
                <Field label="Agreement ID">
                  <div className="row nowrap">
                    <input className="mono" placeholder="Blank = generated" value={agreementId} onChange={(e) => setAgreementId(e.target.value)} disabled={started} />
                    <button type="button" className="ghost" onClick={() => setAgreementId(genAgreement(route))} disabled={started}>Generate</button>
                  </div>
                </Field>
              </div>
            )}
            {mpgs && saveCard !== 'none' && (
              <div className="opt-row sub">
                <Field label="MPGS token value" hint={s.mpgsTokenValue === 'mpgs' ? 'POST /token with no value; needs a repository that generates tokens.' : 'PUT /token/{value} with a Geidea-style value, as PGW does; needs a repository that accepts merchant-supplied tokens.'}>
                  <Seg value={s.mpgsTokenValue || 'geidea'} onChange={up('mpgsTokenValue')} options={[['geidea', 'Geidea sends it (PGW flow)'], ['mpgs', 'MPGS generates it']]} />
                </Field>
              </div>
            )}
          </>)}

          {type === 'cit' && (<>
            <Field label={`Card saved on ${ROUTES[route]}, ${ENVS[env]}`}>
              <CardPicker list={citCards} sel={citSel} idKey="citId" emptyText={`No saved cards for ${ROUTES[route]} in ${ENVS[env]}. Run a Sale with Save the card on first.`} />
            </Field>
            {citSel === 'manual' && <Field label={mpgs ? 'MPGS token' : 'Geidea token ID'}><input className="mono" value={s.manualToken || ''} onChange={(e) => up('manualToken')(e.target.value)} /></Field>}
            <div className="opt-row">
              <Field label="Operation"><Seg value={operation} onChange={up('operation')} options={[['Pay', 'Sale'], ['PreAuthorize', 'Pre-auth']]} /></Field>
              <Field label="Authentication">
                {direct
                  ? <Seg value={auth === 'moto' ? '3ds' : auth} onChange={up('auth')} options={[['3ds', '3-D Secure'], ['none', 'No 3DS']]} />
                  : <Seg value="3ds" onChange={() => {}} options={[['3ds', '3-D Secure']]} />}
              </Field>
            </div>
            <p className="hint">{cybs ? 'No card form: sent as storedCredentialUsed with networkTokenOption prefer.' : mpgs ? 'The card form asks only for CVV. Sent as storedOnFile STORED, source INTERNET, no agreement (MPGS treats later payments on an agreement as MITs).' : 'The payment page asks only for CVV / OTP.'}</p>
          </>)}

          {type === 'mit' && (<>
            <Field label={`Card with an MIT agreement on ${ROUTES[route]}, ${ENVS[env]}`}>
              <CardPicker list={mitCards} sel={mitSel} idKey="mitId" emptyText={`No cards with an agreement for ${ROUTES[route]} in ${ENVS[env]}. Run a Sale with Save the card set to For MIT or CIT + MIT first.`} />
            </Field>
            {mitSel === 'manual' && (
              <div className="opt-row sub">
                <Field label={mpgs ? 'MPGS token' : 'Geidea token ID'}><input className="mono" value={s.manualToken || ''} onChange={(e) => up('manualToken')(e.target.value)} /></Field>
                <Field label="Agreement ID"><input className="mono" value={s.manualAgreementId || ''} onChange={(e) => up('manualAgreementId')(e.target.value)} /></Field>
                <Field label="Agreement type"><Seg value={s.manualAgreementType || 'Unscheduled'} onChange={up('manualAgreementType')} options={[['Unscheduled', 'Unscheduled'], ['Recurring', 'Recurring']]} /></Field>
              </div>
            )}
            {mitSel && mitSel !== 'manual' && <p className="hint">{cybs ? <>First CIT network transaction ID <span className="mono">{mitSel.agreement_id}</span>, sent as previousTransactionId.</> : <>Agreement <span className="mono">{mitSel.agreement_id}</span> ({mitSel.agreement_type || 'Unscheduled'}).</>}</p>}
            <div className="opt-row">
              <Field label="Operation"><Seg value={operation} onChange={up('operation')} options={[['Pay', 'Sale'], ['PreAuthorize', 'Pre-auth']]} /></Field>
            </div>
          </>)}

          {type === 'save' && (
            <p className="hint" style={{ marginTop: 0 }}>Opens the Geidea card form without charging anything and saves the card for customer payments (CIT). To save a card for merchant charges, run a Sale with Save the card set to For MIT: the agreement comes from that payment.</p>
          )}
        </section>

        <details className="more">
          <summary>More options <span className="more-sum">{[s.currency, merchantRef ? 'own reference' : null, `${c.firstName} ${c.lastName}`, !direct && type !== 'mit' && type !== 'save' ? `${{ modal: 'Modal', dropin: 'Drop-in', redirect: 'Redirect' }[s.mode]} payment page` : null].filter(Boolean).join(', ')}</span></summary>
          <div className="more-body">
            <div className="opt-row">
              <Field label="Currency"><select value={s.currency} onChange={(e) => up('currency')(e.target.value)}>{ccys.map((x) => <option key={x}>{x}</option>)}</select></Field>
              {type !== 'mit' && type !== 'save' && (
                <Field label="Merchant reference">
                  <div className="row nowrap">
                    <input className="mono" placeholder="Blank = generated" value={merchantRef} onChange={(e) => setMerchantRef(e.target.value)} disabled={started} />
                    <button type="button" className="ghost" onClick={() => setMerchantRef(genRef(route))} disabled={started}>Generate</button>
                  </div>
                </Field>
              )}
            </div>

            {type !== 'mit' && type !== 'save' && (<>
              <h3>Customer</h3>
              <div className="grid g3">{f('firstName', 'First name')}{f('lastName', 'Last name')}{f('email', 'Email', 'email')}</div>
              <div className="grid g3">{f('phoneCountryCode', 'Country code')}{f('phone', 'Phone')}{f('city', 'City')}</div>
              <div className="grid g3">{f('street', 'Street')}</div>
              <p className="hint">{mpgs ? 'Kept on the order for reference; not sent to MPGS yet.' : cybs ? 'Sent to CYBS as billTo (CYBS requires it).' : 'Sent in the Geidea session.'}</p>
            </>)}

            {!direct && type !== 'mit' && type !== 'save' && (<>
              <h3>Geidea payment page</h3>
              <div className="opt-row">
                <Field label="Checkout mode"><Seg value={s.mode} onChange={up('mode')} options={[['modal', 'Modal'], ['dropin', 'Drop-in'], ['redirect', 'Redirect']]} /></Field>
                <Field label="Page style"><Seg value={s.hppProfile} onChange={up('hppProfile')} options={[['simple', 'Simple'], ['compressed', 'Compressed']]} /></Field>
                <Field label="Language"><Seg value={s.language} onChange={up('language')} options={[['en', 'English'], ['ar', 'Arabic']]} /></Field>
              </div>
              <h3>Branding</h3>
              <div className="opt-row">
                <Field label="Merchant name"><Seg value={nameMode} onChange={up('merchantNameMode')} options={[['mid', 'From Admin'], ['custom', 'Custom'], ['hide', 'Hide']]} /></Field>
                {nameMode === 'custom' && <Field label="Name shown"><input value={s.merchantNameText || ''} placeholder="Gateway test bench" onChange={(e) => up('merchantNameText')(e.target.value)} /></Field>}
                <Field label="Merchant logo URL" hint="HTTPS image. Blank = no logo."><input className="mono" placeholder="https://…/logo.png" value={s.logoUrl || ''} onChange={(e) => up('logoUrl')(e.target.value.trim())} style={{ minWidth: 280 }} /></Field>
              </div>
              <div className="opt-row">
                <Field label="Geidea logo"><Seg value={!!s.hideGeideaLogo} onChange={up('hideGeideaLogo')} options={[[false, 'Show'], [true, 'Hide']]} /></Field>
                <Field label="Header colour">
                  <div className="row nowrap"><input type="color" value={s.headerColor || '#ffffff'} onChange={(e) => up('headerColor')(e.target.value)} style={{ width: 56, padding: 2 }} />{s.headerColor ? <button type="button" className="ghost" onClick={() => up('headerColor')('')}>Default</button> : <span className="hint" style={{ margin: 0 }}>Default</span>}</div>
                </Field>
              </div>
              <h3>Fields on the page</h3>
              <div className="opt-row">
                {[['showEmail', 'Email'], ['showPhone', 'Phone'], ['showAddress', 'Address'], ['receiptPage', 'Receipt page']].map(([k, l]) => (
                  <Field key={k} label={l}><Seg value={!!s[k]} onChange={up(k)} options={[[true, 'Show'], [false, 'Hide']]} /></Field>
                ))}
              </div>
              <h3>Wallets</h3>
              <div className="opt-row">
                {[['apple-pay', 'Apple Pay'], ['google-pay', 'Google Pay'], ['samsung-pay', 'Samsung Pay']].map(([w, l]) => {
                  const hidden = s.hideWallets === true || (Array.isArray(s.hideWallets) && s.hideWallets.includes(w));
                  const set = (show) => setS((p) => { const cur = p.hideWallets === true ? ['apple-pay', 'google-pay', 'samsung-pay'] : Array.isArray(p.hideWallets) ? p.hideWallets : []; const next = show ? cur.filter((x) => x !== w) : Array.from(new Set([...cur, w])); return { ...p, hideWallets: next }; });
                  return <Field key={w} label={l}><Seg value={!hidden} onChange={set} options={[[true, 'Show'], [false, 'Hide']]} /></Field>;
                })}
                <Field label="Express checkout" hint="Wallet buttons shown before the card form (expressCheckouts)."><Seg value={s.express || 'none'} onChange={up('express')} options={[['none', 'Off'], ['google-pay', 'Google Pay'], ['apple-pay', 'Apple Pay']]} /></Field>
              </div>
              <h3>Order data</h3>
              <div className="opt-row">
                <Field label="Order items" hint="Sends one item for the full amount in order.items (Tabby / Tamara need items)."><Seg value={!!s.sendItems} onChange={up('sendItems')} options={[[false, 'Off'], [true, 'Send']]} /></Field>
                <Field label="Fee program indicator" hint="processingInformation.feeProgramIndicator, e.g. AE3. Blank = not sent."><input className="mono" maxLength={3} placeholder="AE3" value={s.feeProgram || ''} onChange={(e) => up('feeProgram')(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} style={{ width: 120 }} /></Field>
              </div>
            </>)}
            {(type === 'mit' || type === 'save') && <p className="hint">{type === 'mit' ? 'No customer, reference or page options: the merchant charge is sent straight to the gateway.' : 'Geidea\'s save-card session takes no page options (body: currency and callback only), so the form uses its defaults.'}</p>}
          </div>
        </details>
      </div>

      <aside className={`ticket env-${env}`} aria-label="Transaction ticket">
        <div className="tk-paper">
          <div className="tk-head">
            <span>{ROUTES[route]}</span>
            <span className={`tk-env ${env}`}>{ENVS[env]}{env === 'production' ? ', real money' : ''}</span>
          </div>
          {type !== 'save' ? (
            <label className="tk-amount">
              <span className="tk-ccy">{s.currency}</span>
              <input inputMode="decimal" aria-label="Amount" value={amountStr} onChange={(e) => up('amount')(e.target.value.replace(/[^\d.]/g, ''))} onBlur={() => amount > 0 && up('amount')(amount.toFixed(2))} disabled={started} />
            </label>
          ) : <div className="tk-amount zero"><span className="tk-ccy">{s.currency}</span><span>0.00</span></div>}
          <dl className="tk-lines">
            <dt>Type</dt><dd>{tkType}</dd>
            <dt>Card</dt><dd>{tkCard}</dd>
            <dt>Authentication</dt><dd>{tkAuth}</dd>
            {saveCard !== 'none' && (<><dt>Save card</dt><dd>{{ cit: 'For CIT', mit: 'For MIT', citmit: 'For CIT + MIT' }[saveCard]}{mpgs ? (s.mpgsTokenValue === 'mpgs' ? ', MPGS value' : ', Geidea value') : ''}</dd></>)}
            {tkAgreement && (<><dt>{cybs ? 'Network txn ID' : 'Agreement'}</dt><dd className="mono">{tkAgreement}</dd></>)}
            {cybs && (<><dt>Decision Manager</dt><dd>{s.cybsSkipDm ? 'Skipped' : 'Runs'}</dd></>)}
            {type !== 'mit' && type !== 'save' && (<><dt>Reference</dt><dd className="mono">{mp?.ref || cy?.ref || merchantRef || 'Generated'}</dd></>)}
          </dl>

          {type !== 'mit' && (
            <div className="stepmode">
              <span title="Pause after each API call so you can read its request and response, then press Continue">Step by step</span>
              <Seg value={!!s.stepMode} onChange={up('stepMode')} options={[[false, 'Off'], [true, 'On']]} />
            </div>
          )}
          {!started && (
            <div className="tk-action">
              <button className="tk-go" onClick={act} disabled={!!busy || blockers.length > 0}>{busy === 'session' ? 'Starting…' : busy === 'pay' ? 'Working…' : label}</button>
              {blockers[0] && <p className="tk-block">{blockers[0]}</p>}
            </div>
          )}

          {mpgs && mp && (
            <div className="tk-form">
              <h2>{mp.cvvOnly ? 'Confirm CVV' : 'Card details'}</h2>
              {!mp.cvvOnly && (<>
                {hf('mp-number', 'Card number', 'cardNumber')}
                <div className="grid g3">
                  {hf('mp-month', 'Month', 'expiryMonth')}
                  {hf('mp-year', 'Year', 'expiryYear')}
                  {hf('mp-csc', 'CVV', 'securityCode')}
                </div>
                {hf('mp-name', 'Name on card', 'nameOnCard')}
              </>)}
              {mp.cvvOnly && hf('mp-csc', `CVV for ${citCardText || 'the saved card'}`, 'securityCode', { maxWidth: 180 })}
              <div className="row" style={{ marginTop: 14 }}>
                <button className="tk-go" onClick={submitCard} disabled={!mp.ready || !!busy}>{!mp.ready ? 'Loading card form…' : busy === 'pay' ? 'Working…' : `Pay ${s.currency} ${amount.toFixed(2)}`}</button>
                <button className="ghost" onClick={() => { setMp(null); live.reset(); setBusy(''); setStage(''); }} disabled={busy === 'pay' && !live.pause}>Start over</button>
              </div>
            </div>
          )}

          {cybs && cy && (
            <div className="tk-form">
              <h2>{cy.savedCard ? 'Saved card' : 'Card details'}</h2>
              {cy.savedCard ? <p className="hint">Instrument identifier <span className="mono">{citToken}</span>, expiry {citSel?.card?.expiry?.month ? `${citSel.card.expiry.month}/${citSel.card.expiry.year}` : 'not set'}. No CVV.</p> : (<>
                <label className="f">Card number</label><div id="cy-number" className="mf-field" />
                <div className="grid g3">
                  <div><label className="f">Month</label><input inputMode="numeric" maxLength={2} value={exp.month} onChange={(e) => setExp({ ...exp, month: e.target.value.replace(/\D/g, '') })} /></div>
                  <div><label className="f">Year</label><input inputMode="numeric" maxLength={4} placeholder="YYYY" value={exp.year} onChange={(e) => setExp({ ...exp, year: e.target.value.replace(/\D/g, '') })} /></div>
                  <div><label className="f">CVV</label><div id="cy-csc" className="mf-field" /></div>
                </div>
              </>)}
              <div className="row" style={{ marginTop: 14 }}>
                <button className="tk-go" onClick={submitCybs} disabled={!cy.ready || !!busy || (!cy.savedCard && !(exp.month && exp.year))}>{!cy.ready ? 'Loading card form…' : busy === 'pay' ? 'Working…' : `Pay ${s.currency} ${amount.toFixed(2)}`}</button>
                <button className="ghost" onClick={() => { setCy(null); live.reset(); setBusy(''); setStage(''); }} disabled={busy === 'pay' && !live.pause}>Start over</button>
              </div>
            </div>
          )}

          <PauseBar live={live} compact />
          {stage && <p className="tk-stage">{live.pause ? `Paused before: ${live.pause.next}` : stage}</p>}
          {dropin && <div id="gd-dropin" className="tk-dropin" />}
          <div ref={challengeRef} className="tk-challenge" />

          {err && (
            <div className="tk-result">
              <div className="msg bad">{err.error}{err.ref && <> · <Link href={`/orders/${err.ref}`}>open order {err.ref}</Link></>}</div>
              {err.insights && <Insights items={err.insights} />}
            </div>
          )}
          {result && (
            <div className="tk-result">
              {result.ref && !('saved' in result) && <p>Order <Link className="mono" href={`/orders/${result.ref}`}>{result.ref}</Link></p>}
              {'saved' in result && <div className={`msg ${result.saved ? 'good' : 'warn'}`}>{result.saved ? <>Card saved. See it in <Link href="/cards">Saved cards</Link>.</> : 'The card form closed without saving.'}</div>}
              {result.insights && <Insights items={result.insights} />}
            </div>
          )}
        </div>
      </aside>
      <div ref={methodRef} style={{ display: 'none' }} aria-hidden="true" />
    </div>
    <LiveLog live={live} stepMode={!!s.stepMode} />
    </>
  );
}
