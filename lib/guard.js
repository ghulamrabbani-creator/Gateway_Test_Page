// Production guard-rails (R12). Limits come from Admin → General; enforced on the server for every route.
// - per-payment cap: new payments, MITs and captures above it are refused (refunds are capped by what was captured)
// - daily count: new Production payments (orders) per Dubai calendar day
// - confirmation: Production refunds, voids and MITs must be confirmed in the browser (body.confirmed === true)
import { db } from './db';
import { getConfig } from './config';
import { HttpError } from './auth';

export const LIMIT_DEFAULTS = { prodMaxAmount: 5, prodDailyPayments: 20 };

function dubaiMidnightUtc() {
  const now = new Date(Date.now() + 4 * 3600 * 1000); // GST = UTC+4, no DST
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 4 * 3600 * 1000).toISOString();
}

export async function assertProdPayment(env, amount) {
  if (env !== 'production') return;
  const cfg = await getConfig();
  const max = Number(cfg.prodMaxAmount ?? LIMIT_DEFAULTS.prodMaxAmount);
  const daily = Number(cfg.prodDailyPayments ?? LIMIT_DEFAULTS.prodDailyPayments);
  if (Number(amount) > max) throw new HttpError(400, `Production payments are capped at ${max.toFixed(2)} per payment (Admin → General).`);
  const { data } = await db().from('orders').select('options').eq('env', 'production').gte('created_at', dubaiMidnightUtc());
  const count = (data || []).filter((o) => !o.options?.external).length; // imported lookups don't count
  if (count >= daily) throw new HttpError(429, `Daily Production limit reached (${daily} payments today, Dubai time). An admin can raise it in Admin → General.`);
}

export async function assertProdAmount(env, amount) {
  if (env !== 'production') return;
  const cfg = await getConfig();
  const max = Number(cfg.prodMaxAmount ?? LIMIT_DEFAULTS.prodMaxAmount);
  if (Number(amount) > max) throw new HttpError(400, `Production amounts are capped at ${max.toFixed(2)} (Admin → General).`);
}

export function assertConfirmed(env, confirmed, what) {
  if (env === 'production' && confirmed !== true) throw new HttpError(400, `${what} on Production needs confirmation.`);
}
