import './globals.css';
import Link from 'next/link';
import { currentUser } from '@/lib/auth';
import { RELEASE, COMMIT } from '@/lib/release';

export const metadata = { title: 'Gateway test bench' };
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }) {
  const user = currentUser();
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
      </head>
      <body>
        {user && (
          <header className="top">
            <div className="bar">
              <Link href="/" className="logo">Gateway test bench</Link>
              <Link href="/">New transaction</Link>
              <Link href="/cards">Saved cards</Link>
              <Link href="/orders">Orders</Link>
              <Link href="/lookup">Order lookup</Link>
              <Link href="/callbacks">Callbacks</Link>
              {user.role === 'admin' && <Link href="/admin">Admin</Link>}
              <span className="spacer" />
              <span className="release" title={`Release ${RELEASE}, commit ${COMMIT}`}>{RELEASE} {COMMIT}</span>
              <span className="who">Signed in as {user.user}</span>
              <form action="/api/auth/logout" method="post"><button>Sign out</button></form>
            </div>
          </header>
        )}
        <main>{children}</main>
        {!user && <div className="release-foot">Release {RELEASE} ({COMMIT})</div>}
      </body>
    </html>
  );
}
