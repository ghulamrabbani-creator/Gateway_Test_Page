'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSettings, useCart } from '@/lib/clientState';
import { SettingsChips } from '@/components/SettingsPanel';
import Insights from '@/components/Insights';
import { PRODUCTS } from '@/lib/products';
import { genRef, genAgreement } from '@/lib/refs';

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

const OP = { Pay: 'Sale, charged now', PreAuthorize: 'Pre-auth, capture later' };
const AUTH = { '3ds': '3-D Secure', none: 'No 3DS', moto: 'MOTO, no 3DS' };

export default function Checkout() {
  const [s] = useSettings();
  const [cart, setCart] = useCart();
  const [c, setC] = useState({ firstName: 'Ghulam', lastName: 'Rabbani', email: 'test@example.com', phone: '562186147', phoneCountryCode: '+971', city: 'Dubai', street: 'Al Barsha' });
  const [customAmount, setCustomAmount] = useState('');
  const [merchantRef, setMerchantRef] = useState('');
  const [agreementId, setAgreementId] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState(null);
  const [dropin, setDropin] = useState(false);
  const [mp, setMp] = useState(null); // { ref, sessionId, cvvOnly, ready }
  const [cy, setCy] = useState(null); // { ref, savedCard, ready }
  const [exp, setExp] = useState({ month: '', year: '' });
  const microformRef = useRef(null);
  const [stage, setStage] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const challengeRef = useRef(null);
  const methodRef = useRef(null);

  const mpgs = s.route === 'mpgs';
  const cybs = s.route === 'cybs';
  const direct = mpgs || cybs;
  const lines = Object.entries(cart.items).filter(([, q]) => q > 0).map(([id, q]) => ({ p: PRODUCTS.find((x) => x.id === id), q })).filter((l) => l.p);
  const total = lines.reduce((a, l) => a + l.p.price * l.q, 0);
  const amount = customAmount !== '' ? Number(customAmount) : total;
  const tokenSet = cybs ? s.cybsIi : mpgs ? s.mpgsToken : s.tokenId;
  const route = cybs ? 'cybs' : mpgs ? 'mpgs' : 'geidea';
  // Agreement: card saved for MIT (Geidea / MPGS), or a repeat CIT on a saved MPGS token
  // (repeat CITs on a saved MPGS token carry no agreement: MPGS treats later payments on an agreement as MITs)
  const needsAgreement = !cybs && !tokenSet && (s.saveCard === 'mit' || s.saveCard === 'citmit');
  const cardLabel = `${tokenSet ? `Saved token ${tokenSet.slice(0, 8)}…` : 'New card'}${s.saveCard !== 'none' && !tokenSet ? `, save for ${s.saveCard === 'citmit' ? 'CIT + MIT' : s.saveCard.toUpperCase()}` : ''}`;

  // ---------- Geidea PGW (HPP) ----------
  async function payGeidea() {
    setBusy('pay'); setErr(null);
    try {
      const { ok, j } = await post('/api/checkout', { items: cart.items, settings: s, customer: c, customAmount, merchantRef, agreementId: needsAgreement ? agreementId : '' });
      if (!ok) { setErr(j); setBusy(''); return; }
      const go = async (outcome, data) => {
        try { await post('/api/checkout/result', { ref: j.ref, outcome, data: data ?? null }); } catch {}
        window.location.href = `/return?ref=${encodeURIComponent(j.ref)}&sdk=${outcome}`;
      };
      if (j.mode === 'redirect') { window.location.href = j.hppUrl; return; }
      await loadScript(j.sdkUrl, () => !!window.GeideaCheckout);
      const payment = new window.GeideaCheckout((d) => go('success', d), (d) => go('error', d), (d) => go('cancel', d));
      if (j.mode === 'dropin') {
        // Drop-in renders inside our page: startPayment(sessionId, null, containerId) — per the HPP integration code BESO shows
        setDropin(true);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        document.getElementById('gd-dropin')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        payment.startPayment(j.sessionId, null, 'gd-dropin');
      } else payment.startPayment(j.sessionId);
      setBusy('');
    } catch (e) { setErr({ error: e.message }); setBusy(''); }
  }

  // ---------- MPGS direct: Hosted Session ----------
  async function startMpgs() {
    setBusy('session'); setErr(null); setFieldErr({});
    try {
      const { ok, j } = await post('/api/mpgs/checkout', { settings: s, customer: c, amount, merchantRef, agreementId: needsAgreement ? agreementId : '' });
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
    await post('/api/checkout/result', { ref: j.ref, outcome: `formSessionUpdate ${r?.status}`, data: r ?? null });
    if (r?.status !== 'ok') {
      if (r?.status === 'fields_in_error') setFieldErr(r.errors || {});
      setErr({ error: r?.status === 'fields_in_error' ? 'Check the highlighted card fields.' : `Card form: ${r?.status}${r?.errors?.message ? ` (${r.errors.message})` : ''}` });
      setBusy(''); setStage('');
      return;
    }
    const done = () => { window.location.href = `/mpgs/complete?ref=${encodeURIComponent(j.ref)}`; };
    if (s.auth !== '3ds') return done();
    try {
      setStage('3-D Secure: checking the card…');
      const init = await post(`/api/mpgs/${encodeURIComponent(j.ref)}/authenticate`, { step: 'initiate' });
      if (!init.ok) { setErr(init.j); setBusy(''); setStage(''); return; }
      if (init.j.recommendation !== 'PROCEED') return done();
      if (init.j.html && methodRef.current) {
        injectHtml(methodRef.current, init.j.html);
        if (init.j.methodSupported === 'SUPPORTED') await new Promise((res) => setTimeout(res, 3000)); // let the ACS method call finish
      }
      setStage('3-D Secure: authenticating…');
      const auth = await post(`/api/mpgs/${encodeURIComponent(j.ref)}/authenticate`, { step: 'authenticate', browser: browserInfo() });
      if (!auth.ok) { setErr(auth.j); setBusy(''); setStage(''); return; }
      if (auth.j.challenge && auth.j.html) {
        setStage('3-D Secure: complete the challenge below');
        injectHtml(challengeRef.current, auth.j.html); // ends at /api/mpgs/3ds-return, which sends the page to /mpgs/complete
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
      const { ok, j } = await post('/api/cybs/checkout', { settings: s, customer: c, amount, merchantRef });
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

  async function cyStep(step, extra = {}) {
    const r = await post(`/api/cybs/${encodeURIComponent(cy.ref)}/step`, { step, ...extra });
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
      if (s.auth !== '3ds') { setStage('Authorizing…'); await cyStep('pay'); return done(); }
      setStage('3-D Secure: device data collection…');
      const setup = await cyStep('setup');
      if (!setup.ok || !setup.url) throw Object.assign(new Error('Payer auth setup failed'), { payload: setup });
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 10000);
        const on = (ev) => { let host = ''; try { host = new URL(ev.origin).hostname; } catch {} if (/cardinalcommerce\.com$/.test(host)) { clearTimeout(t); window.removeEventListener('message', on); resolve(); } };
        window.addEventListener('message', on);
        methodRef.current.innerHTML = `<iframe name="cy-ddc" height="1" width="1" style="display:none"></iframe><form id="cy-ddc-form" target="cy-ddc" method="POST" action="${setup.url}"><input type="hidden" name="JWT" value="${setup.accessToken}"></form>`;
        document.getElementById('cy-ddc-form').submit();
      });
      setStage('3-D Secure: checking enrolment and authorizing…');
      const enrol = await cyStep('enrol', { browser: browserInfo(), referenceId: setup.referenceId });
      if (enrol.challenge && enrol.stepUpUrl) {
        setStage('3-D Secure: complete the challenge below');
        challengeRef.current.innerHTML = `<iframe name="cy-stepup" style="width:100%;min-height:600px;border:0"></iframe><form id="cy-stepup-form" target="cy-stepup" method="POST" action="${enrol.stepUpUrl}"><input type="hidden" name="JWT" value="${enrol.accessToken}"><input type="hidden" name="MD" value="${cy.ref}"></form>`;
        document.getElementById('cy-stepup-form').submit();
        challengeRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return; // Cardinal posts to /api/cybs/3ds-return, which sends the page to /cybs/complete
      }
      done();
    } catch (e) { setErr({ error: e.message, insights: e.payload?.insights }); setBusy(''); setStage(''); }
  }

  useEffect(() => { setMp(null); setCy(null); }, [s.route, s.env]);

  const f = (k, label, type = 'text') => (<div><label className="f">{label}</label><input type={type} value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} /></div>);
  const hf = (id, label, key, style) => (
    <div style={style}><label className="f">{label}</label><input id={id} readOnly className={`hosted ${fieldErr[key] ? 'err' : ''}`} />{fieldErr[key] && <div className="field-err">{fieldErr[key]}</div>}</div>
  );

  return (
    <div>
      <SettingsChips s={s} />
      <h1>Checkout</h1>
      <p className="sub">{mpgs ? 'MPGS direct: the card form below is served by Mastercard (Hosted Session). ' : cybs ? 'CYBS direct: card number and CVV fields are served by CyberSource (Microform). ' : ''}Change gateway options on the <Link href="/">Shop</Link> page.</p>
      <div className="grid checkout">
        <div className="card">
          <div className="paysum">
            <div className="paysum-amt">
              <span className="muted">Amount</span>
              <div className="amt"><span className="ccy">{s.currency}</span>{(amount || 0).toFixed(2)}</div>
              <div className="muted" style={{ fontSize: 13 }}>
                {customAmount !== '' ? 'Custom amount' : lines.length ? `${lines.reduce((a, l) => a + l.q, 0)} item${lines.length > 1 || lines[0].q > 1 ? 's' : ''} from the cart` : 'Cart is empty'}
                {lines.length > 0 && <> · <button className="linkbtn" onClick={() => setCart({ items: {} })}>clear cart</button></>}
              </div>
            </div>
            <div style={{ minWidth: 160 }}>
              <label className="f" style={{ marginTop: 0 }}>Custom amount</label>
              <input type="number" step="0.01" min="0" value={customAmount} onChange={(e) => setCustomAmount(e.target.value)} placeholder={total.toFixed(2)} />
            </div>
          </div>
          <div className="grid g2" style={{ marginTop: 14 }}>
            <div>
              <label className="f" style={{ marginTop: 0 }}>Merchant reference</label>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input className="mono" placeholder="Blank = generated" value={merchantRef} onChange={(e) => setMerchantRef(e.target.value)} disabled={!!(mp || cy)} />
                <button type="button" className="ghost" onClick={() => setMerchantRef(genRef(route))} disabled={!!(mp || cy)}>Generate</button>
              </div>
            </div>
            {needsAgreement && (
              <div>
                <label className="f" style={{ marginTop: 0 }}>Agreement ID ({s.agreementType || 'Unscheduled'}){mpgs && s.mpgsToken ? ', from the saved card' : ''}</label>
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <input className="mono" placeholder="Blank = generated" value={agreementId} onChange={(e) => setAgreementId(e.target.value)} disabled={!!(mp || cy)} />
                  <button type="button" className="ghost" onClick={() => setAgreementId(genAgreement(route))} disabled={!!(mp || cy)}>Generate</button>
                </div>
              </div>
            )}
          </div>
          <dl className="paysum-facts">
            <dt>Route</dt><dd>{cybs ? 'CYBS direct (not in PGW)' : mpgs ? 'MPGS direct (not in PGW)' : 'Geidea PGW'}</dd>
            <dt>Operation</dt><dd>{OP[s.operation]}</dd>
            <dt>Authentication</dt><dd>{AUTH[direct ? s.auth : s.auth === 'moto' ? 'moto' : '3ds']}</dd>
            <dt>Card</dt><dd>{cardLabel}{mpgs && s.mpgsToken && s.mpgsCard ? ` · ${s.mpgsCard}` : cybs && s.cybsIi && s.cybsCard ? ` · ${s.cybsCard}` : ''}</dd>
          </dl>

          {!direct && <button onClick={payGeidea} disabled={!!busy || !(amount > 0)}>{busy ? 'Opening payment page…' : `Pay ${s.currency} ${(amount || 0).toFixed(2)}`}</button>}

          {mpgs && !mp && <button onClick={startMpgs} disabled={!!busy || !(amount > 0)}>{busy === 'session' ? 'Creating MPGS session…' : 'Continue to card details'}</button>}
          {mpgs && mp && (
            <div className="hosted-form">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2 style={{ margin: 0 }}>{mp.cvvOnly ? 'Confirm CVV' : 'Card details'}</h2>
                <span className="muted mono" style={{ fontSize: 12 }}>{mp.ref}</span>
              </div>
              {!mp.cvvOnly && (<>
                {hf('mp-number', 'Card number', 'cardNumber')}
                <div className="grid g3">
                  {hf('mp-month', 'Expiry month (MM)', 'expiryMonth')}
                  {hf('mp-year', 'Expiry year (YY)', 'expiryYear')}
                  {hf('mp-csc', 'CVV', 'securityCode')}
                </div>
                {hf('mp-name', 'Name on card', 'nameOnCard')}
              </>)}
              {mp.cvvOnly && hf('mp-csc', `CVV for ${s.mpgsCard || 'the saved card'} (token ${s.mpgsToken.slice(0, 8)}…)`, 'securityCode', { maxWidth: 200 })}
              <div className="row" style={{ marginTop: 16 }}>
                <button onClick={submitCard} disabled={!mp.ready || !!busy}>{!mp.ready ? 'Loading card form…' : busy === 'pay' ? 'Working…' : `Pay ${s.currency} ${(amount || 0).toFixed(2)}`}</button>
                <button className="ghost" onClick={() => setMp(null)} disabled={busy === 'pay'}>Start over</button>
              </div>
              {stage && <p className="muted" style={{ marginBottom: 0 }}>{stage}</p>}
            </div>
          )}

          {cybs && !cy && <button onClick={startCybs} disabled={!!busy || !(amount > 0)}>{busy === 'session' ? 'Creating CYBS session…' : s.cybsIi ? 'Continue with saved card' : 'Continue to card details'}</button>}
          {cybs && cy && (
            <div className="hosted-form">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2 style={{ margin: 0 }}>{cy.savedCard ? 'Saved card' : 'Card details'}</h2>
                <span className="muted mono" style={{ fontSize: 12 }}>{cy.ref}</span>
              </div>
              {cy.savedCard ? <p className="muted">Instrument identifier <span className="mono">{s.cybsIi}</span>, expiry {s.cybsExpiry?.month ? `${s.cybsExpiry.month}/${s.cybsExpiry.year}` : 'not set'}. No CVV.</p> : (<>
                <label className="f">Card number</label><div id="cy-number" className="mf-field" />
                <div className="grid g3">
                  <div><label className="f">Expiry month (MM)</label><input inputMode="numeric" maxLength={2} value={exp.month} onChange={(e) => setExp({ ...exp, month: e.target.value.replace(/\D/g, '') })} /></div>
                  <div><label className="f">Expiry year (YYYY)</label><input inputMode="numeric" maxLength={4} value={exp.year} onChange={(e) => setExp({ ...exp, year: e.target.value.replace(/\D/g, '') })} /></div>
                  <div><label className="f">CVV</label><div id="cy-csc" className="mf-field" /></div>
                </div>
              </>)}
              <div className="row" style={{ marginTop: 16 }}>
                <button onClick={submitCybs} disabled={!cy.ready || !!busy || (!cy.savedCard && !(exp.month && exp.year))}>{!cy.ready ? 'Loading card form…' : busy === 'pay' ? 'Working…' : `Pay ${s.currency} ${(amount || 0).toFixed(2)}`}</button>
                <button className="ghost" onClick={() => setCy(null)} disabled={busy === 'pay'}>Start over</button>
              </div>
              {stage && <p className="muted" style={{ marginBottom: 0 }}>{stage}</p>}
            </div>
          )}

          {err && (
            <div style={{ marginTop: 14 }}>
              <div className="msg bad">{err.error}{err.ref && <> · <Link href={`/orders/${err.ref}`}>open order {err.ref}</Link></>}</div>
              {err.insights && <Insights items={err.insights} />}
            </div>
          )}
        </div>

        <details className="card customer" open={!direct}>
          <summary><h2 style={{ display: 'inline', margin: 0 }}>Customer</h2> <span className="muted" style={{ fontSize: 13 }}>{c.firstName} {c.lastName} · {c.email}</span></summary>
          <div className="grid g2">{f('firstName', 'First name')}{f('lastName', 'Last name')}</div>
          {f('email', 'Email', 'email')}
          <div className="grid g2">{f('phoneCountryCode', 'Country code')}{f('phone', 'Phone')}</div>
          <div className="grid g2">{f('city', 'City')}{f('street', 'Street')}</div>
          {mpgs && <p className="muted" style={{ fontSize: 12 }}>Kept on the order for reference. Not sent to MPGS in this release.</p>}
          {cybs && <p className="muted" style={{ fontSize: 12 }}>Sent to CYBS as billTo (CYBS requires it).</p>}
        </details>
      </div>
      <div ref={methodRef} style={{ display: 'none' }} aria-hidden="true" />
      <div ref={challengeRef} className="challenge" />
      {dropin && (
        <div className="card">
          <h2>Payment (drop-in)</h2>
          <div id="gd-dropin" style={{ width: '100%', maxWidth: 460, minHeight: 400, margin: '0 auto' }} />
        </div>
      )}
    </div>
  );
}
