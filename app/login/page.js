'use client';
import { useState } from 'react';

export default function Login() {
  const [u, setU] = useState('');
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
      <h1>Gateway test bench</h1>
      <p className="sub">Run test payments against the Geidea gateway in the UAE and see what happened to each one.</p>
      <p className="muted" style={{ fontSize: 14 }}>Sign in with the username an admin created for you; your saved cards are kept under it. The shared tester login is <b>demo</b> / <b>demo</b>.</p>
      <form onSubmit={submit}>
        <label className="f">Username</label>
        <input value={u} autoCapitalize="none" spellCheck={false} onChange={(e) => setU(e.target.value)} autoComplete="username" />
        <label className="f">Password</label>
        <input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" />
        {err && <div className="msg bad">{err}</div>}
        <div style={{ marginTop: 14 }}><button disabled={busy}>{busy ? 'Signing in…' : 'Enter shop'}</button></div>
      </form>
    </div>
  );
}
