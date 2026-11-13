// Geidea PGW merchant API client (UAE). Every call is written to api_logs (the request inspector).
// Endpoints, bodies and signatures follow System_Refs/PGW/pgw-merchant-api-reference.md.
import crypto from 'crypto';
import { db } from './db';
import { getConfig, getCreds } from './config';
import { HttpError } from './auth';

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

// ---------- transport + logging ----------
async function creds(env) {
  const c = await getCreds(env);
  if (!c) throw new HttpError(400, `No ${env} credentials yet. An admin can add them in Admin → Credentials.`);
  return c;
}

export async function call({ env, action, method, path, body, orderRef, user }) {
  const cfg = await getConfig();
  const { publicKey, apiPassword } = await creds(env);
  const url = cfg.envs[env].apiBase.replace(/\/$/, '') + path;
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: 'Basic ' + Buffer.from(`${publicKey}:${apiPassword}`).toString('base64'),
  };
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
    order_ref: orderRef || null,
    action,
    env,
    method,
    url,
    req_headers: { ...headers, Authorization: `Basic <${publicKey.slice(0, 4)}…:••••>` },
    req_body: body || null,
    status,
    res_body: json,
    duration_ms: Date.now() - started,
    error,
    created_by: user?.user || 'system',
  });
  return { status, json, error, ok: !error && status >= 200 && status < 300 && isGeideaOk(json) };
}

export function isGeideaOk(json) {
  if (!json) return false;
  const code = json.responseCode ?? json.order?.responseCode;
  return code === undefined || code === '000' || code === '0';
}

// ---------- operations ----------
// Builds the HPP Create Session body from the shop settings (reference §4 variants).
export async function createHppSession({ env, order, settings, customer, baseUrl, user }) {
  const cfg = await getConfig();
  const { publicKey, apiPassword } = await creds(env);
  const ts = geideaTimestamp();
  const body = {
    amount: Number(order.amount),
    currency: order.currency,
    timestamp: ts,
    merchantReferenceId: order.ref,
    signature: sessionSignature(publicKey, order.amount, order.currency, order.ref, ts, apiPassword),
    paymentOperation: order.operation,
    callbackUrl: `${baseUrl}/api/callback`,
    returnUrl: `${baseUrl}/return?ref=${encodeURIComponent(order.ref)}`,
    language: settings.language || 'en',
  };
  if (customer && (customer.email || customer.firstName)) {
    body.customer = {
      email: customer.email || undefined,
      phoneNumber: customer.phone || undefined,
      phonecountrycode: customer.phone ? customer.phoneCountryCode || '+971' : undefined,
      firstName: customer.firstName || undefined,
      lastName: customer.lastName || undefined,
    };
    // PGW rejects a partial address with 110/013 "Invalid billing address", so send it only when complete
    if (customer.city && customer.street) {
      const a = { country: 'ARE', city: customer.city, street: customer.street, postalCode: '0000' };
      body.customer.address = { billing: a, shipping: a };
    }
  }
  body.appearance = {
    merchant: { name: settings.showMerchantName ? cfg.merchantName : null },
    showEmail: !!settings.showEmail,
    showAddress: !!settings.showAddress,
    showPhone: !!settings.showPhone,
    receiptPage: !!settings.receiptPage,
    styles: {
      hideGeideaLogo: !!settings.hideGeideaLogo,
      headerColor: settings.headerColor || null,
      hppProfile: settings.hppProfile || 'simple',
    },
  };
  if (settings.mode === 'dropin') body.appearance.uiMode = 'dropin';
  if (settings.hideWallets) body.hideWallets = ['apple-pay', 'google-pay', 'samsung-pay'];

  // Card on file
  if (settings.saveCard === 'cit') body.cardOnFile = true;
  if (settings.saveCard === 'mit' || settings.saveCard === 'citmit') {
    body.cardOnFile = true;
    body.cofAgreement = { id: order.agreement_id, type: settings.agreementType || 'Unscheduled' };
    body.initiatedBy = 'Internet';
  }
  if (settings.tokenId && settings.auth !== 'moto') body.tokenId = settings.tokenId.trim();
  if (settings.auth === 'moto') {
    body.initiatedBy = 'moto';
    Object.assign(body, cfg.motoExtra || {});
  }

  // Drop-in uses the v1 session path (reference §4, "HPP – Drop in")
  const path = settings.mode === 'dropin' ? '/payment-intent/api/v1/direct/session' : '/payment-intent/api/v2/direct/session';
  return call({ env, action: 'Create session', method: 'POST', path, body, orderRef: order.ref, user });
}

export async function saveCardSession({ env, ref, currency, baseUrl, user }) {
  const body = { currency, callbackUrl: `${baseUrl}/api/callback`, returnUrl: `${baseUrl}/cards?saved=${encodeURIComponent(ref)}`, merchantReferenceId: ref };
  return call({ env, action: 'Save card session', method: 'POST', path: '/payment-intent/api/v1/direct/session/saveCard', body, orderRef: ref, user });
}

// MIT: session with initiatedBy Merchant, then pay with token (reference §5.3 steps 6-7)
export async function mitCharge({ env, order, tokenId, agreementId, agreementType, baseUrl, user }) {
  const { publicKey, apiPassword } = await creds(env);
  const ts = geideaTimestamp();
  const sessionBody = {
    tokenId,
    agreementId,
    amount: Number(order.amount).toFixed(2),
    currency: order.currency,
    timestamp: ts,
    merchantReferenceId: order.ref,
    signature: sessionSignature(publicKey, order.amount, order.currency, order.ref, ts, apiPassword),
    callbackUrl: `${baseUrl}/api/callback`,
    paymentOperation: order.operation,
    initiatedBy: 'Merchant',
    agreementType,
  };
  const s = await call({ env, action: 'Create MIT session', method: 'POST', path: '/payment-intent/api/v2/direct/session', body: sessionBody, orderRef: order.ref, user });
  const sessionId = s.json?.session?.id;
  if (!s.ok || !sessionId) return { session: s, pay: null };
  const payBody = {
    sessionid: sessionId,
    callbackUrl: `${baseUrl}/api/callback`,
    initiatedBy: 'Merchant',
    agreementId,
    agreementType,
    signature: tokenPaySignature(publicKey, sessionId, apiPassword),
    merchantReferenceId: order.ref,
  };
  const pay = await call({ env, action: 'Pay with token (MIT)', method: 'POST', path: '/pgw/api/v2/direct/pay/token', body: payBody, orderRef: order.ref, user });
  return { session: s, pay, sessionId };
}

export const fetchOrder = (env, orderId, ref, user) =>
  call({ env, action: 'Fetch order', method: 'GET', path: `/pgw/api/v1/direct/order/${encodeURIComponent(orderId)}`, orderRef: ref, user });

export const fetchOrderByRef = (env, ref, user) =>
  call({ env, action: 'Fetch order by reference', method: 'GET', path: `/pgw/api/v1/direct/order?MerchantReferenceId=${encodeURIComponent(ref)}`, orderRef: ref, user });

export const capture = (env, orderId, amount, baseUrl, ref, user) =>
  call({ env, action: 'Capture', method: 'POST', path: '/pgw/api/v1/direct/capture', body: { orderId, callbackUrl: `${baseUrl}/api/callback`, captureAmount: Number(amount).toFixed(2) }, orderRef: ref, user });

export const voidOrder = (env, orderId, baseUrl, ref, user) =>
  call({ env, action: 'Void', method: 'POST', path: '/pgw/api/v3/direct/void', body: { orderId, callbackUrl: `${baseUrl}/api/callback` }, orderRef: ref, user });

export async function refund(env, orderId, amount, baseUrl, ref, user) {
  const { publicKey, apiPassword } = await creds(env);
  const ts = geideaTimestamp();
  const body = { orderId, callbackUrl: `${baseUrl}/api/callback`, refundAmount: Number(amount).toFixed(2), TimeStamp: ts, signature: refundSignature(ts, publicKey, amount, orderId, apiPassword) };
  return call({ env, action: 'Refund', method: 'POST', path: '/pgw/api/v2/direct/refund', body, orderRef: ref, user });
}

// ---------- keep our order row in step with Geidea's order object ----------
export function extractOrder(json) {
  if (!json) return null;
  if (json.order && typeof json.order === 'object') return json.order;
  if (Array.isArray(json.orders) && json.orders.length) return json.orders[0];
  if (json.orderId && json.status) return json;
  return null;
}

export async function syncOrder(ref, order) {
  if (!order) return null;
  const patch = {
    status: order.status || undefined,
    detailed_status: order.detailedStatus || undefined,
    geidea_order_id: order.orderId || undefined,
    captured: order.totalCapturedAmount ?? undefined,
    refunded: order.totalRefundedAmount ?? undefined,
    last_order: order,
    updated_at: new Date().toISOString(),
  };
  if (order.tokenId) patch.token_id = order.tokenId;
  const { data } = await db().from('orders').update(patch).eq('ref', ref).select().maybeSingle();

  // Token captured on a save-card payment → mark the saved card active
  if (data && order.tokenId) {
    const pm = order.paymentMethod || {};
    const card = { brand: pm.brand, masked: pm.maskedCardNumber, expiry: pm.expiryDate, issuer: pm.issuingBank, funding: pm.fundingType };
    const { data: tok } = await db().from('tokens').select('id').eq('order_ref', ref).maybeSingle();
    const ok = order.status === 'Success';
    if (tok) await db().from('tokens').update({ token_id: order.tokenId, card, status: ok ? 'ACTIVE' : 'FAILED' }).eq('id', tok.id);
  } else if (data && data.options?.saveCard && data.options.saveCard !== 'none' && order.status === 'Failed') {
    await db().from('tokens').update({ status: 'FAILED' }).eq('order_ref', ref).eq('status', 'PENDING');
  }
  return data;
}
