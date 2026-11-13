import { currentUser } from '@/lib/auth';
import { getConfig, publicConfig } from '@/lib/config';
import { redirect } from 'next/navigation';
import ShopClient from '@/components/ShopClient';

export default async function Shop() {
  const user = currentUser();
  if (!user) redirect('/login');
  const pub = publicConfig(await getConfig());
  return <ShopClient pub={pub} role={user.role} />;
}
