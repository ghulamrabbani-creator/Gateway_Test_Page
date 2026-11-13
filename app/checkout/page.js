'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSettings, useCart } from '@/lib/clientState';
import { SettingsChips } from '@/components/SettingsPanel';
import Insights from '@/components/Insights';
import { PRODUCTS } from '@/lib/products';

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
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState(null);
  const [dropin, setDropin] = useState(false);
  const [mp, setMp] = useState(null); // { ref, sessionId, cvvOnly, ready }
  const [stage, setStage] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const challengeRef = useRef(null);
  const methodRef = useRef(null);

  const mpgs = s.route === 'mpgs';
  const lines = Object.entries(cart.items).filter(([, q]) => q > 0).map(([id, q]) => ({ p: PRODUCTS.find((x) => x.id === id), q })).filter((l) => l.p);
  const total = lines.reduce((a, l) => a + l.p.price * l.q, 0);
  const amount = customAmount !== '' ? Number(customAmount) : total;
  const tokenSet = mpgs ? s.mpgsToken : s.tokenId;
  const cardLabel = `${tokenSet ? `Saved token ${tokenSet.slice(0, 8)}…` : 'New card'}${s.saveCard !== 'none' && !tokenSet ? `, save for ${s.saveCard === 'citmit' ? 'CIT + MIT' : s.saveCard.toUpperCase()}` : ''}`;

  // ---------- Geidea PGW (HPP) ----------
  async function payGeidea() {
    setBusy('pay'); setErr(null);
    try {
      const { ok, j } = await post('/api/checkout', { items: cart.items, settings: s, customer: c, customAmount });
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
      const { ok, j } = await post('/api/mpgs/checkout', { settings: s, customer: c, amount });
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

  useEffect(() => { setMp(null); }, [s.route, s.env]);

  const f = (k, label, type = 'text') => (<div><label className="f">{label}</label><input type={type} value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} /></div>);
  const hf = (id, label, key, style) => (
    <div style={style}><label className="f">{label}</label><input id={id} readOnly className={`hosted ${fieldErr[key] ? 'err' : ''}`} />{fieldErr[key] && <div className="field-err">{fieldErr[key]}</div>}</div>
  );

  return (
    <div>
      <SettingsChips s={s} />
      <h1>Checkout</h1>
      <p className="sub">{mpgs ? 'MPGS direct: the card form below is served by Mastercard (Hosted Session). ' : ''}Change gateway options on the <Link href="/">Shop</Link> page.</p>
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
          <dl className="paysum-facts">
            <dt>Route</dt><dd>{mpgs ? 'MPGS direct (not in PGW)' : 'Geidea PGW'}</dd>
            <dt>Operation</dt><dd>{OP[s.operation]}</dd>
            <dt>Authentication</dt><dd>{AUTH[mpgs ? s.auth : s.auth === 'moto' ? 'moto' : '3ds']}</dd>
            <dt>Card</dt><dd>{cardLabel}</dd>
          </dl>

          {!mpgs && <button onClick={payGeidea} disabled={!!busy || !(amount > 0)}>{busy ? 'Opening payment page…' : `Pay ${s.currency} ${(amount || 0).toFixed(2)}`}</button>}

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
              {mp.cvvOnly && hf('mp-csc', `CVV for token ${s.mpgsToken.slice(0, 8)}…`, 'securityCode', { maxWidth: 200 })}
              <div className="row" style={{ marginTop: 16 }}>
                <button onClick={submitCard} disabled={!mp.ready || !!busy}>{!mp.ready ? 'Loading card form…' : busy === 'pay' ? 'Working…' : `Pay ${s.currency} ${(amount || 0).toFixed(2)}`}</button>
                <button className="ghost" onClick={() => setMp(null)} disabled={busy === 'pay'}>Start over</button>
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

        <details className="card customer" open={!mpgs}>
          <summary><h2 style={{ display: 'inline', margin: 0 }}>Customer</h2> <span className="muted" style={{ fontSize: 13 }}>{c.firstName} {c.lastName} · {c.email}</span></summary>
          <div className="grid g2">{f('firstName', 'First name')}{f('lastName', 'Last name')}</div>
          {f('email', 'Email', 'email')}
          <div className="grid g2">{f('phoneCountryCode', 'Country code')}{f('phone', 'Phone')}</div>
          <div className="grid g2">{f('city', 'City')}{f('street', 'Street')}</div>
          {mpgs && <p className="muted" style={{ fontSize: 12 }}>Kept on the order for reference. Not sent to MPGS in this release.</p>}
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
