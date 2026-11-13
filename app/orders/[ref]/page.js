import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { getOrderRow, logsFor } from '@/lib/orders';
import { orderInsights } from '@/lib/insights';
import Insights from '@/components/Insights';
import Inspector from '@/components/Inspector';
import OrderActions from '@/components/OrderActions';

export default async function OrderPage({ params }) {
  const user = currentUser();
  if (!user) redirect('/login');
  const row = await getOrderRow(decodeURIComponent(params.ref));
  if (!row) return <div className="card"><h1>Order not found</h1></div>;
  const logs = await logsFor(row.ref);
  const o = row.last_order;
  const authorized = Number(o?.totalAuthorizedAmount ?? 0);
  const captured = Number(row.captured || 0);
  const refunded = Number(row.refunded || 0);
  return (
    <div>
      <p><Link href="/orders">← Orders</Link></p>
      <h1 className="mono">{row.ref}</h1>
      <p className="sub">{row.currency} {Number(row.amount).toFixed(2)} · {row.operation === 'Pay' ? 'Sale' : 'Pre-authorization'} · {row.env} · created {new Date(row.created_at).toLocaleString()} by {row.created_by}</p>
      {row.options?.external && <div className="msg warn">Imported with Order lookup: this order was not created by this shop{row.options.importedFrom ? ` (its callback goes to ${row.options.importedFrom})` : ''}. Actions here still act on the real order.</div>}
      <div className="grid g2">
        <div className="card">
          <h2>Summary</h2>
          <div className="kv">
            <div>Status</div><div>{row.detailed_status || row.status}</div>
            <div>Geidea order ID</div><div className="mono">{row.geidea_order_id || '—'}</div>
            <div>Session ID</div><div className="mono">{row.session_id || '—'}</div>
            <div>Authorized</div><div>{row.currency} {authorized.toFixed(2)}</div>
            <div>Captured</div><div>{row.currency} {captured.toFixed(2)}</div>
            <div>Refunded</div><div>{row.currency} {refunded.toFixed(2)}</div>
            {row.token_id && (<><div>Token</div><div className="mono">{row.token_id}</div></>)}
            {row.agreement_id && (<><div>Agreement</div><div className="mono">{row.agreement_id} ({row.agreement_type})</div></>)}
          </div>
        </div>
        <div className="card">
          <h2>Actions</h2>
          <OrderActions refId={row.ref} currency={row.currency} detailed={row.detailed_status} authorized={authorized} captured={captured} refunded={refunded} amount={Number(row.amount)} />
        </div>
      </div>
      <div className="card">
        <h2>Key insights</h2>
        <Insights items={orderInsights(o)} empty="Fetch the order from Geidea to see insights." />
      </div>
      <div className="card">
        <h2>Request inspector</h2>
        <p className="sub" style={{ marginBottom: 10 }}>Every call this shop made to Geidea for this order, newest first. Credentials are masked.</p>
        <Inspector logs={logs} openFirst />
      </div>
    </div>
  );
}
