import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { orderInsights } from '@/lib/insights';
import { extractOrder } from '@/lib/geidea';
import Insights from '@/components/Insights';

export default async function Callbacks({ searchParams }) {
  const user = currentUser();
  if (!user) redirect('/login');
  const page = Math.max(1, Number(searchParams.page || 1));
  const size = 25;
  const { data, count } = await db().from('callbacks').select('*', { count: 'exact' }).order('received_at', { ascending: false }).range((page - 1) * size, page * size - 1);
  return (
    <div>
      <h1>Callbacks</h1>
      <p className="sub">{count || 0} distinct server-to-server callbacks from Geidea. Repeats of the same payload are counted, not stored again.</p>
      {(data || []).map((c) => (
        <details className="call" key={c.id}>
          <summary>
            <span className={`pill ${/^Success/.test(c.status) ? 'good' : /^Failed/.test(c.status) ? 'bad' : 'warn'}`}>{c.status}</span>
            {c.order_ref ? <Link className="mono" href={`/orders/${c.order_ref}`}>{c.order_ref}</Link> : <span className="mono muted">no reference</span>}
            <span>{c.currency} {c.amount !== null ? Number(c.amount).toFixed(2) : ''}</span>
            <span style={{ flex: 1 }} />
            {c.duplicate_count > 0 && <span className="pill warn">received {c.duplicate_count + 1}×</span>}
            <span className="muted mono">{new Date(c.received_at).toLocaleString()}</span>
          </summary>
          <div className="body">
            <Insights items={orderInsights(extractOrder(c.payload))} empty="Payload has no order object." />
            <pre className="json">{JSON.stringify(c.payload, null, 2)}</pre>
          </div>
        </details>
      ))}
      <div className="row">{page > 1 && <Link href={`/callbacks?page=${page - 1}`}>« Newer</Link>}{count > page * size && <Link href={`/callbacks?page=${page + 1}`}>Older »</Link>}</div>
    </div>
  );
}
