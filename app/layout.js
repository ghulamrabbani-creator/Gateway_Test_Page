import './globals.css';
import Link from 'next/link';
import { currentUser } from '@/lib/auth';

export const metadata = { title: 'Geidea UAE Test Shop' };
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }) {
  const user = currentUser();
  return (
    <html lang="en">
      <body>
        {user && (
          <header className="top">
            <div className="bar">
              <Link href="/" className="logo">UAE Test Shop</Link>
              <Link href="/">Shop</Link>
              <Link href="/checkout">Checkout</Link>
              <Link href="/cards">Saved cards</Link>
              <Link href="/orders">Orders</Link>
              <Link href="/callbacks">Callbacks</Link>
              {user.role === 'admin' && <Link href="/admin">Admin</Link>}
              <span className="spacer" />
              <span className="who">{user.user} · {user.role}</span>
              <form action="/api/auth/logout" method="post"><button className="ghost" style={{ padding: '4px 10px' }}>Sign out</button></form>
            </div>
          </header>
        )}
        <main>{children}</main>
      </body>
    </html>
  );
}
