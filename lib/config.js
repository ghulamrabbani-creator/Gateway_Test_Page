// Admin-editable configuration. Non-secret settings live in app_config.data;
// API passwords live encrypted in the credentials table and never reach the browser.
import { db } from './db';
import { encrypt, decrypt, mask } from './crypto';

export const ENVS = ['test', 'staging', 'production'];
export const ENV_LABEL = { test: 'Test', staging: 'Staging', production: 'Production' };

// Hosts from System_Refs/PGW/pgw-merchant-api-reference.md §1 (test and live MIDs share api.geidea.ae).
// UAE SDK URL from docs.geidea.net (Express Checkout, "SDK Script URLs by Region").
// Staging SDK / HPP hosts are a best guess: confirm with PGW engineering and edit in Admin.
export const DEFAULT_CONFIG = {
  envs: {
    test: {
      apiBase: 'https://api.geidea.ae',
      sdkUrl: 'https://payments.geidea.ae/hpp/geideaCheckout.min.js',
      hppUrl: 'https://payments.geidea.ae/checkout/?{sessionId}',
    },
    staging: {
      apiBase: 'https://api.staging.geidea.ae',
      sdkUrl: 'https://payments.staging.geidea.ae/hpp/geideaCheckout.min.js',
      hppUrl: 'https://payments.staging.geidea.ae/checkout/?{sessionId}',
    },
    production: {
      apiBase: 'https://api.geidea.ae',
      sdkUrl: 'https://payments.geidea.ae/hpp/geideaCheckout.min.js',
      hppUrl: 'https://payments.geidea.ae/checkout/?{sessionId}',
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

export async function credsSummary() {
  const { data } = await db().from('credentials').select('*');
  const out = {};
  for (const env of ENVS) {
    const row = (data || []).find((r) => r.env === env);
    out[env] = { publicKey: row?.public_key || '', passwordSet: !!row?.api_password_enc, passwordHint: row?.api_password_enc ? mask(decrypt(row.api_password_enc)) : '', updatedAt: row?.updated_at || null };
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
    envs: Object.fromEntries(ENVS.map((e) => [e, { sdkUrl: cfg.envs[e].sdkUrl, hppUrl: cfg.envs[e].hppUrl }])),
  };
}
