'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const ENVS = [['test', 'Test'], ['staging', 'Staging'], ['production', 'Production']];

export default function AdminForm({ cfg, creds, callbackUrl, returnUrl }) {
  const router = useRouter();
  const [tab, setTab] = useState('creds');
  const [envs, setEnvs] = useState(cfg.envs);
  const [c, setC] = useState(Object.fromEntries(ENVS.map(([e]) => [e, { publicKey: creds[e].publicKey, apiPassword: '', mpgsPassword: '', cybsKeyId: creds[e].cybsKeyId, cybsSecret: '' }])));
  const [g, setG] = useState({ allowDemoOnProduction: cfg.allowDemoOnProduction, offerMoto: cfg.offerMoto, motoExtra: cfg.motoExtra, currencies: cfg.currencies, merchantName: cfg.merchantName, publicBaseUrl: cfg.publicBaseUrl, prodMaxAmount: cfg.prodMaxAmount, prodDailyPayments: cfg.prodDailyPayments });
  const [pw, setPw] = useState({ demoPassword: '', adminPassword: '' });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true); setMsg(null);
    const r = await fetch('/api/admin/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ envs, creds: c, ...g, ...pw }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? { tone: 'good', text: 'Saved.' } : { tone: 'bad', text: j.error || 'Save failed' });
    if (r.ok) { setPw({ demoPassword: '', adminPassword: '' }); setC(Object.fromEntries(ENVS.map(([e]) => [e, { ...c[e], apiPassword: '', mpgsPassword: '', cybsSecret: '' }]))); router.refresh(); }
  }
  const T = (id, label) => <button type="button" className={tab === id ? '' : 'ghost'} onClick={() => setTab(id)}>{label}</button>;

  return (
    <div>
      <h1>Admin</h1>
      <p className="sub">UAE only. Passwords are stored encrypted and never sent back to the browser.</p>
      {!cfg.adminPasswordSet && <div className="msg warn">You are signed in with ADMIN_INITIAL_PASSWORD. Set an admin password under Users.</div>}
      <div className="tabs">{T('creds', 'Credentials')}{T('urls', 'Endpoints')}{T('general', 'General')}{T('users', 'Users')}</div>

      {tab === 'creds' && (
        <div className="grid g3">
          {ENVS.map(([e, label]) => (
            <div className="card" key={e}>
              <h2>{label} {e === 'production' && <span className="pill warn">live</span>}</h2>
              <label className="f">Merchant public key</label>
              <input value={c[e].publicKey} onChange={(ev) => setC({ ...c, [e]: { ...c[e], publicKey: ev.target.value } })} />
              <label className="f">API password</label>
              <input type="password" placeholder={creds[e].passwordSet ? `Saved${creds[e].updatedAt ? `, updated ${new Date(creds[e].updatedAt).toLocaleDateString()}` : ''}. Leave blank to keep.` : 'Not set'} value={c[e].apiPassword} onChange={(ev) => setC({ ...c, [e]: { ...c[e], apiPassword: ev.target.value } })} />
              <p className="muted" style={{ fontSize: 12 }}>API: {envs[e].apiBase}{creds[e].updatedAt && <><br />Updated {new Date(creds[e].updatedAt).toLocaleString()}</>}</p>
              <h3 style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>MPGS direct</h3>
              {[['baseUrl', 'Gateway base URL', 'https://na-gateway.mastercard.com'], ['version', 'API version', '80'], ['merchantId', 'Merchant ID', '20100000101']].map(([k, l, ph]) => (
                <div key={k}><label className="f">{l}</label><input className={k === 'baseUrl' ? '' : 'mono'} placeholder={ph} value={envs[e].mpgs?.[k] || ''} onChange={(ev) => setEnvs({ ...envs, [e]: { ...envs[e], mpgs: { ...(envs[e].mpgs || {}), [k]: ev.target.value } } })} /></div>
              ))}
              <label className="f">API (integration) password</label>
              <input type="password" placeholder={creds[e].mpgsPasswordSet ? `Saved${creds[e].updatedAt ? `, updated ${new Date(creds[e].updatedAt).toLocaleDateString()}` : ''}. Leave blank to keep.` : 'Not set'} value={c[e].mpgsPassword} onChange={(ev) => setC({ ...c, [e]: { ...c[e], mpgsPassword: ev.target.value } })} />
              <p className="muted" style={{ fontSize: 12 }}>Sent as Basic merchant.&lt;MID&gt;:&lt;password&gt;. UAE PGW runs on v80.</p>
              <h3 style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>CYBS direct</h3>
              {[['host', 'REST host', 'api.cybersource.com'], ['merchantId', 'Merchant ID (v-c-merchant-id)', '20100000202']].map(([k, l, ph]) => (
                <div key={k}><label className="f">{l}</label><input className="mono" placeholder={ph} value={envs[e].cybs?.[k] || ''} onChange={(ev) => setEnvs({ ...envs, [e]: { ...envs[e], cybs: { ...(envs[e].cybs || {}), [k]: ev.target.value } } })} /></div>
              ))}
              <label className="f">REST key ID (shared secret key)</label>
              <input className="mono" value={c[e].cybsKeyId} onChange={(ev) => setC({ ...c, [e]: { ...c[e], cybsKeyId: ev.target.value } })} />
              <label className="f">Shared secret (Base64)</label>
              <input type="password" placeholder={creds[e].cybsSecretSet ? `Saved${creds[e].updatedAt ? `, updated ${new Date(creds[e].updatedAt).toLocaleDateString()}` : ''}. Leave blank to keep.` : 'Not set'} value={c[e].cybsSecret} onChange={(ev) => setC({ ...c, [e]: { ...c[e], cybsSecret: ev.target.value } })} />
              <p className="muted" style={{ fontSize: 12 }}>HTTP Signature (HmacSHA256) over host, v-c-date, request-target, digest, v-c-merchant-id, same as the 11-Nov POC.</p>
            </div>
          ))}
        </div>
      )}

      {tab === 'urls' && (
        <div className="grid g3">
          {ENVS.map(([e, label]) => (
            <div className="card" key={e}>
              <h2>{label}</h2>
              {[['apiBase', 'API base URL'], ['sdkUrl', 'Checkout SDK script'], ['hppUrl', 'HPP redirect URL ({sessionId})']].map(([k, l]) => (
                <div key={k}><label className="f">{l}</label><input value={envs[e][k]} onChange={(ev) => setEnvs({ ...envs, [e]: { ...envs[e], [k]: ev.target.value } })} /></div>
              ))}
              {e === 'staging' && <p className="muted" style={{ fontSize: 12 }}>Staging HPP base comes from Geidea's checkout script (www.staging.geidea.ae/hpp); the staging SDK path is assumed to follow it.</p>}
            </div>
          ))}
        </div>
      )}

      {tab === 'general' && (
        <div className="card">
          <label className="f">Demo users on Production</label>
          <select value={String(g.allowDemoOnProduction)} onChange={(e) => setG({ ...g, allowDemoOnProduction: e.target.value === 'true' })}><option value="false">Blocked (admin only)</option><option value="true">Allowed</option></select>
          <div className="grid g2">
            <div><label className="f">Production: max amount per payment / capture / MIT</label><input type="number" step="0.01" min="0" value={g.prodMaxAmount} onChange={(e) => setG({ ...g, prodMaxAmount: e.target.value })} /></div>
            <div><label className="f">Production: max new payments per day (Dubai time)</label><input type="number" min="0" value={g.prodDailyPayments} onChange={(e) => setG({ ...g, prodDailyPayments: e.target.value })} /></div>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>Enforced on the server for every route. Production refunds, voids and MITs also ask for confirmation.</p>
          <label className="f">Offer MOTO at checkout</label>
          <select value={String(g.offerMoto)} onChange={(e) => setG({ ...g, offerMoto: e.target.value === 'true' })}><option value="false">No</option><option value="true">Yes</option></select>
          <p className="muted" style={{ fontSize: 12 }}>MOTO sessions send initiatedBy "moto". Geidea Support must enable MOTO on the MID per environment, otherwise Create Session fails with 110 / 019.</p>
          <label className="f">Extra session fields for MOTO (JSON, merged into the request)</label>
          <textarea rows={3} value={g.motoExtra} onChange={(e) => setG({ ...g, motoExtra: e.target.value })} />
          <label className="f">Currencies offered at checkout (comma-separated; each must be enabled on the MID)</label>
          <input value={g.currencies} onChange={(e) => setG({ ...g, currencies: e.target.value })} />
          <label className="f">Merchant name shown on the HPP</label>
          <input value={g.merchantName} onChange={(e) => setG({ ...g, merchantName: e.target.value })} />
          <label className="f">Public base URL (optional override for callback / return URLs)</label>
          <input placeholder="https://your-shop.vercel.app" value={g.publicBaseUrl} onChange={(e) => setG({ ...g, publicBaseUrl: e.target.value })} />
          <h3>URLs sent to Geidea</h3>
          <div className="kv mono"><div>Callback</div><div>{callbackUrl}</div><div>Return</div><div>{returnUrl}?ref=…</div></div>
        </div>
      )}

      {tab === 'users' && (
        <div className="card">
          <label className="f">New demo password (blank keeps current; default is "demo")</label>
          <input type="password" value={pw.demoPassword} onChange={(e) => setPw({ ...pw, demoPassword: e.target.value })} />
          <label className="f">New admin password (blank keeps current)</label>
          <input type="password" value={pw.adminPassword} onChange={(e) => setPw({ ...pw, adminPassword: e.target.value })} />
        </div>
      )}

      <div className="row"><button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save all settings'}</button></div>
      {msg && <div className={`msg ${msg.tone}`}>{msg.text}</div>}
    </div>
  );
}
