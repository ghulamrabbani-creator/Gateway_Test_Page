// Admin-editable configuration. Non-secret settings live in app_config.data;
// API passwords live encrypted in the credentials table and never reach the browser.
import { db } from './db';
import { encrypt, decrypt, mask } from './crypto';

export const ENVS = ['test', 'staging', 'production'];
export const ENV_LABEL = { test: 'Test', staging: 'Staging', production: 'Production' };

// Hosts from System_Refs/PGW/pgw-merchant-api-reference.md §1 (test and live MIDs share api.geidea.ae).
// UAE SDK URL from docs.geidea.net (Express Checkout, "SDK Script URLs by Region").
// HPP page = `${hppBaseUrl}/checkout/?{sessionId}`, taken from geideaCheckout.min.js (hppBaseUrl prod
// https://payments.geidea.ae/hpp, preprod https://www.staging.geidea.ae/hpp). Staging SDK path assumed to follow the same pattern.
export const DEFAULT_CONFIG = {
  envs: {
    test: {
      apiBase: 'https://api.geidea.ae',
      sdkUrl: 'https://payments.geidea.ae/hpp/geideaCheckout.min.js',
      hppUrl: 'https://payments.geidea.ae/hpp/checkout/?{sessionId}',
      mpgs: { baseUrl: '', version: '80', merchantId: '' },
      cybs: { host: 'apitest.cybersource.com', merchantId: '' },
    },
    staging: {
      apiBase: 'https://api.staging.geidea.ae',
      sdkUrl: 'https://www.staging.geidea.ae/hpp/geideaCheckout.min.js',
      hppUrl: 'https://www.staging.geidea.ae/hpp/checkout/?{sessionId}',
      mpgs: { baseUrl: '', version: '80', merchantId: '' },
      cybs: { host: 'apitest.cybersource.com', merchantId: '' },
    },
    production: {
      apiBase: 'https://api.geidea.ae',
      sdkUrl: 'https://payments.geidea.ae/hpp/geideaCheckout.min.js',
      hppUrl: 'https://payments.geidea.ae/hpp/checkout/?{sessionId}',
      // Direct MPGS (phase 2). UAE PGW uses API v80 on na-gateway; MID 20100000101 is Geidea's live-testing MID.
      mpgs: { baseUrl: 'https://na-gateway.mastercard.com', version: '80', merchantId: '20100000101' },
      // Direct CYBS (phase 3). REST with HTTP Signature (key ID + shared secret). MID 20100000202 ran the 11-Nov NT POC.
      cybs: { host: 'api.cybersource.com', merchantId: '20100000202' },
    },
  },
  allowDemoOnProduction: false,
  currencies: ['AED', 'USD', 'EUR', 'GBP', 'SAR'],
  offerMoto: false,
  motoExtra: {},
  merchantName: 'Geidea Test Shop',
  publicBaseUrl: '',
  timestampZone: 'UTC',
  users: {},
};

function merge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over ?? base;
  const out = { ...base };
  for (const k of Object.keys(over || {})) out[k] = k in base ? merge(base[k], over[k]) : over[k];
  return out;
}

export async function getConfig() {
  const { data, error } = await db().from('app_config').select('data').eq('id', 1).single();
  if (error) throw error;
  return merge(DEFAULT_CONFIG, data?.data || {});
}

export async function saveConfig(patch) {
  const current = await getConfig();
  const next = merge(current, patch);
  const { error } = await db().from('app_config').update({ data: next, updated_at: new Date().toISOString() }).eq('id', 1);
  if (error) throw error;
  return next;
}

export async function getCreds(env) {
  const { data } = await db().from('credentials').select('*').eq('env', env).maybeSingle();
  if (!data?.public_key || !data?.api_password_enc) return null;
  return { publicKey: data.public_key, apiPassword: decrypt(data.api_password_enc) };
}

// Direct MPGS credentials: gateway URL, API version and merchant ID from app_config, API password encrypted in credentials.
export async function getMpgsCreds(env) {
  const cfg = await getConfig();
  const m = cfg.envs[env]?.mpgs || {};
  const { data } = await db().from('credentials').select('mpgs_password_enc').eq('env', env).maybeSingle();
  if (!m.baseUrl || !m.merchantId || !data?.mpgs_password_enc) return null;
  return { baseUrl: m.baseUrl.replace(/\/$/, ''), version: String(m.version || '80'), merchantId: m.merchantId.trim(), password: decrypt(data.mpgs_password_enc) };
}

// Direct CYBS credentials: host and merchant ID from app_config; REST key ID and shared secret (encrypted) in credentials.
export async function getCybsCreds(env) {
  const cfg = await getConfig();
  const c = cfg.envs[env]?.cybs || {};
  const { data } = await db().from('credentials').select('cybs_key_id,cybs_secret_enc').eq('env', env).maybeSingle();
  if (!c.host || !c.merchantId || !data?.cybs_key_id || !data?.cybs_secret_enc) return null;
  return { host: c.host.replace(/^https?:\/\//, '').replace(/\/$/, ''), merchantId: c.merchantId.trim(), keyId: data.cybs_key_id, secret: decrypt(data.cybs_secret_enc) };
}

export async function saveCybsKey(env, keyId, secretB64) {
  const row = { env, updated_at: new Date().toISOString() };
  if (keyId) row.cybs_key_id = keyId.trim();
  if (secretB64) row.cybs_secret_enc = encrypt(secretB64.trim());
  if (!keyId && !secretB64) return;
  const { error } = await db().from('credentials').upsert(row);
  if (error) throw error;
}

export async function saveMpgsPassword(env, password) {
  if (!password) return;
  const { error } = await db().from('credentials').upsert({ env, mpgs_password_enc: encrypt(password.trim()), updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function credsSummary() {
  const { data } = await db().from('credentials').select('*');
  const out = {};
  for (const env of ENVS) {
    const row = (data || []).find((r) => r.env === env);
    out[env] = { publicKey: row?.public_key || '', passwordSet: !!row?.api_password_enc, passwordHint: row?.api_password_enc ? mask(decrypt(row.api_password_enc)) : '', mpgsPasswordSet: !!row?.mpgs_password_enc, mpgsPasswordHint: row?.mpgs_password_enc ? mask(decrypt(row.mpgs_password_enc)) : '', cybsKeyId: row?.cybs_key_id || '', cybsSecretSet: !!row?.cybs_secret_enc, cybsSecretHint: row?.cybs_secret_enc ? mask(decrypt(row.cybs_secret_enc)) : '', updatedAt: row?.updated_at || null };
  }
  return out;
}

export async function saveCreds(env, publicKey, apiPassword) {
  const row = { env, public_key: (publicKey || '').trim(), updated_at: new Date().toISOString() };
  if (apiPassword) row.api_password_enc = encrypt(apiPassword.trim());
  const { error } = await db().from('credentials').upsert(row);
  if (error) throw error;
}

// Base URL Geidea should call back. Admin override, else the host serving this request.
export function baseUrlFrom(req, cfg) {
  if (cfg.publicBaseUrl) return cfg.publicBaseUrl.replace(/\/$/, '');
  const h = req.headers;
  const host = h.get('x-forwarded-host') || h.get('host');
  const proto = h.get('x-forwarded-proto') || 'https';
  return `${proto}://${host}`;
}

// Fields safe to send to the browser
export function publicConfig(cfg) {
  return {
    allowDemoOnProduction: cfg.allowDemoOnProduction,
    currencies: cfg.currencies,
    offerMoto: cfg.offerMoto,
    envs: Object.fromEntries(ENVS.map((e) => [e, { sdkUrl: cfg.envs[e].sdkUrl, hppUrl: cfg.envs[e].hppUrl, mpgs: { merchantId: cfg.envs[e].mpgs?.merchantId || '', ready: !!(cfg.envs[e].mpgs?.baseUrl && cfg.envs[e].mpgs?.merchantId) }, cybs: { merchantId: cfg.envs[e].cybs?.merchantId || '', ready: !!(cfg.envs[e].cybs?.host && cfg.envs[e].cybs?.merchantId) } }])),
  };
}
