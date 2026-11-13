// Key insights cards: plain-language reading of a Geidea response.
export default function Insights({ items, empty = 'No insights for this response.' }) {
  if (!items || !items.length) return <p className="muted">{empty}</p>;
  return (
    <div className="insights">
      {items.map((i, n) => (
        <div key={i.key + n} className={`ins ${i.tone}`}>
          <div className="l">{i.label}</div>
          <div className="v">{i.value}</div>
          {i.note && <div className="n">{i.note}</div>}
        </div>
      ))}
    </div>
  );
}
