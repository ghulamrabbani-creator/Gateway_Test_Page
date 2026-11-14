'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Insights from './Insights';

export default function CybsComplete({ refId, amount, needsValidate, initial }) {
  const [res, setRes] = useState(initial ? { insights: initial } : null);
  const [busy, setBusy] = useState(needsValidate);
  useEffect(() => {
    if (!needsValidate) return;
    fetch(`/api/cybs/${encodeURIComponent(refId)}/step`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: 'validate' }) })
      .then(async (r) => { const j = await r.json().catch(() => ({})); setRes(r.ok ? j : { error: j.error }); setBusy(false); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const outcome = res?.insights?.find((i) => i.key === 'outcome');
  return (
    <div>
      <h1>{busy ? 'Validating 3-D Secure and authorizing…' : outcome?.value || (res?.error ? 'Payment not completed' : 'Done')}</h1>
      <p className="sub mono">{refId} · {amount}</p>
      {res?.error && <div className="msg bad">{res.error}</div>}
      {res?.insights && <div className="card"><h2>Key insights</h2><Insights items={res.insights} /></div>}
      {!busy && <div className="row"><Link className="btn" href={`/orders/${encodeURIComponent(refId)}`}>Manage order and see API calls</Link><Link className="btn ghost" href="/">New payment</Link></div>}
    </div>
  );
}
