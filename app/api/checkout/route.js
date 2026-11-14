import { assertProdPayment } from '@/lib/guard';
import { cleanAgreement } from '@/lib/refs';
import { freeRef } from '@/lib/orders';
import { requireUser, assertEnvAllowed, errorResponse, HttpError } from '@/lib/auth';
import { getConfig, baseUrlFrom } from '@/lib/config';
import { db } from '@/lib/db';
import { createHppSession } from '@/lib/geidea';
import { responseInsights } from '@/lib/insights';
import { PRODUCTS } from '@/lib/products';
import { shortId, uuid } from '@/lib/crypto';

export async function POST(req) {
  try {
    const user = requireUser();
    const { items = {}, settings = {}, customer = {}, customAmount, merchantRef, agreementId } = await req.json();
    const env = settings.env || 'test';
    await assertEnvAllowed(user, env);
    const cfg = await getConfig();
    if (settings.auth === 'moto' && !cfg.offerMoto) throw new HttpError(400, 'MOTO is switched off in Admin.');

    let amount = Object.entries(items).reduce((sum, [id, q]) => sum + (PRODUCTS.find((p) => p.id === id)?.price || 0) * Number(q || 0), 0);
    if (customAmount !== undefined && customAmount !== '' && customAmount !== null) amount = Number(customAmount);
    if (!(amount > 0)) throw new HttpError(400, 'Cart is empty (or the custom amount is not above zero).');
    amount = Math.round(amount * 100) / 100;
    await assertProdPayment(env, amount);

    const saveCard = settings.saveCard || 'none';
    const order = {
      ref: (await freeRef(merchantRef)) || `TS-${shortId()}-${Math.floor(Date.now() / 1000)}`,
      env,
      route: 'geidea',
      operation: settings.operation === 'PreAuthorize' ? 'PreAuthorize' : 'Pay',
      amount,
      currency: settings.currency || 'AED',
      customer,
      options: settings,
      token_id: settings.tokenId || null,
      agreement_id: saveCard === 'mit' || saveCard === 'citmit' ? cleanAgreement(agreementId) || uuid() : null,
      agreement_type: saveCard === 'mit' || saveCard === 'citmit' ? settings.agreementType || 'Unscheduled' : null,
      created_by: user.user,
    };
    const { error } = await db().from('orders').insert(order);
    if (error) throw error;
    if (saveCard !== 'none') {
      await db().from('tokens').insert({ env, usage: { cit: 'CIT', mit: 'MIT', citmit: 'CIT+MIT' }[saveCard], agreement_id: order.agreement_id, agreement_type: order.agreement_type, source: 'payment', order_ref: order.ref, created_by: user.user });
    }

    const baseUrl = baseUrlFrom(req, cfg);
    const r = await createHppSession({ env, order, settings, customer, baseUrl, user });
    const sessionId = r.json?.session?.id;
    if (!r.ok || !sessionId) {
      await db().from('orders').update({ status: 'SessionFailed' }).eq('ref', order.ref);
      return Response.json({ error: 'Create Session failed', ref: order.ref, insights: responseInsights({ status: r.status, res_body: r.json, error: r.error }) }, { status: 502 });
    }
    await db().from('orders').update({ session_id: sessionId, status: 'SessionCreated' }).eq('ref', order.ref);
    const e = cfg.envs[env];
    return Response.json({ ref: order.ref, sessionId, mode: settings.mode || 'modal', sdkUrl: e.sdkUrl, hppUrl: e.hppUrl.replace('{sessionId}', sessionId) });
  } catch (e) {
    return errorResponse(e);
  }
}
