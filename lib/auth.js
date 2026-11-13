// Two roles, same idea as BESO: demo (runs transactions) and admin (also manages credentials).
import { cookies } from 'next/headers';
import { sign, safeEqual, checkPassword } from './crypto';
import { getConfig } from './config';

const COOKIE = 'ts_session';
const TTL = 12 * 3600;

export async function login(username, password) {
  const cfg = await getConfig();
  const u = String(username || '').trim().toLowerCase();
  if (u !== 'demo' && u !== 'admin') return null;
  const stored = cfg.users?.[u];
  let ok = false;
  if (stored) ok = checkPassword(password, stored);
  else if (u === 'demo') ok = password === 'demo';
  else ok = !!process.env.ADMIN_INITIAL_PASSWORD && password === process.env.ADMIN_INITIAL_PASSWORD;
  if (!ok) return null;
  const payload = Buffer.from(JSON.stringify({ u, r: u, exp: Date.now() + TTL * 1000 })).toString('base64url');
  cookies().set(COOKIE, `${payload}.${sign(payload)}`, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: TTL });
  return { user: u, role: u };
}

export function logout() {
  cookies().delete(COOKIE);
}

export function currentUser() {
  const v = cookies().get(COOKIE)?.value;
  if (!v) return null;
  const [payload, sig] = v.split('.');
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return s.exp > Date.now() ? { user: s.u, role: s.r } : null;
  } catch {
    return null;
  }
}

export function requireUser(role) {
  const u = currentUser();
  if (!u) throw new HttpError(401, 'Sign in first');
  if (role === 'admin' && u.role !== 'admin') throw new HttpError(403, 'Admin only');
  return u;
}

export async function assertEnvAllowed(user, env) {
  if (!['test', 'staging', 'production'].includes(env)) throw new HttpError(400, 'Unknown environment');
  if (env === 'production' && user.role !== 'admin') {
    const cfg = await getConfig();
    if (!cfg.allowDemoOnProduction) throw new HttpError(403, 'Production is admin-only. An admin can allow demo users in Admin → General.');
  }
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function errorResponse(e) {
  const status = e instanceof HttpError ? e.status : 500;
  if (status === 500) console.error(e);
  return Response.json({ error: e.message || 'Unexpected error' }, { status });
}
