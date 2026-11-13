import { logout } from '@/lib/auth';

export async function POST(req) {
  logout();
  return Response.redirect(new URL('/login', req.url), 303);
}
