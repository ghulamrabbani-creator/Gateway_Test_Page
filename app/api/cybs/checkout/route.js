// CYBS direct, step 1: our order row + a Microform capture context (JWT). The browser loads Microform from the JWT's
// client library, collects the card in CYBS-hosted fields and gets a transient token. Saved cards (TMS instrument
// identifier) skip Microform.
import { assertProdPayment } from '@/lib/guard';
import { freeRef } from '@/lib/orders';
import { requireUser, assertEnvAllowed, errorResponse, HttpError } from '@/lib/auth';
import { db } from '@/lib/db';
import { getConfig, baseUrlFrom } from '@/lib/config';
import { cybsCreds, captureContext } from '@/lib/cybs';
import { responseInsights } from '@/lib/insights';
import { shortId, uuid } from '@/lib/crypto';

export async function POST(req) {
  try {
    const user = requireUser();
    const { settings = {}, customer = {}, amount: rawAmount, merchantRef } = await req.json();
    const env = settings.env || 'test';
    await assertEnvAllowed(user, env);
    const c = await cybsCreds(env);
    const amount = Math.round(Number(rawAmount) * 100) / 100;
    if (!(amount > 0)) throw new HttpError(400, 'Amount must be above zero.');
    await assertProdPayment(env, amount);
    const ii = (settings.cybsIi || '').trim();
    const saveCard = settings.saveCard || 'none';
    const order = {
      ref: (await freeRef(merchantRef)) || `CY-${shortId()}-${Math.floor(Date.now() / 1000)}`,
      env, route: 'cybs', operation: settings.operation === 'PreAuthorize' ? 'PreAuthorize' : 'Pay',
      amount, currency: settings.currency || 'AED', customer,
      options: { ...settings, cybs: { merchantId: c.merchantId, nonce: uuid(), savedIi: ii || null, savedExpiry: ii ? settings.cybsExpiry || null : null, txns: [] } },
      token_id: ii || null, created_by: user.user,
    };
    const { error } = await db().from('orders').insert(order);
    if (error) throw error;
    if (saveCard !== 'none' && !ii) {
      await db().from('tokens').insert({ env, route: 'cybs', usage: { cit: 'CIT', mit: 'MIT', citmit: 'CIT+MIT' }[saveCard], source: 'payment', order_ref: order.ref, created_by: user.user });
    }
    if (ii) return Response.json({ ref: order.ref, savedCard: true });
    const origin = req.headers.get('origin') || baseUrlFrom(req, await getConfig());
    const r = await captureContext(env, order.ref, origin, user);
    if (!r.ok || !r.json?.jwt) {
      await db().from('orders').update({ status: 'SessionFailed' }).eq('ref', order.ref);
      return Response.json({ error: 'CYBS capture context failed', ref: order.ref, insights: responseInsights({ status: r.status, res_body: r.json, error: r.error }) }, { status: 502 });
    }
    await db().from('orders').update({ status: 'SessionCreated' }).eq('ref', order.ref);
    return Response.json({ ref: order.ref, captureContext: r.json.jwt });
  } catch (e) {
    return errorResponse(e);
  }
}
