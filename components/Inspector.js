// Request inspector: every outbound call with masked request, raw response and key insights.
import Insights from './Insights';
import { responseInsights } from '@/lib/insights';

const tone = (s, e) => (e || !s ? 'bad' : s >= 200 && s < 300 ? 'good' : 'bad');

export default function Inspector({ logs, openFirst = false }) {
  if (!logs?.length) return <p className="muted">No API calls yet.</p>;
  return logs.map((l, i) => {
    const ins = responseInsights(l);
    const verdict = ins.find((x) => x.key === 'outcome' || x.key === 'code' || x.key === 'http' || x.key === 'net');
    return (
      <details className="call" key={l.id} open={openFirst && i === 0}>
        <summary>
          <span className={`pill ${tone(l.status, l.error)}`}>{l.error ? 'ERR' : l.status}</span>
          <strong>{l.action}</strong>
          <span className="mono muted">{l.method} {l.url?.replace(/^https?:\/\/[^/]+/, '')}</span>
          <span className="spacer" style={{ flex: 1 }} />
          {verdict && <span className={`pill ${verdict.tone}`}>{String(verdict.value).slice(0, 60)}</span>}
          <span className="muted mono">{l.duration_ms} ms · {new Date(l.created_at).toLocaleString()} · {l.created_by}</span>
        </summary>
        <div className="body">
          <h3>Key insights</h3>
          <Insights items={ins} />
          <div className="grid g2" style={{ marginTop: 12 }}>
            <div>
              <h3>Request</h3>
              <div className="mono muted">{l.method} {l.url}</div>
              <pre className="json">{JSON.stringify({ headers: l.req_headers, body: l.req_body }, null, 2)}</pre>
            </div>
            <div>
              <h3>Response</h3>
              <pre className="json">{l.error ? l.error : JSON.stringify(l.res_body, null, 2)}</pre>
            </div>
          </div>
        </div>
      </details>
    );
  });
}
