import crypto from 'node:crypto';
// ---------- signatures (reference §2) ----------
export function geideaTimestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  let h = d.getUTCHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}/${d.getUTCFullYear()} ${p(h)}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} ${ampm}`;
}
const hmacB64 = (data, key) => crypto.createHmac('sha256', key).update(data).digest('base64');
export const sessionSignature = (pk, amount, currency, ref, ts, pwd) => hmacB64(pk + Number(amount).toFixed(2) + currency + ref + ts, pwd);
export const refundSignature = (ts, pk, amount, orderId, pwd) => hmacB64(ts + pk + Number(amount).toFixed(2) + orderId, pwd);
export const tokenPaySignature = (pk, sessionId, pwd) => hmacB64(pk + sessionId, pwd);

