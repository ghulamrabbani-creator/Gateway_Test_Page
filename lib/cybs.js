// Direct CyberSource REST client, phase 3. Every call goes to api_logs like the other routes.
// Signing and request shapes follow the 11-Nov CYBS POC on MID 20100000202 (Notes/Projects/Network Tokenization
// (Visa NT Mandate).md §CYBS POC): HTTP Signature over host, v-c-date, request-target, digest (with a body),
// v-c-merchant-id; HMAC-SHA256 with the Base64-decoded shared secret.
// Card data reaches CYBS only through Microform (hosted fields); this server handles the transient token JWT.
import crypto from 'crypto';
import { db } from './db';
import { getCybsCreds } from './config';
import { HttpError } from './auth';

export async function cybsCreds(env) {
  const c = await getCybsCreds(env);
  if (!c) throw new HttpError(400, `CYBS isn't set up for ${env}. An admin can add the host, merchant ID, REST key ID and shared secret in Admin → Credentials.`);
  return c;
}

function signHeaders(c, method, path, bodyText) {
  const date = new Date().toUTCString();
  const h = { host: c.host, 'v-c-date': date, 'request-target': `${method.toLowerCase()} ${path}`, 'v-c-merchant-id': c.merchantId };
  const names = ['host', 'v-c-date', 'request-target'];
  if (bodyText !== undefined) {
    h.digest = 'SHA-256=' + crypto.createHash('sha256').update(bodyText, 'utf8').digest('base64');
    names.push('digest');
  }
  names.push('v-c-merchant-id');
  const signing = names.map((n) => `${n}: ${h[n]}`).join('\n');
  const sig = crypto.createHmac('sha256', Buffer.from(c.secret, 'base64')).update(signing, 'utf8').digest('base64');
  const out = { 'v-c-date': date, 'v-c-merchant-id': c.merchantId, Signature: `keyid="${c.keyId}", algorithm="HmacSHA256", headers="${names.join(' ')}", signature="${sig}"` };
  if (h.digest) out.Digest = h.digest;
  return out;
}

export async function cybsCall({ env, action, method, path, body, orderRef, user }) {
  const c = await cybsCreds(env);
  const url = `https://${c.host}${path}`;
  const bodyText = body ? JSON.stringify(body) : undefined;
  const headers = { 'Content-Type': 'application/json;charset=utf-8', Accept: 'application/hal+json;charset=utf-8, application/jwt, application/json', ...signHeaders(c, method, path, bodyText) };
  const started = Date.now();
  let status = 0, json = null, error = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    const res = await fetch(url, { method, headers, body: bodyText, signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    status = res.status;
    const text = await res.text();
    try { json = text ? JSON.parse(text) : null; } catch { json = /^ey[\w-]+\.[\w-]+\./.test(text.trim()) ? { jwt: text.trim() } : { raw: text.slice(0, 5000) }; }
  } catch (e) {
    error = e.name === 'AbortError' ? 'Timed out after 30 s' : e.message;
  }
  const logBody = json?.jwt ? { jwt: `${json.jwt.slice(0, 40)}… (capture context JWT, ${json.jwt.length} chars)` } : json;
  await db().from('api_logs').insert({
    order_ref: orderRef || null, action: `CYBS · ${action}`, env, method, url,
    req_headers: { ...headers, Signature: `keyid="${c.keyId.slice(0, 6)}…", algorithm="HmacSHA256", signature="••••"` },
    req_body: maskBody(body), status, res_body: logBody, duration_ms: Date.now() - started, error, created_by: user?.user || 'system',
  });
  const bad = ['DECLINED', 'INVALID_REQUEST', 'SERVER_ERROR', 'AUTHORIZED_RISK_DECLINED', 'AUTHENTICATION_FAILED'];
  const ok = !error && status >= 200 && status < 300 && !bad.includes(json?.status);
  return { status, json, error, ok };
}

// Transient tokens are short-lived but still card credentials: keep only their start in the logs.
function maskBody(b) {
  if (!b) return null;
  const s = JSON.parse(JSON.stringify(b));
  const tj = s.tokenInformation?.transientTokenJwt;
  if (tj) s.tokenInformation.transientTokenJwt = `${tj.slice(0, 24)}…`;
  const tt = s.tokenInformation?.transientToken;
  if (tt) s.tokenInformation.transientToken = `${tt.slice(0, 24)}…`;
  return s;
}

// ---------- Microform capture context ----------
export const captureContext = (env, ref, origin, user) => cybsCall({
  env, action: 'Microform capture context', method: 'POST', path: '/microform/v2/sessions', orderRef: ref, user,
  body: { clientVersion: 'v2.0', targetOrigins: [origin], allowedCardNetworks: ['VISA', 'MASTERCARD', 'AMEX'], allowedPaymentTypes: ['CARD'] },
});

// ---------- payer authentication ----------
// What pays: a Microform transient token (new card) or a TMS instrument identifier (saved card) + expiry.
export function paymentInfo({ transientToken, iiId, expiry }) {
  if (iiId) return { paymentInformation: { instrumentIdentifier: { id: iiId }, ...(expiry?.month ? { card: { expirationMonth: String(expiry.month).padStart(2, '0'), expirationYear: String(expiry.year).length === 2 ? `20${expiry.year}` : String(expiry.year) } } : {}) } };
  return { tokenInformation: { transientTokenJwt: transientToken } };
}

export const authSetup = (env, row, funds, user) => cybsCall({
  env, action: 'Payer auth setup', method: 'POST', path: '/risk/v1/authentication-setups', orderRef: row.ref, user,
  body: { clientReferenceInformation: { code: row.ref }, ...(funds.tokenInformation ? { tokenInformation: { transientToken: funds.tokenInformation.transientTokenJwt } } : funds) },
});

export function billTo(customer = {}) {
  return {
    firstName: customer.firstName || 'Test', lastName: customer.lastName || 'Geidea',
    address1: customer.street || 'Al Barsha', locality: customer.city || 'Dubai', administrativeArea: 'DU', postalCode: '00000', country: 'AE',
    email: customer.email || 'test@example.com', phoneNumber: `${(customer.phoneCountryCode || '+971').replace('+', '')}${customer.phone || '500000000'}`,
  };
}

export function deviceInfo(browser = {}, ip) {
  return {
    ipAddress: ip, httpAcceptBrowserValue: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', httpAcceptContent: 'text/html',
    httpBrowserLanguage: browser.language || 'en-US', httpBrowserJavaEnabled: false, httpBrowserJavaScriptEnabled: true,
    httpBrowserColorDepth: String(browser.colorDepth || 24), httpBrowserScreenHeight: String(browser.screenHeight || 900), httpBrowserScreenWidth: String(browser.screenWidth || 1440),
    httpBrowserTimeDifference: String(browser.timeZone ?? -240), userAgentBrowserValue: browser.userAgent || 'Mozilla/5.0',
  };
}

// One payments call covers the plain sale/auth, 3DS enrolment (CONSUMER_AUTHENTICATION) and the post-challenge
// validation (VALIDATE_CONSUMER_AUTHENTICATION). Card-on-file follows the POC: first CIT credentialStoredOnFile,
// repeat CIT storedCredentialUsed, MIT initiator merchant + previousTransactionId (+ optional DECISION_SKIP).
export function payment({ env, row, funds, capture, actions = [], auth, cof, commerceIndicator = 'internet', saveCard, customer, browser, ip, user, action }) {
  const pi = { capture: !!capture, commerceIndicator };
  const list = [...actions];
  if (saveCard) { list.push('TOKEN_CREATE'); pi.actionTokenTypes = ['instrumentIdentifier']; }
  if (list.length) pi.actionList = list;
  if (cof) pi.authorizationOptions = { initiator: cof };
  const body = {
    clientReferenceInformation: { code: row.ref },
    processingInformation: pi,
    ...funds,
    orderInformation: { amountDetails: { totalAmount: Number(row.amount).toFixed(2), currency: row.currency }, billTo: billTo(customer) },
  };
  if (funds.paymentInformation?.instrumentIdentifier) body.tokenInformation = { ...(body.tokenInformation || {}), networkTokenOption: 'prefer' };
  if (auth) body.consumerAuthenticationInformation = auth;
  if (browser || ip) body.deviceInformation = deviceInfo(browser, ip);
  return cybsCall({ env, action: action || (capture ? 'Sale' : 'Authorization'), method: 'POST', path: '/pts/v2/payments', body, orderRef: row.ref, user });
}

export const capturePayment = (env, ref, paymentId, amount, currency, user) =>
  cybsCall({ env, action: 'Capture', method: 'POST', path: `/pts/v2/payments/${paymentId}/captures`, orderRef: ref, user, body: { clientReferenceInformation: { code: ref }, orderInformation: { amountDetails: { totalAmount: Number(amount).toFixed(2), currency } } } });
// Refund a sale (payment id) or a capture (capture id)
export const refundTxn = (env, ref, kind, id, amount, currency, user) =>
  cybsCall({ env, action: 'Refund', method: 'POST', path: `/pts/v2/${kind === 'capture' ? 'captures' : 'payments'}/${id}/refunds`, orderRef: ref, user, body: { clientReferenceInformation: { code: ref }, orderInformation: { amountDetails: { totalAmount: Number(amount).toFixed(2), currency } } } });
// Void a sale/capture/refund (same day, before batch) — not for a plain authorization
export const voidTxn = (env, ref, kind, id, user) =>
  cybsCall({ env, action: 'Void', method: 'POST', path: `/pts/v2/${kind}/${id}/voids`, orderRef: ref, user, body: { clientReferenceInformation: { code: ref } } });
// Release an uncaptured authorization
export const reverseAuth = (env, ref, paymentId, amount, user) =>
  cybsCall({ env, action: 'Auth reversal', method: 'POST', path: `/pts/v2/payments/${paymentId}/reversals`, orderRef: ref, user, body: { clientReferenceInformation: { code: ref }, reversalInformation: { amountDetails: { totalAmount: Number(amount).toFixed(2) }, reason: 'test reversal' } } });
export const getTransaction = (env, id, ref, user) => cybsCall({ env, action: 'Retrieve transaction', method: 'GET', path: `/tss/v2/transactions/${id}`, orderRef: ref, user });
export const getInstrumentIdentifier = (env, id, ref, user) => cybsCall({ env, action: 'Retrieve instrument identifier', method: 'GET', path: `/tms/v1/instrumentidentifiers/${id}`, orderRef: ref, user });

// ---------- order row helpers ----------
// CYBS has no order object: we keep our own ledger of CYBS transactions in options.cybs.txns.
export async function patchCybs(ref, patch) {
  const { data: row } = await db().from('orders').select('options').eq('ref', ref).maybeSingle();
  const options = { ...(row?.options || {}), cybs: { ...(row?.options?.cybs || {}), ...patch } };
  const { data } = await db().from('orders').update({ options, updated_at: new Date().toISOString() }).eq('ref', ref).select().maybeSingle();
  return data;
}

export async function recordTxn(ref, kind, r, amount) {
  const { data: row } = await db().from('orders').select('*').eq('ref', ref).maybeSingle();
  const txns = [...(row?.options?.cybs?.txns || []), { kind, id: r.json?.id || null, status: r.json?.status || (r.error ? 'ERROR' : `HTTP ${r.status}`), amount: amount != null ? Number(amount) : null, at: new Date().toISOString() }];
  const ok = (t) => !['DECLINED', 'INVALID_REQUEST', 'ERROR', 'SERVER_ERROR', 'AUTHORIZED_RISK_DECLINED', 'PENDING_AUTHENTICATION', 'AUTHENTICATION_FAILED'].includes(t.status) && t.id;
  const sum = (k) => txns.filter((t) => t.kind === k && ok(t)).reduce((a, t) => a + (t.amount || 0), 0);
  const pay = txns.find((t) => (t.kind === 'sale' || t.kind === 'auth') && ok(t));
  const voided = txns.some((t) => (t.kind === 'void' || t.kind === 'reversal') && ok(t));
  let captured = sum('capture') + (pay?.kind === 'sale' ? pay.amount : 0);
  const refunded = sum('refund');
  let detailed = 'Failed', status = 'Failed';
  if (pay) {
    status = 'Success';
    detailed = voided ? 'Voided' : refunded > 0 ? (refunded >= captured ? 'Refunded' : 'PartiallyRefunded') : captured > 0 ? 'Paid' : 'Authorized';
    if (voided) captured = 0;
  } else if (txns.some((t) => t.status === 'PENDING_AUTHENTICATION')) { status = 'InProgress'; detailed = 'Authenticating'; }
  const options = { ...(row?.options || {}), cybs: { ...(row?.options?.cybs || {}), txns, paymentId: pay?.id || row?.options?.cybs?.paymentId || null } };
  const patch = { options, status, detailed_status: detailed, captured, refunded, updated_at: new Date().toISOString() };
  if (r.json && (kind === 'sale' || kind === 'auth' || kind === 'auth-attempt')) patch.last_order = r.json;
  const { data } = await db().from('orders').update(patch).eq('ref', ref).select().maybeSingle();
  return data;
}
