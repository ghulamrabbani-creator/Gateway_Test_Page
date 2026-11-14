import { redirect } from 'next/navigation';

// R19: Shop and Checkout merged into the Transaction page at /.
export default function Checkout() {
  redirect('/');
}
