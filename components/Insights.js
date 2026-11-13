// Key insights, printed as a transaction slip: one ruled line per finding with a status mark.
const MARK = { good: '✓', bad: '✕', warn: '!', info: '–' };

export default function Insights({ items, empty = 'No insights for this response.' }) {
  if (!items || !items.length) return <p className="muted">{empty}</p>;
  return (
    <div className="slip" role="list">
      {items.map((i, n) => (
        <div key={i.key + n} className={`slip-line ${i.tone}`} role="listitem">
          <span className="mk" aria-hidden="true">{MARK[i.tone] || '–'}</span>
          <span className="k">{i.label}</span>
          <span className="v">{i.value}</span>
          {i.note && <span className="n">{i.note}</span>}
        </div>
      ))}
    </div>
  );
}
