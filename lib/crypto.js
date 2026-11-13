import crypto from 'crypto';

function secret() {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 16) throw new Error('APP_SECRET (16+ characters) must be set in Vercel');
  return s;
}
const encKey = () => crypto.createHash('sha256').update('enc:' + secret()).digest();
const macKey = () => crypto.createHash('sha256').update('mac:' + secret()).digest();

// AES-256-GCM for API passwords stored in Supabase
export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
export function decrypt(blob) {
  if (!blob) return '';
  const [iv, tag, enc] = blob.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', encKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

export function sign(data) {
  return crypto.createHmac('sha256', macKey()).update(data).digest('base64url');
}
export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function hashPassword(p) {
  const salt = crypto.randomBytes(16).toString('base64');
  const h = crypto.scryptSync(String(p), salt, 32).toString('base64');
  return `${salt}:${h}`;
}
export function checkPassword(p, stored) {
  if (!stored) return false;
  const [salt, h] = stored.split(':');
  return safeEqual(crypto.scryptSync(String(p), salt, 32).toString('base64'), h);
}

export function mask(v) {
  if (!v) return '';
  const s = String(v);
  return s.length <= 6 ? '••••' : s.slice(0, 4) + '••••' + s.slice(-4);
}

export function shortId() {
  return crypto.randomUUID().split('-')[0].toUpperCase();
}
export const uuid = () => crypto.randomUUID();
