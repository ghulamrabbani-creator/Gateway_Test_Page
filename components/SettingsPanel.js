'use client';
// Shop settings: every toggle maps to a Create Session field (see lib/geidea.js createHppSession).

function Seg({ value, onChange, options }) {
  return (
    <div className="seg">
      {options.map(([v, label, disabled]) => (
        <button type="button" key={v} disabled={disabled} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

export default function SettingsPanel({ s, set, pub, role }) {
  const up = (k) => (v) => set({ ...s, [k]: v });
  const prodLocked = role !== 'admin' && !pub.allowDemoOnProduction;
  const bool = (k) => [[true, 'Show'], [false, 'Hide']].map(([v, l]) => [v, l]);
  return (
    <div className="card">
      <h2>Gateway &amp; checkout</h2>
      <label className="f">Region</label>
      <div className="seg"><button type="button" className="on">UAE</button></div>
      <label className="f">Environment</label>
      <Seg value={s.env} onChange={up('env')} options={[['test', 'Test'], ['staging', 'Staging'], ['production', prodLocked ? 'Production (admin)' : 'Production', prodLocked]]} />
      <label className="f">Route</label>
      <Seg value="geidea" onChange={() => {}} options={[['geidea', 'Geidea PGW'], ['mpgs', 'MPGS direct (phase 2)', true], ['cybs', 'CYBS direct (phase 3)', true]]} />
      <label className="f">Checkout mode</label>
      <Seg value={s.mode} onChange={up('mode')} options={[['modal', 'Modal'], ['dropin', 'Drop-in'], ['redirect', 'Redirect']]} />
      <label className="f">HPP style</label>
      <Seg value={s.hppProfile} onChange={up('hppProfile')} options={[['simple', 'Simple'], ['compressed', 'Compressed']]} />
      <label className="f">Language</label>
      <Seg value={s.language} onChange={up('language')} options={[['en', 'EN'], ['ar', 'AR']]} />
      <label className="f">Wallet buttons on HPP</label>
      <Seg value={s.hideWallets} onChange={up('hideWallets')} options={[[false, 'Show'], [true, 'Hide']]} />

      <h2 style={{ marginTop: 18 }}>Transaction</h2>
      <label className="f">Operation</label>
      <Seg value={s.operation} onChange={up('operation')} options={[['Pay', 'Sale'], ['PreAuthorize', 'Pre-auth / capture']]} />
      <label className="f">Authentication</label>
      <Seg value={s.auth} onChange={up('auth')} options={[['3ds', '3-D Secure'], ['moto', pub.offerMoto ? 'MOTO' : 'MOTO (off in admin)', !pub.offerMoto]]} />
      <label className="f">Save card (token)</label>
      <Seg value={s.saveCard} onChange={up('saveCard')} options={[['none', 'No'], ['cit', 'CIT'], ['mit', 'MIT'], ['citmit', 'CIT + MIT']]} />
      {(s.saveCard === 'mit' || s.saveCard === 'citmit') && (<>
        <label className="f">Agreement type (MIT)</label>
        <Seg value={s.agreementType} onChange={up('agreementType')} options={[['Unscheduled', 'Unscheduled'], ['Recurring', 'Recurring']]} />
      </>)}
      <label className="f">Currency</label>
      <select value={s.currency} onChange={(e) => up('currency')(e.target.value)}>
        {Array.from(new Set(['AED', ...pub.currencies])).map((c) => <option key={c}>{c}</option>)}
      </select>
      <label className="f">Pay with token (CIT)</label>
      <div className="row">
        <input placeholder="Geidea tokenId" value={s.tokenId} onChange={(e) => up('tokenId')(e.target.value)} style={{ flex: 1 }} />
        {s.tokenId && <button type="button" className="ghost" onClick={() => up('tokenId')('')}>Clear</button>}
      </div>
      <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>With a token set, the payment page asks only for CVV / OTP. Ignored for MOTO.</p>

      <h2 style={{ marginTop: 18 }}>HPP appearance</h2>
      {[['showEmail', 'Email field'], ['showPhone', 'Phone field'], ['showAddress', 'Address field'], ['receiptPage', 'Receipt page'], ['showMerchantName', 'Merchant name']].map(([k, l]) => (
        <div key={k}><label className="f">{l}</label><Seg value={s[k]} onChange={up(k)} options={bool(k)} /></div>
      ))}
      <label className="f">Geidea logo</label>
      <Seg value={s.hideGeideaLogo} onChange={up('hideGeideaLogo')} options={[[false, 'Show'], [true, 'Hide']]} />
      <label className="f">Header colour</label>
      <div className="row"><input type="color" value={s.headerColor || '#ffffff'} onChange={(e) => up('headerColor')(e.target.value)} style={{ width: 60, padding: 2 }} />{s.headerColor && <button type="button" className="ghost" onClick={() => up('headerColor')('')}>Default</button>}</div>
    </div>
  );
}

export function SettingsChips({ s }) {
  const chips = ['UAE', s.env.toUpperCase(), 'GEIDEA', s.mode.toUpperCase(), s.hppProfile.toUpperCase(), s.language.toUpperCase(), s.operation === 'Pay' ? 'SALE' : 'PRE-AUTH', s.auth === 'moto' ? 'MOTO' : '3DS', s.currency];
  if (s.saveCard !== 'none') chips.push(`SAVE ${s.saveCard.toUpperCase()}`);
  if (s.tokenId) chips.push('TOKEN');
  return <div className="chips">{chips.map((c) => <span key={c} className={`pill ${c === 'PRODUCTION' ? 'warn' : ''}`}>{c}</span>)}</div>;
}
