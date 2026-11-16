// Two roles, same idea as BESO: demo (runs transactions) and admin (also manages credentials).
// R21: besides the built-in demo and admin logins, admins create named users (users table) with role tester or admin.
// A tester gets the demo role; saved cards belong to the username that saved them (tokens.created_by).
import { cookies } from 'next/headers';
import { sign, safeEqual, checkPassword } from './crypto';
import { getConfig } from './config';

const COOKIE = 'ts_session';
const TTL = 12 * 3600;

// Lockout: 5 wrong passwords lock that username for 15 minutes (login_attempts table).
const MAX_FAILS = 5;
const LOCK_MIN = 15;

export async function login(username, password, ip) {
  const cfg = await getConfig();
  const u = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(u) && u !== 'demo' && u !== 'admin') return null;
  const builtIn = u === 'demo' || u === 'admin';
  const { db } = await import('./db');
  let named = null;
  if (!builtIn) {
    const { data } = await db().from('users').select('*').eq('username', u).maybeSingle();
    if (!data) return null;
    named = data;
  }
  const { data: att } = await db().from('login_attempts').select('*').eq('username', u).maybeSingle();
  if (att?.locked_until && new Date(att.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(att.locked_until) - new Date()) / 60000);
    throw new HttpError(429, `Too many wrong passwords. Try again in ${mins} minute${mins > 1 ? 's' : ''}.`);
  }
  const stored = cfg.users?.[u];
  let ok = false;
  if (named) ok = checkPassword(password, named.password_hash);
  else if (stored) ok = checkPassword(password, stored);
  else if (u === 'demo') ok = password === 'demo';
  else ok = !!process.env.ADMIN_INITIAL_PASSWORD && password === process.env.ADMIN_INITIAL_PASSWORD;
  if (!ok) {
    const fails = (att?.locked_until && new Date(att.locked_until) <= new Date() ? 0 : att?.fails || 0) + 1;
    const locked = fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60000).toISOString() : null;
    await db().from('login_attempts').upsert({ username: u, fails: locked ? 0 : fails, locked_until: locked, last_ip: ip || null, updated_at: new Date().toISOString() });
    if (locked) throw new HttpError(429, `Too many wrong passwords. ${u} is locked for ${LOCK_MIN} minutes.`);
    return null;
  }
  if (named?.disabled) throw new HttpError(403, `${u} is disabled. Ask an admin to enable it.`);
  if (att) await db().from('login_attempts').upsert({ username: u, fails: 0, locked_until: null, last_ip: ip || null, updated_at: new Date().toISOString() });
  const role = named ? (named.role === 'admin' ? 'admin' : 'demo') : u;
  if (named) await db().from('users').update({ last_login_at: new Date().toISOString() }).eq('username', u);
  const payload = Buffer.from(JSON.stringify({ u, r: role, exp: Date.now() + TTL * 1000 })).toString('base64url');
  cookies().set(COOKIE, `${payload}.${sign(payload)}`, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: TTL });
  return { user: u, role };
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
  const status = e instanceof HttpError ? e.status : Number.isInteger(e?.status) ? e.status : 500;
  if (status === 500) console.error(e);
  return Response.json({ error: e.message || 'Unexpected error' }, { status });
}

// R21: saved cards belong to the user who saved them. Admins may act on anyone's card; others only on their own.
export function assertOwnsCard(user, t) {
  if (!t || user.role === 'admin' || !t.created_by || t.created_by === user.user) return;
  throw new HttpError(403, `This saved card belongs to ${t.created_by}. Use one of your own cards.`);
}

// A token value sent in a request (picked or pasted). If it is a saved card of another user, a non-admin can't use it.
export async function assertTokenUse(user, value) {
  if (!value || user.role === 'admin') return;
  const { db } = await import('./db');
  const { data } = await db().from('tokens').select('created_by').eq('token_id', String(value).trim());
  if (!data?.length || data.some((t) => !t.created_by || t.created_by === user.user)) return;
  throw new HttpError(403, `Token ${String(value).slice(0, 8)}… is a saved card of ${data[0].created_by}. Use one of your own cards.`);
}
