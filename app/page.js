import { currentUser } from '@/lib/auth';
import { getConfig, publicConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { redirect } from 'next/navigation';
import TransactionClient from '@/components/TransactionClient';

export default async function Transaction() {
  const user = currentUser();
  if (!user) redirect('/login');
  const pub = publicConfig(await getConfig());
  const { data } = await db().from('tokens').select('id, env, route, status, usage, token_id, agreement_id, agreement_type, card, scheme').eq('status', 'ACTIVE').order('created_at', { ascending: false }).limit(100);
  return <TransactionClient pub={pub} role={user.role} tokens={data || []} />;
}
