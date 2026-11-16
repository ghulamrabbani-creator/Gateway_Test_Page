// MPGS direct, step 1: create our order row and an MPGS Hosted Session. The browser then loads session.js,
// collects the card in MPGS-hosted iframes and updates the session; the card never touches this server.
import { assertProdPayment } from '@/lib/guard';
import { cleanAgreement } from '@/lib/refs';
import { freeRef } from '@/lib/orders';
import { requireUser, assertEnvAllowed, errorResponse, HttpError, assertTokenUse } from '@/lib/auth';
import { db } from '@/lib/db';
import { mpgsCreds, createSession, sessionJsUrl } from '@/lib/mpgs';
import { responseInsights } from '@/lib/insights';
import { shortId, uuid } from '@/lib/crypto';

export async function POST(req) {
  try {
    const user = requireUser();
    const { settings = {}, customer = {}, amount: rawAmount, merchantRef, agreementId } = await req.json();
    const env = settings.env || 'test';
    await assertEnvAllowed(user, env);
    const c = await mpgsCreds(env);
    const amount = Math.round(Number(rawAmount) * 100) / 100;
    if (!(amount > 0)) throw new HttpError(400, 'Amount must be above zero.');
    await assertProdPayment(env, amount);

    const saveCard = settings.saveCard || 'none';
    const withAgreement = saveCard === 'mit' || saveCard === 'citmit';
    const savedToken = (settings.mpgsToken || '').trim();
    await assertTokenUse(user, savedToken);
    const order = {
      ref: (await freeRef(merchantRef)) || `MP-${shortId()}-${Math.floor(Date.now() / 1000)}`,
      env, route: 'mpgs',
      operation: settings.operation === 'PreAuthorize' ? 'PreAuthorize' : 'Pay',
      amount, currency: settings.currency || 'AED', customer,
      options: { ...settings, mpgs: { merchantId: c.merchantId, version: c.version, nonce: uuid(), savedToken: savedToken || null, agreementId: null } },
      token_id: savedToken || null,
      // Repeat CIT on a saved token carries no agreement: MPGS requires transaction.source MERCHANT on any later payment
      // with the same agreement.id (MP-9E43BD60 / MP-035D7E7F, 14-Nov). The agreement belongs to the first CIT and the MITs.
      agreement_id: withAgreement && !savedToken ? cleanAgreement(agreementId) || `AGR-${shortId()}-${Date.now().toString(36)}` : null,
      agreement_type: withAgreement && !savedToken ? settings.agreementType || 'Unscheduled' : null,
      created_by: user.user,
    };
    const { error } = await db().from('orders').insert(order);
    if (error) throw error;
    if (saveCard !== 'none' && !savedToken) {
      await db().from('tokens').insert({ env, route: 'mpgs', usage: { cit: 'CIT', mit: 'MIT', citmit: 'CIT+MIT' }[saveCard], agreement_id: order.agreement_id, agreement_type: order.agreement_type, source: 'payment', order_ref: order.ref, created_by: user.user });
    }
    const r = await createSession(env, order.ref, user);
    const sessionId = r.json?.session?.id;
    if (!r.ok || !sessionId) {
      await db().from('orders').update({ status: 'SessionFailed' }).eq('ref', order.ref);
      return Response.json({ error: 'MPGS Create Session failed', ref: order.ref, insights: responseInsights({ status: r.status, res_body: r.json, error: r.error }) }, { status: 502 });
    }
    order.options.mpgs.sessionId = sessionId;
    await db().from('orders').update({ session_id: sessionId, status: 'SessionCreated', options: order.options }).eq('ref', order.ref);
    return Response.json({ ref: order.ref, sessionId, sessionJs: sessionJsUrl(c), cvvOnly: !!savedToken });
  } catch (e) {
    return errorResponse(e);
  }
}
