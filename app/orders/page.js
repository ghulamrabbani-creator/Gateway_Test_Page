import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';

// Card brand from whichever gateway object the order holds (Geidea order, MPGS order/transaction, CYBS payment)
function brandOf(o) {
  const lo = o.last_order || {};
  const raw = lo.paymentMethod?.brand || lo.sourceOfFunds?.provided?.card?.brand
    || (Array.isArray(lo.transaction) ? [...lo.transaction].reverse().find((t) => t.sourceOfFunds)?.sourceOfFunds?.provided?.card?.brand : null)
    || { '001': 'visa', '002': 'mastercard', '003': 'amex' }[lo.paymentInformation?.card?.type || lo.paymentInformation?.tokenizedCard?.type] || '';
  const b = String(raw).toLowerCase();
  return b.includes('visa') ? 'visa' : b.includes('master') ? 'mastercard' : b.includes('amex') || b.includes('american') ? 'amex' : b.includes('mada') ? 'mada' : b || null;
}
const BRAND = { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', mada: 'mada' };
const ROUTE = { geidea: 'Geidea GW', mpgs: 'MPGS', cybs: 'CYBS' };
// The gateway's own ID for the order, where it differs from our reference
const gatewayId = (o) => (o.route === 'geidea' ? o.geidea_order_id : o.route === 'cybs' ? o.options?.cybs?.paymentId : null);

const tone = (s) => (s === 'Success' ? 'good' : s === 'Failed' || s === 'SessionFailed' ? 'bad' : 'warn');

export default async function Orders({ searchParams }) {
  const user = currentUser();
  if (!user) redirect('/login');
  const page = Math.max(1, Number(searchParams.page || 1));
  const size = 30;
  const { data, count } = await db().from('orders').select('ref,env,route,operation,amount,currency,status,detailed_status,options,customer,created_by,created_at,geidea_order_id,last_order', { count: 'exact' }).order('created_at', { ascending: false }).range((page - 1) * size, page * size - 1);
  return (
    <div>
      <h1>Orders</h1>
      <p className="sub">{count || 0} orders. Open one to capture, void, refund or inspect its API calls. Merchant reference is the shop's own ID, sent as merchantReferenceId (Geidea), order ID (MPGS, so the same there) or clientReferenceInformation.code (CYBS); the gateway's ID is shown under it where it differs.</p>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Merchant reference</th><th>Route</th><th>Card</th><th>Customer</th><th>Amount</th><th>Type</th><th>Env</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>
            {(data || []).map((o) => (
              <tr key={o.ref}>
                <td className="mono"><Link href={`/orders/${o.ref}`}>{o.ref}</Link>{gatewayId(o) && <div className="muted" style={{ fontSize: 11 }} title={o.route === 'cybs' ? 'CYBS payment ID' : 'Geidea order ID'}>{gatewayId(o)}</div>}</td>
                <td><span className={`pill route-${o.route}`}>{ROUTE[o.route] || o.route}</span></td>
                <td>{brandOf(o) ? <span className={`brand brand-${brandOf(o)}`}>{BRAND[brandOf(o)] || brandOf(o)}</span> : <span className="muted">—</span>}</td>
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
