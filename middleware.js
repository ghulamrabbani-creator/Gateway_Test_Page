import { NextResponse } from 'next/server';

// Cheap gate: pages need the session cookie. Signature is verified on the server in each page/route.
const OPEN = ['/login', '/api/auth/login', '/api/callback', '/api/mpgs/3ds-return', '/api/cybs/3ds-return', '/_next', '/favicon'];

export function middleware(req) {
  const { pathname } = req.nextUrl;
  if (OPEN.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (!req.cookies.get('ts_session')) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
