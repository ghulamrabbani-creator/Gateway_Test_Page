'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Insights from './Insights';
import { useSettings } from '@/lib/clientState';
import { useLiveLog } from '@/lib/liveLog';
import LiveLog, { PauseBar } from './LiveLog';

export default function CybsComplete({ refId, amount, needsValidate, initial }) {
  const [res, setRes] = useState(initial ? { insights: initial } : null);
  const [busy, setBusy] = useState(needsValidate);
  const [s, , ready] = useSettings();
  const live = useLiveLog(!!s.stepMode);
  // R21: show the calls so far; after a challenge, pause before validation + authorization in step mode
  useEffect(() => {
    if (!ready) return;
    (async () => {
      await live.track(refId);
      if (!needsValidate) return;
      await live.gate('3DS validation + authorization (VALIDATE_CONSUMER_AUTHENTICATION)');
      const { r, j } = await live.during('3DS validation + authorization', async () => {
        const r = await fetch(`/api/cybs/${encodeURIComponent(refId)}/step`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: 'validate' }) });
        return { r, j: await r.json().catch(() => ({})) };
      });
      setRes(r.ok ? j : { error: j.error }); setBusy(false);
    })();
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const outcome = res?.insights?.find((i) => i.key === 'outcome');
  return (
    <div>
      <h1>{busy ? (live.pause ? 'Paused before 3DS validation' : 'Validating 3-D Secure and authorizing…') : outcome?.value || (res?.error ? 'Payment not completed' : 'Done')}</h1>
      <p className="sub mono">{refId} · {amount}</p>
      {res?.error && <div className="msg bad">{res.error}</div>}
      {res?.insights && <div className="card"><h2>Key insights</h2><Insights items={res.insights} /></div>}
      <PauseBar live={live} compact />
      {!busy && <div className="row"><Link className="btn" href={`/orders/${encodeURIComponent(refId)}`}>Manage order and see API calls</Link><Link className="btn ghost" href="/">New payment</Link></div>}
      <LiveLog live={live} stepMode={!!s.stepMode} />
    </div>
  );
}
