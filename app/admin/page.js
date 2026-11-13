import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { currentUser } from '@/lib/auth';
import { getConfig, credsSummary } from '@/lib/config';
import AdminForm from '@/components/AdminForm';

export default async function Admin() {
  const user = currentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') return <div className="card"><h1>Admin only</h1><p className="sub">Sign in as admin to manage credentials.</p></div>;
  const cfg = await getConfig();
  const creds = await credsSummary();
  const h = headers();
  const base = cfg.publicBaseUrl || `${h.get('x-forwarded-proto') || 'https'}://${h.get('x-forwarded-host') || h.get('host')}`;
  const safe = { envs: cfg.envs, allowDemoOnProduction: cfg.allowDemoOnProduction, offerMoto: cfg.offerMoto, motoExtra: JSON.stringify(cfg.motoExtra || {}), currencies: cfg.currencies.join(', '), merchantName: cfg.merchantName, publicBaseUrl: cfg.publicBaseUrl, adminPasswordSet: !!cfg.users?.admin };
  return <AdminForm cfg={safe} creds={creds} callbackUrl={`${base}/api/callback`} returnUrl={`${base}/return`} />;
}
