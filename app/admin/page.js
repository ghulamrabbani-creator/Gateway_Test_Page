import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { currentUser } from '@/lib/auth';
import { getConfig, credsSummary } from '@/lib/config';
import AdminForm from '@/components/AdminForm';
import { db } from '@/lib/db';

export default async function Admin() {
  const user = currentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') return <div className="card"><h1>Admin only</h1><p className="sub">Sign in as admin to manage credentials.</p></div>;
  const cfg = await getConfig();
  const creds = await credsSummary();
  const { data: users } = await db().from('users').select('username,role,disabled,created_by,created_at,last_login_at').order('created_at');
  const { data: cardRows } = await db().from('tokens').select('created_by');
  const cardCount = {};
  for (const t of cardRows || []) cardCount[t.created_by || '—'] = (cardCount[t.created_by || '—'] || 0) + 1;
  const h = headers();
  const base = cfg.publicBaseUrl || `${h.get('x-forwarded-proto') || 'https'}://${h.get('x-forwarded-host') || h.get('host')}`;
  const safe = { envs: cfg.envs, allowDemoOnProduction: cfg.allowDemoOnProduction, offerMoto: cfg.offerMoto, motoExtra: JSON.stringify(cfg.motoExtra || {}), currencies: cfg.currencies.join(', '), merchantName: cfg.merchantName, publicBaseUrl: cfg.publicBaseUrl, prodMaxAmount: cfg.prodMaxAmount ?? 5, prodDailyPayments: cfg.prodDailyPayments ?? 20, adminPasswordSet: !!cfg.users?.admin };
  return <AdminForm users={users || []} cardCount={cardCount} me={user.user} cfg={safe} creds={creds} callbackUrl={`${base}/api/callback`} returnUrl={`${base}/return`} />;
}
