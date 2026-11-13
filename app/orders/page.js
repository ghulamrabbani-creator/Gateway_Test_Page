import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';

const tone = (s) => (s === 'Success' ? 'good' : s === 'Failed' || s === 'SessionFailed' ? 'bad' : 'warn');

export default async function Orders({ searchParams }) {
  const user = currentUser();
  if (!user) redirect('/login');
  const page = Math.max(1, Number(searchParams.page || 1));
  const size = 30;
  const { data, count } = await db().from('orders').select('ref,env,route,operation,amount,currency,status,detailed_status,options,customer,created_by,created_at', { count: 'exact' }).order('created_at', { ascending: false }).range((page - 1) * size, page * size - 1);
  return (
    <div>
      <h1>Orders</h1>
      <p className="sub">{count || 0} orders. Open one to capture, void, refund or inspect its API calls.</p>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Reference</th><th>Customer</th><th>Amount</th><th>Type</th><th>Env</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>
            {(data || []).map((o) => (
              <tr key={o.ref}>
                <td className="mono"><Link href={`/orders/${o.ref}`}>{o.ref}</Link>{o.route === 'mpgs' && <> <span className="pill">MPGS</span></>}</td>
                <td>{[o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(' ') || '—'}</td>
                <td>{o.currency} {Number(o.amount).toFixed(2)}</td>
                <td>{o.operation === 'Pay' ? 'Sale' : 'Pre-auth'}{o.options?.mit ? ' · MIT' : o.options?.tokenId ? ' · CIT token' : ''}{o.options?.saveCard && o.options.saveCard !== 'none' ? ` · save ${o.options.saveCard.toUpperCase()}` : ''}{o.options?.auth === 'moto' ? ' · MOTO' : ''}</td>
                <td><span className={`pill ${o.env === 'production' ? 'warn' : ''}`}>{o.env}</span></td>
                <td><span className={`pill ${tone(o.status)}`}>{o.detailed_status || o.status}</span></td>
                <td className="muted">{new Date(o.created_at).toLocaleString()} · {o.created_by}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">{page > 1 && <Link href={`/orders?page=${page - 1}`}>« Newer</Link>}{count > page * size && <Link href={`/orders?page=${page + 1}`}>Older »</Link>}</div>
    </div>
  );
}
