// Direct MPGS (Mastercard Gateway) REST client, phase 2. Every call goes to api_logs like the Geidea route.
// Shapes follow the UAE POC runs in Notes/Projects/Network Tokenization (Visa NT Mandate).md (§MPGS POC runs 2-3, v80,
// MID 20100000101) and Mastercard's Hosted Session / 3DS Payer Authentication API guides.
// Card data reaches MPGS only through the Hosted Session iframes: this server sees the session ID, never the PAN or CVV.
import crypto from 'crypto';
import { db } from './db';
import { getMpgsCreds } from './config';
import { HttpError } from './auth';

export async function mpgsCreds(env) {
  const c = await getMpgsCreds(env);
  if (!c) throw new HttpError(400, `MPGS isn't set up for ${env}. An admin can add the gateway URL, merchant ID and API password in Admin → Credentials.`);
  return c;
}

const base = (c) => `${c.baseUrl}/api/rest/version/${c.version}/merchant/${encodeURIComponent(c.merchantId)}`;
export const sessionJsUrl = (c) => `${c.baseUrl}/form/version/${c.version}/merchant/${encodeURIComponent(c.merchantId)}/session.js`;

export async function mpgsCall({ env, action, method, path, body, orderRef, user }) {
  const c = await mpgsCreds(env);
  const url = base(c) + path;
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Basic ' + Buffer.from(`merchant.${c.merchantId}:${c.password}`).toString('base64') };
  const started = Date.now();
  let status = 0, json = null, error = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    status = res.status;
    const text = await res.text();
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 5000) }; }
  } catch (e) {
    error = e.name === 'AbortError' ? 'Timed out after 30 s' : e.message;
  }
  await db().from('api_logs').insert({
    order_ref: orderRef || null, action: `MPGS · ${action}`, env, method, url,
    req_headers: { ...headers, Authorization: `Basic <merchant.${c.merchantId}:••••>` },
    req_body: body || null, status, res_body: json, duration_ms: Date.now() - started, error, created_by: user?.user || 'system',
  });
  const ok = !error && status >= 200 && status < 300 && json?.result !== 'ERROR' && json?.result !== 'FAILURE';
  return { status, json, error, ok };
}

// ---------- session (Hosted Session card capture) ----------
export const createSession = (env, ref, user) => mpgsCall({ env, action: 'Create session', method: 'POST', path: '/session', body: {}, orderRef: ref, user });
export const getSession = (env, sessionId, ref, user) => mpgsCall({ env, action: 'Retrieve session', method: 'GET', path: `/session/${encodeURIComponent(sessionId)}`, orderRef: ref, user });

const txnPath = (orderId, txnId) => `/order/${encodeURIComponent(orderId)}/transaction/${encodeURIComponent(txnId)}`;

// What pays: the Hosted Session (new card, or CVV only for a saved token) and/or an MPGS token.
function fundsBlock({ sessionId, token, storedOnFile }) {
  const out = {};
  if (sessionId) out.session = { id: sessionId };
  const sof = {};
  if (token) sof.token = token;
  if (storedOnFile) sof.provided = { card: { storedOnFile } };
  if (!token && storedOnFile) sof.type = 'CARD';
  if (Object.keys(sof).length) out.sourceOfFunds = sof;
  return out;
}

// ---------- 3DS (Payer Authentication API, server side) ----------
export function initiateAuth({ env, order, authTxnId, sessionId, token, agreement, user }) {
  const body = {
    apiOperation: 'INITIATE_AUTHENTICATION',
    authentication: { acceptVersions: '3DS1,3DS2', channel: 'PAYER_BROWSER', purpose: 'PAYMENT_TRANSACTION' },
    order: { currency: order.currency },
    ...fundsBlock({ sessionId, token }),
  };
  // MPGS fixes an order's agreement on its first transaction (here the 3DS one). Without it, a PAY carrying an
  // agreement is rejected: "agreement Id specified for a subsequent transaction must match the agreement Id of the order"
  // (MP-79FD6E7C, 14-Nov). So the agreement goes on both 3DS calls and the PAY.
  // Only agreement.id: INITIATE_AUTHENTICATION rejects agreement.type ("Unexpected parameter 'agreement.type'", MP-92175155, 14-Nov).
  if (agreement?.id) body.agreement = { id: agreement.id };
  return mpgsCall({ env, action: 'Initiate authentication', method: 'PUT', path: txnPath(order.ref, authTxnId), body, orderRef: order.ref, user });
}

export function authenticatePayer({ env, order, authTxnId, sessionId, token, agreement, redirectResponseUrl, browser, ip, user }) {
  const body = {
    apiOperation: 'AUTHENTICATE_PAYER',
    authentication: { redirectResponseUrl },
    device: {
      browser: String(browser?.userAgent || 'MOZILLA').slice(0, 255),
      browserDetails: {
        '3DSecureChallengeWindowSize': 'FULL_SCREEN',
        acceptHeaders: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        colorDepth: Number(browser?.colorDepth || 24),
        javaEnabled: false,
        language: browser?.language || 'en-US',
        screenHeight: Number(browser?.screenHeight || 900),
        screenWidth: Number(browser?.screenWidth || 1440),
        timeZone: Number(browser?.timeZone ?? -240),
      },
      ipAddress: ip || undefined,
    },
    order: { amount: Number(order.amount).toFixed(2), currency: order.currency },
    ...fundsBlock({ sessionId, token }),
  };
  if (agreement?.id) body.agreement = { id: agreement.id }; // type goes on the PAY only
  return mpgsCall({ env, action: 'Authenticate payer', method: 'PUT', path: txnPath(order.ref, authTxnId), body, orderRef: order.ref, user });
}

// ---------- payment ----------
// operation PAY (sale) or AUTHORIZE (pre-auth). source INTERNET (CIT), MOTO, or MERCHANT (MIT).
// storedOnFile: TO_BE_STORED on the first card-saving CIT, STORED on repeat CIT/MIT (POC run 2 rules).
export function payOrAuthorize({ env, order, txnId, operation, sessionId, token, authTxnId, source = 'INTERNET', storedOnFile, agreement, user }) {
  const body = {
    apiOperation: operation,
    order: { amount: Number(order.amount).toFixed(2), currency: order.currency, reference: order.ref },
    transaction: { source, reference: order.ref },
    ...fundsBlock({ sessionId, token, storedOnFile }),
  };
  if (authTxnId) body.authentication = { transactionId: authTxnId };
  if (agreement?.id) body.agreement = { id: agreement.id, type: agreement.type || 'UNSCHEDULED' };
  return mpgsCall({ env, action: operation === 'AUTHORIZE' ? 'Authorize' : 'Pay', method: 'PUT', path: txnPath(order.ref, txnId), body, orderRef: order.ref, user });
}

export const capture = (env, ref, txnId, amount, currency, user) =>
  mpgsCall({ env, action: 'Capture', method: 'PUT', path: txnPath(ref, txnId), body: { apiOperation: 'CAPTURE', transaction: { amount: Number(amount).toFixed(2), currency } }, orderRef: ref, user });
export const refund = (env, ref, txnId, amount, currency, user) =>
  mpgsCall({ env, action: 'Refund', method: 'PUT', path: txnPath(ref, txnId), body: { apiOperation: 'REFUND', transaction: { amount: Number(amount).toFixed(2), currency } }, orderRef: ref, user });
export const voidTxn = (env, ref, txnId, targetTransactionId, user) =>
  mpgsCall({ env, action: 'Void', method: 'PUT', path: txnPath(ref, txnId), body: { apiOperation: 'VOID', transaction: { targetTransactionId } }, orderRef: ref, user });
export const retrieveOrder = (env, ref, user, orderId = ref) =>
  mpgsCall({ env, action: 'Retrieve order', method: 'GET', path: `/order/${encodeURIComponent(orderId)}`, orderRef: ref, user });

// ---------- tokens ----------
export const getToken = (env, token, ref, user) => mpgsCall({ env, action: 'Retrieve token', method: 'GET', path: `/token/${encodeURIComponent(token)}`, orderRef: ref, user });

// Tokenize the card held in the Hosted Session. Two flows, picked per payment in the shop settings:
// - geidea (default, what PGW does today): the shop makes the value (32 upper-case hex, like a Geidea tokenId without
//   dashes) and sends it: PUT /token/{value}. Needs a repository that accepts merchant-supplied tokens.
// - mpgs: the shop sends no value and MPGS generates and returns one: POST /token. Needs a repository that generates tokens.
// A repository set the other way answers "Expected card token to be supplied" / "Card token must not be supplied".
export async function tokenizeSession(env, sessionId, ref, user, mode = 'geidea') {
  const body = { session: { id: sessionId }, sourceOfFunds: { type: 'CARD' } };
  if (mode === 'mpgs') return mpgsCall({ env, action: 'Create token (MPGS-generated value)', method: 'POST', path: '/token', body, orderRef: ref, user });
  const value = crypto.randomBytes(16).toString('hex').toUpperCase();
  return mpgsCall({ env, action: 'Create token (Geidea-style value)', method: 'PUT', path: `/token/${value}`, body, orderRef: ref, user });
}

// PGW creates its MPGS token with the Geidea tokenId, dashes removed, upper case (MPGS note, 13-Nov-2026).
export const pgwTokenValue = (geideaTokenId) => String(geideaTokenId || '').replace(/-/g, '').toUpperCase();

// ---------- order row helpers ----------
// MPGS order.status → the same detailed statuses the order page and actions already use.
const STATUS_MAP = {
  CAPTURED: 'Paid', AUTHORIZED: 'Authorized', PARTIALLY_CAPTURED: 'PartiallyCaptured', REFUNDED: 'Refunded', PARTIALLY_REFUNDED: 'PartiallyRefunded',
  CANCELLED: 'Voided', VOIDED: 'Voided', FAILED: 'Failed', DECLINED: 'Failed', AUTHENTICATED: 'Authenticated', AUTHENTICATION_INITIATED: 'Authenticating',
  AUTHENTICATION_NOT_NEEDED: 'Authenticating', AUTHENTICATION_UNSUCCESSFUL: 'Failed', EXCESSIVELY_REFUNDED: 'Refunded', DISBURSED: 'Paid', VERIFIED: 'Verified',
};
export function mpgsStatus(order) {
  const s = order?.status;
  const detailed = STATUS_MAP[s] || s || 'Unknown';
  const status = ['Failed'].includes(detailed) ? 'Failed' : ['Authenticating', 'Authenticated', 'Unknown'].includes(detailed) ? 'InProgress' : 'Success';
  return { status, detailed };
}

// Store the latest retrieve-order response on our row.
export async function syncMpgsOrder(ref, mo) {
  if (!mo || !mo.id) return null;
  const { status, detailed } = mpgsStatus(mo);
  const patch = { status, detailed_status: detailed, captured: mo.totalCapturedAmount ?? 0, refunded: mo.totalRefundedAmount ?? 0, last_order: mo, updated_at: new Date().toISOString() };
  const { data } = await db().from('orders').update(patch).eq('ref', ref).select().maybeSingle();
  return data;
}

export const nextTxnId = (row, prefix) => `${prefix}-${(row.last_order?.transaction?.length || 0) + 1}-${Date.now().toString(36)}`;
export const cardFromMpgs = (j) => {
  const card = j?.sourceOfFunds?.provided?.card || {};
  return { brand: card.brand, masked: card.number, expiry: typeof card.expiry === 'string' ? { month: card.expiry.slice(0, 2), year: card.expiry.slice(2) } : card.expiry, issuer: card.issuer, funding: card.fundingMethod };
};

// Per-order MPGS working state lives in orders.options.mpgs (session, 3DS transaction, results).
export async function patchMpgs(ref, patch) {
  const { data: row } = await db().from('orders').select('options').eq('ref', ref).maybeSingle();
  const options = { ...(row?.options || {}), mpgs: { ...(row?.options?.mpgs || {}), ...patch } };
  const { data } = await db().from('orders').update({ options, updated_at: new Date().toISOString() }).eq('ref', ref).select().maybeSingle();
  return data;
}

export const clientIp = (req) => (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || undefined;
