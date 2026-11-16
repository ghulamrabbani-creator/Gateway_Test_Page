'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fmtDT, fmtD } from '@/lib/time';

const ENVS = [['test', 'Test'], ['staging', 'Staging'], ['production', 'Production']];

function UsersPanel({ users, cardCount }) {
  const router = useRouter();
  const [n, setN] = useState({ username: '', password: '', role: 'tester' });
  const [reset, setReset] = useState({});
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState('');
  async function act(action, username, extra = {}) {
    if (action === 'delete' && !window.confirm(`Delete ${username}? Their saved cards stay, still owned by ${username} (admins see them under All users).`)) return;
    setBusy(`${action}:${username}`); setMsg(null);
    const r = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, username, ...extra }) });
    const j = await r.json().catch(() => ({}));
    setBusy('');
    const done = { create: `Created ${username}.`, reset: `New password set for ${username}.`, role: `Role changed for ${username}; applies at their next sign-in.`, disable: `${username} disabled; applies at their next sign-in.`, enable: `${username} enabled.`, delete: `${username} deleted.` }[action];
    setMsg(r.ok ? { tone: 'good', text: done } : { tone: 'bad', text: j.error || 'Failed' });
    if (r.ok) { if (action === 'create') setN({ username: '', password: '', role: 'tester' }); if (action === 'reset') setReset({ ...reset, [username]: '' }); router.refresh(); }
  }
  return (
    <div className="card">
      <h2>Named users</h2>
      <p className="sub">Each user signs in with their own username and password. Saved cards belong to the user whose transaction saved them, and Saved cards and the CIT / MIT pickers show only that user's cards. Orders stay visible to everyone. Testers run transactions (Production only if allowed under General); admins also manage credentials and users.</p>
      <table>
        <thead><tr><th>Username</th><th>Role</th><th>Status</th><th>Saved cards</th><th>Last sign-in</th><th>New password</th><th /></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.username}>
              <td className="mono">{u.username}<div className="muted" style={{ fontSize: 11 }}>by {u.created_by || '—'}, {fmtD(u.created_at)}</div></td>
              <td><select value={u.role} disabled={!!busy} onChange={(e) => act('role', u.username, { role: e.target.value })}><option value="tester">Tester</option><option value="admin">Admin</option></select></td>
              <td><span className={`pill ${u.disabled ? 'bad' : 'good'}`}>{u.disabled ? 'Disabled' : 'Active'}</span></td>
              <td>{cardCount[u.username] || 0}</td>
              <td className="muted">{u.last_login_at ? fmtDT(u.last_login_at) : 'Never'}</td>
              <td><div className="row nowrap"><input type="password" placeholder="8+ characters" value={reset[u.username] || ''} onChange={(e) => setReset({ ...reset, [u.username]: e.target.value })} style={{ width: 150 }} /><button className="ghost small" disabled={!!busy || !(reset[u.username] || '').length} onClick={() => act('reset', u.username, { password: reset[u.username] })}>Set</button></div></td>
              <td><div className="row nowrap"><button className="ghost small" disabled={!!busy} onClick={() => act(u.disabled ? 'enable' : 'disable', u.username)}>{u.disabled ? 'Enable' : 'Disable'}</button><button className="ghost small" disabled={!!busy} onClick={() => act('delete', u.username)}>Delete</button></div></td>
            </tr>
          ))}
          {!users.length && <tr><td colSpan={7} className="muted">No named users yet. Built-in demo and admin hold {(cardCount.demo || 0) + (cardCount.admin || 0)} saved cards.</td></tr>}
        </tbody>
      </table>
      <h3>Create a user</h3>
      <div className="row">
        <div><label className="f">Username</label><input className="mono" placeholder="e.g. sidra" value={n.username} onChange={(e) => setN({ ...n, username: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') })} /></div>
        <div><label className="f">Password</label><input type="password" placeholder="8+ characters" value={n.password} onChange={(e) => setN({ ...n, password: e.target.value })} /></div>
        <div><label className="f">Role</label><select value={n.role} onChange={(e) => setN({ ...n, role: e.target.value })}><option value="tester">Tester</option><option value="admin">Admin</option></select></div>
        <div style={{ alignSelf: 'flex-end' }}><button disabled={!!busy || n.username.length < 3 || n.password.length < 8} onClick={() => act('create', n.username, { password: n.password, role: n.role })}>{busy.startsWith('create') ? 'Creating…' : 'Create user'}</button></div>
      </div>
      {msg && <div className={`msg ${msg.tone}`}>{msg.text}</div>}
      <p className="hint">Changes to role or Disabled apply when the user next signs in (a session lasts up to 12 hours). Passwords are stored as scrypt hashes.</p>
    </div>
  );
}

export default function AdminForm({ cfg, creds, callbackUrl, returnUrl, users = [], cardCount = {} }) {
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
              <input type="password" placeholder={creds[e].passwordSet ? `Saved${creds[e].updatedAt ? `, updated ${fmtD(creds[e].updatedAt)}` : ''}. Leave blank to keep.` : 'Not set'} value={c[e].apiPassword} onChange={(ev) => setC({ ...c, [e]: { ...c[e], apiPassword: ev.target.value } })} />
              <p className="muted" style={{ fontSize: 12 }}>API: {envs[e].apiBase}{creds[e].updatedAt && <><br />Updated {fmtDT(creds[e].updatedAt)}</>}</p>
              <h3 style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>MPGS direct</h3>
              {[['baseUrl', 'Gateway base URL', 'https://na-gateway.mastercard.com'], ['version', 'API version', '80'], ['merchantId', 'Merchant ID', '20100000101']].map(([k, l, ph]) => (
                <div key={k}><label className="f">{l}</label><input className={k === 'baseUrl' ? '' : 'mono'} placeholder={ph} value={envs[e].mpgs?.[k] || ''} onChange={(ev) => setEnvs({ ...envs, [e]: { ...envs[e], mpgs: { ...(envs[e].mpgs || {}), [k]: ev.target.value } } })} /></div>
              ))}
              <label className="f">API (integration) password</label>
              <input type="password" placeholder={creds[e].mpgsPasswordSet ? `Saved${creds[e].updatedAt ? `, updated ${fmtD(creds[e].updatedAt)}` : ''}. Leave blank to keep.` : 'Not set'} value={c[e].mpgsPassword} onChange={(ev) => setC({ ...c, [e]: { ...c[e], mpgsPassword: ev.target.value } })} />
              <p className="muted" style={{ fontSize: 12 }}>Sent as Basic merchant.&lt;MID&gt;:&lt;password&gt;. UAE PGW runs on v80.</p>
              <h3 style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>CYBS direct</h3>
              {[['host', 'REST host', 'api.cybersource.com'], ['merchantId', 'Merchant ID (v-c-merchant-id)', '20100000202']].map(([k, l, ph]) => (
                <div key={k}><label className="f">{l}</label><input className="mono" placeholder={ph} value={envs[e].cybs?.[k] || ''} onChange={(ev) => setEnvs({ ...envs, [e]: { ...envs[e], cybs: { ...(envs[e].cybs || {}), [k]: ev.target.value } } })} /></div>
              ))}
              <label className="f">REST key ID (shared secret key)</label>
              <input className="mono" value={c[e].cybsKeyId} onChange={(ev) => setC({ ...c, [e]: { ...c[e], cybsKeyId: ev.target.value } })} />
              <label className="f">Shared secret (Base64)</label>
              <input type="password" placeholder={creds[e].cybsSecretSet ? `Saved${creds[e].updatedAt ? `, updated ${fmtD(creds[e].updatedAt)}` : ''}. Leave blank to keep.` : 'Not set'} value={c[e].cybsSecret} onChange={(ev) => setC({ ...c, [e]: { ...c[e], cybsSecret: ev.target.value } })} />
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

      {tab === 'users' && <UsersPanel users={users} cardCount={cardCount} />}
      {tab === 'users' && (
        <div className="card">
          <h2>Built-in logins</h2>
          <p className="sub">The shared demo login (tester) and the admin login stay. Cards saved while signed in as demo belong to demo.</p>
          <label className="f">New demo password (blank keeps current; default is "demo")</label>
          <input type="password" value={pw.demoPassword} onChange={(e) => setPw({ ...pw, demoPassword: e.target.value })} />
          <label className="f">New admin password (blank keeps current)</label>
          <input type="password" value={pw.adminPassword} onChange={(e) => setPw({ ...pw, adminPassword: e.target.value })} />
        </div>
      )}

      <div className="row"><button onClick={save} disabled={busy}>{busy ? 'Saving…' : tab === 'users' ? 'Save built-in passwords' : 'Save all settings'}</button></div>
      {msg && <div className={`msg ${msg.tone}`}>{msg.text}</div>}
    </div>
  );
}
