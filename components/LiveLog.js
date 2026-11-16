'use client';
// R21: live log of one order's API calls, oldest first, newest open. Requests show as soon as they are sent
// ("waiting for response"); responses fill in when they arrive. In step mode the flow pauses after each step.
import Insights from './Insights';
import CopyButton from './CopyButton';
import { responseInsights } from '@/lib/insights';
import { fmtT } from '@/lib/time';

const waiting = (l) => l.status == null && !l.error && l.method !== 'BROWSER';
const tone = (l) => (waiting(l) ? 'warn' : l.error || !l.status ? 'bad' : l.status >= 200 && l.status < 300 ? 'good' : 'bad');

export function PauseBar({ live, compact = false }) {
  if (!live?.pause) return null;
  return (
    <div className={`pausebar ${compact ? 'compact' : ''}`} role="status">
      <div className="pb-text"><span className="pb-dot" aria-hidden="true" />Paused. Review the last call{compact ? ' in the live log' : ''}. <b>Next: {live.pause.next}</b></div>
      <div className="row nowrap">
        <button onClick={live.cont} autoFocus={!compact}>Continue</button>
        <button className="ghost" onClick={live.runAll}>Run the rest</button>
      </div>
    </div>
  );
}

export default function LiveLog({ live, stepMode, title = 'Live log' }) {
  if (!live?.refId && !live?.pending) return null;
  const logs = live.logs || [];
  const lastIdx = logs.length - 1;
  return (
    <section className="livelog" aria-label="Live log" aria-live="polite">
      <div className="ll-head">
        <h2>{title}</h2>
        {live.refId && <span className="mono muted">{live.refId}</span>}
        <span className="spacer" style={{ flex: 1 }} />
        <span className={`pill ${stepMode ? 'warn' : ''}`}>{stepMode ? 'Step by step' : 'Runs straight through'}</span>
      </div>
      {!logs.length && !live.pending && <p className="muted" style={{ margin: 0 }}>No calls yet.</p>}
      <ol className="ll-list">
        {logs.map((l, i) => {
          const w = waiting(l);
          const ins = w ? [] : responseInsights(l);
          const verdict = ins.find((x) => x.key === 'outcome' || x.key === 'code' || x.key === 'http' || x.key === 'net');
          const reqText = JSON.stringify({ method: l.method, url: l.url, headers: l.req_headers, body: l.req_body }, null, 2);
          const resText = l.error ? String(l.error) : JSON.stringify(l.res_body, null, 2);
          return (
            <li key={l.id}>
              <details className={`call ll-call ${w ? 'waiting' : ''}`} open={i === lastIdx}>
                <summary>
                  <span className="ll-n mono">{i + 1}</span>
                  <span className={`pill ${tone(l)}`}>{w ? '…' : l.error ? 'ERR' : l.status}</span>
                  <strong>{l.action}</strong>
                  <span className="mono muted ll-url">{l.method} {l.url?.replace(/^https?:\/\/[^/]+/, '')}</span>
                  <span className="spacer" style={{ flex: 1 }} />
                  {verdict && verdict.value != null && String(verdict.value) !== String(l.status) && <span className={`pill ${verdict.tone}`}>{String(verdict.value).slice(0, 60)}</span>}
                  <span className="muted mono" style={{ fontSize: 12 }} title="UAE time">{fmtT(l.created_at)}</span>
                  <span className="muted mono" style={{ fontSize: 12 }}>{w ? 'waiting' : `${l.duration_ms ?? 0} ms`}</span>
                </summary>
                <div className="body">
                  {!w && ins.length > 0 && <Insights items={ins} />}
                  <div className="grid g2" style={{ marginTop: 10 }}>
                    <div>
                      <div className="row" style={{ justifyContent: 'space-between' }}><h3>Request {l.method === 'BROWSER' ? '(browser)' : 'sent'}</h3><CopyButton text={reqText} /></div>
                      <div className="mono muted" style={{ fontSize: 12, wordBreak: 'break-all' }}>{l.method} {l.url}</div>
                      <pre className="json">{l.method === 'BROWSER' ? 'Nothing sent: this is what came back through the browser.' : JSON.stringify({ headers: l.req_headers, body: l.req_body }, null, 2)}</pre>
                    </div>
                    <div>
                      <div className="row" style={{ justifyContent: 'space-between' }}><h3>Response {w ? '' : 'received'}</h3>{!w && <CopyButton text={resText} />}</div>
                      {w ? <p className="ll-wait"><span className="pb-dot" aria-hidden="true" />Waiting for the gateway to answer…</p> : <pre className="json">{resText}</pre>}
                    </div>
                  </div>
                </div>
              </details>
            </li>
          );
        })}
        {live.pending && !logs.some(waiting) && <li className="ll-pending"><span className="pb-dot" aria-hidden="true" />Sending {live.pending}…</li>}
      </ol>
      <PauseBar live={live} />
    </section>
  );
}
