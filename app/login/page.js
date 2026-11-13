'use client';
import { useState } from 'react';

export default function Login() {
  const [u, setU] = useState('demo');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErr(j.error || 'Sign-in failed');
    window.location.href = '/';
  }
  return (
    <div className="login card">
      <h1>UAE Test Shop</h1>
      <p className="sub">Geidea payment gateway test merchant</p>
      <div className="msg warn" style={{ fontSize: 12 }}>Demo login: <b>demo / demo</b>. Admins manage credentials.</div>
      <form onSubmit={submit}>
        <label className="f">Username</label>
        <input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" />
        <label className="f">Password</label>
        <input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" />
        {err && <div className="msg bad">{err}</div>}
        <div style={{ marginTop: 14 }}><button disabled={busy}>{busy ? 'Signing in…' : 'Enter shop'}</button></div>
      </form>
    </div>
  );
}
