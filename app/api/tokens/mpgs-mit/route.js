// MIT on a card saved through MPGS direct: PAY/AUTHORIZE with the MPGS token, transaction.source MERCHANT,
// storedOnFile STORED, same agreement.id, no CVV (POC run 2 rules for MID 20100000101).
import { requireUser, assertEnvAllowed, errorResponse, HttpError } from '@/lib/auth';
import { db } from '@/lib/db';
import { payOrAuthorize, retrieveOrder, syncMpgsOrder, mpgsCreds } from '@/lib/mpgs';
import { responseInsights } from '@/lib/insights';
import { shortId } from '@/lib/crypto';

export async function POST(req) {
  try {
    const user = requireUser();
    const { env = 'test', token, agreementId, agreementType = 'Unscheduled', amount, currency = 'AED', operation = 'Pay' } = await req.json();
    await assertEnvAllowed(user, env);
    if (!token || !agreementId) throw new HttpError(400, 'MPGS token and agreement ID are both needed for an MIT.');
    if (!(Number(amount) > 0)) throw new HttpError(400, 'Amount must be above zero.');
    const c = await mpgsCreds(env);
    const order = { ref: `MPMIT-${shortId()}-${Math.floor(Date.now() / 1000)}`, env, route: 'mpgs', operation: operation === 'PreAuthorize' ? 'PreAuthorize' : 'Pay', amount: Math.round(Number(amount) * 100) / 100, currency, token_id: token, agreement_id: agreementId, agreement_type: agreementType, options: { mit: true, auth: 'none', mpgs: { merchantId: c.merchantId, version: c.version, savedToken: token, payTxnId: `${operation === 'PreAuthorize' ? 'AUTH' : 'PAY'}-1` } }, created_by: user.user };
    await db().from('orders').insert(order);
    const r = await payOrAuthorize({ env, order, txnId: order.options.mpgs.payTxnId, operation: order.operation === 'PreAuthorize' ? 'AUTHORIZE' : 'PAY', token, source: 'MERCHANT', storedOnFile: 'STORED', agreement: { id: agreementId, type: String(agreementType).toUpperCase() }, user });
    const o = await retrieveOrder(env, order.ref, user);
    if (o.json?.id) await syncMpgsOrder(order.ref, o.json);
    else await db().from('orders').update({ status: 'Failed', detailed_status: r.json?.response?.gatewayCode || 'Failed', last_order: r.json }).eq('ref', order.ref);
    if (r.ok) await db().from('tokens').update({ last_used_at: new Date().toISOString(), last_used_ref: order.ref }).eq('token_id', token);
    return Response.json({ ref: order.ref, ok: r.ok, insights: responseInsights({ status: r.status, res_body: r.json, error: r.error }) });
  } catch (e) {
    return errorResponse(e);
  }
}
