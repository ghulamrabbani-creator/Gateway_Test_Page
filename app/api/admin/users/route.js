// R21: named users. Admins create users (username + password + role tester/admin), reset passwords, change role,
// disable / enable and delete. A user's saved cards stay in the tokens table under their username after delete.
// Role and disable changes apply at the user's next sign-in (sessions last up to 12 hours).
import { requireUser, errorResponse, HttpError } from '@/lib/auth';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/crypto';

const NAME = /^[a-z0-9._-]{3,32}$/;

export async function POST(req) {
  try {
    const admin = requireUser('admin');
    const { action, username, password, role } = await req.json();
    const u = String(username || '').trim().toLowerCase();
    if (!NAME.test(u)) throw new HttpError(400, 'Username: 3 to 32 characters, lower-case letters, digits, dot, dash or underscore.');
    if (u === 'demo' || u === 'admin') throw new HttpError(400, 'demo and admin are built-in. Change their passwords below.');
    const pw = String(password || '');
    if ((action === 'create' || action === 'reset') && pw.length < 8) throw new HttpError(400, 'Password: at least 8 characters.');
    const r = role === 'admin' ? 'admin' : 'tester';
    let q;
    if (action === 'create') {
      const { data: exists } = await db().from('users').select('username').eq('username', u).maybeSingle();
      if (exists) throw new HttpError(409, `${u} already exists.`);
      q = db().from('users').insert({ username: u, password_hash: hashPassword(pw), role: r, created_by: admin.user });
    } else if (action === 'reset') q = db().from('users').update({ password_hash: hashPassword(pw) }).eq('username', u);
    else if (action === 'role') q = db().from('users').update({ role: r }).eq('username', u);
    else if (action === 'disable' || action === 'enable') q = db().from('users').update({ disabled: action === 'disable' }).eq('username', u);
    else if (action === 'delete') q = db().from('users').delete().eq('username', u);
    else throw new HttpError(400, 'Unknown action');
    const { error } = await q;
    if (error) throw error;
    if (action === 'reset' || action === 'enable') await db().from('login_attempts').delete().eq('username', u);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
