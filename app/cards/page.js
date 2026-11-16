import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { getConfig, publicConfig } from '@/lib/config';
import CardsClient from '@/components/CardsClient';

export default async function Cards({ searchParams }) {
  const user = currentUser();
  if (!user) redirect('/login');
  // R21: each user sees the cards their own transactions saved. Admins can switch to everyone's (?all=1).
  const all = user.role === 'admin' && searchParams?.all === '1';
  let q = db().from('tokens').select('*').order('created_at', { ascending: false }).limit(all ? 200 : 100);
  if (!all) q = q.eq('created_by', user.user);
  const { data } = await q;
  const pub = publicConfig(await getConfig());
  return <CardsClient tokens={data || []} pub={pub} role={user.role} me={user.user} all={all} />;
}
