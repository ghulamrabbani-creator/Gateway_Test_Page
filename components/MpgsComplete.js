'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Insights from './Insights';

export default function MpgsComplete({ refId, amount, auth, paid, initiate, authResult }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const rec = authResult?.recommendation;
  const auto = !paid && (auth !== '3ds' || rec === 'PROCEED');

  async function pay(withoutAuth = false) {
    setBusy(true);
    const r = await fetch(`/api/mpgs/${encodeURIComponent(refId)}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ withoutAuth }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setRes(r.ok ? j : { error: j.error });
  }
  useEffect(() => { if (auto) pay(); else if (paid) router.replace(`/orders/${encodeURIComponent(refId)}`); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const outcome = res?.insights?.find((i) => i.key === 'outcome');
  return (
    <div>
      <h1>{res ? (outcome?.value || (res.error ? 'Payment not sent' : 'Done')) : auto ? 'Sending payment to MPGS…' : '3-D Secure did not clear'}</h1>
      <p className="sub mono">{refId} · {amount}</p>
      {!auto && !res && (
        <div className="card">
          <p style={{ marginTop: 0 }}>{rec ? <>Authentication returned <b>{rec}</b>{authResult?.result ? ` (result ${authResult.result})` : ''}.</> : <>Initiate authentication returned <b>{initiate?.recommendation || 'no recommendation'}</b>{initiate?.gatewayCode ? ` (${initiate.gatewayCode})` : ''}.</>} A live shop would stop here.</p>
          <div className="row">
            <button className="danger" disabled={busy} onClick={() => pay(true)}>{busy ? 'Sending…' : 'Pay without 3DS (test)'}</button>
            <Link className="btn ghost" href={`/orders/${encodeURIComponent(refId)}`}>Open the order instead</Link>
          </div>
        </div>
      )}
      {res?.error && <div className="msg bad">{res.error}</div>}
      {res?.token && <div className="msg good">Card saved as MPGS token <span className="mono">{res.token}</span>. See <Link href="/cards">Saved cards</Link>.</div>}
      {res?.insights && <div className="card"><h2>Key insights</h2><Insights items={res.insights} /></div>}
      {(res || paid) && <div className="row"><Link className="btn" href={`/orders/${encodeURIComponent(refId)}`}>Manage order and see API calls</Link><Link className="btn ghost" href="/">New payment</Link></div>}
    </div>
  );
}
