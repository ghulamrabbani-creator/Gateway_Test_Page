import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { getOrderRow } from '@/lib/orders';
import { cybsInsights } from '@/lib/insights';
import CybsComplete from '@/components/CybsComplete';

// Where the CYBS checkout lands: after frictionless/no-3DS authorization, or after the challenge (then validates).
export default async function Complete({ searchParams }) {
  const user = currentUser();
  if (!user) redirect('/login');
  const row = searchParams.ref && (await getOrderRow(searchParams.ref));
  if (!row || row.route !== 'cybs') return <div className="card"><h1>Order not found</h1></div>;
  const cy = row.options?.cybs || {};
  const needsValidate = !!cy.challengeDone && !cy.paymentId;
  return <CybsComplete refId={row.ref} amount={`${row.currency} ${Number(row.amount).toFixed(2)}`} needsValidate={needsValidate} initial={needsValidate ? null : cybsInsights(row.last_order)} />;
}
