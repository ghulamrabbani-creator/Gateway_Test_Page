import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { getOrderRow, refreshFromGeidea } from '@/lib/orders';
import { orderInsights } from '@/lib/insights';
import Insights from '@/components/Insights';

export default async function Return({ searchParams }) {
  const user = currentUser();
  if (!user) redirect('/login');
  const ref = searchParams.ref;
  const row = ref && (await getOrderRow(ref));
  if (!row) return <div className="card"><h1>Order not found</h1><p className="sub">No order with reference {ref}.</p></div>;
  let order = null, fetchErr = null;
  try {
    ({ order } = await refreshFromGeidea(row, user));
  } catch (e) {
    fetchErr = e.message;
  }
  const ins = orderInsights(order);
  const outcome = ins.find((i) => i.key === 'outcome');
  const sdk = searchParams.sdk;
  return (
    <div>
      <h1>{outcome ? outcome.value : 'Payment status unknown'}</h1>
      <p className="sub">Order {row.ref} · {row.currency} {Number(row.amount).toFixed(2)} {sdk && <>· checkout reported <b>{sdk}</b></>}</p>
      {!order && <div className="msg warn">Geidea did not return an order for this reference yet{fetchErr ? ` (${fetchErr})` : ''}. The customer may have closed the page before paying. The callback will update it if a payment happens.</div>}
      <div className="card">
        <h2>Key insights</h2>
        <Insights items={ins} empty="Nothing to show until Geidea returns the order." />
      </div>
      <div className="row"><Link className="btn" href={`/orders/${row.ref}`}>Manage order and see API calls</Link><Link className="btn ghost" href="/">Back to shop</Link></div>
    </div>
  );
}
