// Merchant reference and agreement ID: typed on the checkout page or generated (same formats as before).
// Pure helpers, safe on server and client.
const fail = (msg) => Object.assign(new Error(msg), { status: 400 }); // no server imports: this file is also used in the browser

export const REF_PREFIX = { geidea: 'TS', mpgs: 'MP', cybs: 'CY' };
const rand8 = () => Array.from({ length: 8 }, () => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('');
export const genRef = (route = 'geidea') => `${REF_PREFIX[route] || 'TS'}-${rand8()}-${Math.floor(Date.now() / 1000)}`;
// Geidea cofAgreement.id has been a UUID; MPGS agreement.id an AGR-… string (both are merchant-chosen).
export const genAgreement = (route = 'geidea') => (route === 'mpgs' ? `AGR-${rand8()}-${Date.now().toString(36)}` : (globalThis.crypto?.randomUUID?.() || `${rand8()}-${rand8()}`));

// MPGS order IDs: up to 40 characters; keep the same rule for every route so one reference works anywhere.
export function cleanRef(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(s)) throw fail('Merchant reference: up to 40 characters, letters, digits, dot, dash or underscore.');
  return s;
}
export function cleanAgreement(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(s)) throw fail('Agreement ID: up to 100 characters, letters, digits, dot, dash, colon or underscore.');
  return s;
}
