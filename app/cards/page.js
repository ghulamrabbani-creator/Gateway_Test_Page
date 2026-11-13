import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { getConfig, publicConfig } from '@/lib/config';
import CardsClient from '@/components/CardsClient';

export default async function Cards() {
  const user = currentUser();
  if (!user) redirect('/login');
  const { data } = await db().from('tokens').select('*').order('created_at', { ascending: false }).limit(100);
  const pub = publicConfig(await getConfig());
  return <CardsClient tokens={data || []} pub={pub} role={user.role} />;
}
