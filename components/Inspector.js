// Request inspector: every outbound call with masked request, raw response and key insights.
import Insights from './Insights';
import CopyButton from './CopyButton';
import { responseInsights } from '@/lib/insights';

const tone = (s, e) => (e || !s ? 'bad' : s >= 200 && s < 300 ? 'good' : 'bad');

export default function Inspector({ logs, openFirst = false }) {
  if (!logs?.length) return <p className="muted">No API calls yet.</p>;
  return logs.map((l, i) => {
    const ins = responseInsights(l);
    const reqText = JSON.stringify({ method: l.method, url: l.url, headers: l.req_headers, body: l.req_body }, null, 2);
    const resText = l.error ? String(l.error) : JSON.stringify(l.res_body, null, 2);
    const allText = `${l.action} · ${l.status ?? 'ERR'} · ${l.duration_ms} ms · ${l.created_at}\n\nRequest:\n${reqText}\n\nResponse:\n${resText}`;
    const verdict = ins.find((x) => x.key === 'outcome' || x.key === 'code' || x.key === 'http' || x.key === 'net');
    return (
      <details className="call" key={l.id} open={openFirst && i === 0}>
        <summary>
          <span className={`pill ${tone(l.status, l.error)}`}>{l.error ? 'ERR' : l.status}</span>
          <strong>{l.action}</strong>
          <span className="mono muted">{l.method} {l.url?.replace(/^https?:\/\/[^/]+/, '')}</span>
          <span className="spacer" style={{ flex: 1 }} />
          {verdict && <span className={`pill ${verdict.tone}`}>{String(verdict.value).slice(0, 60)}</span>}
          <CopyButton text={allText} label="Copy all" />
          <span className="muted mono">{l.duration_ms} ms · {new Date(l.created_at).toLocaleString()} · {l.created_by}</span>
        </summary>
        <div className="body">
          <h3>Key insights</h3>
          <Insights items={ins} />
          <div className="grid g2" style={{ marginTop: 12 }}>
            <div>
              <div className="row" style={{ justifyContent: 'space-between' }}><h3>Request</h3><CopyButton text={reqText} /></div>
              <div className="mono muted">{l.method} {l.url}</div>
              <pre className="json">{JSON.stringify({ headers: l.req_headers, body: l.req_body }, null, 2)}</pre>
            </div>
            <div>
              <div className="row" style={{ justifyContent: 'space-between' }}><h3>Response</h3><CopyButton text={resText} /></div>
              <pre className="json">{resText}</pre>
            </div>
          </div>
        </div>
      </details>
    );
  });
}
