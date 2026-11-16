import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { getOrderRow } from '@/lib/orders';
import MpgsComplete from '@/components/MpgsComplete';

// Where the MPGS checkout lands after the card form / 3DS. Sends the payment unless 3DS said not to.
export default async function Complete({ searchParams }) {
  const user = currentUser();
  if (!user) redirect('/login');
  const row = searchParams.ref && (await getOrderRow(searchParams.ref));
  if (!row || row.route !== 'mpgs') return <div className="card"><h1>Order not found</h1></div>;
  const m = row.options?.mpgs || {};
  return <MpgsComplete refId={row.ref} amount={`${row.currency} ${Number(row.amount).toFixed(2)}`} auth={row.options?.auth} paid={!!m.payTxnId} initiate={m.initiate || null} authResult={m.authResult || null} operation={row.operation} />;
}
