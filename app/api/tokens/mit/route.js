import { assertProdPayment, assertConfirmed } from '@/lib/guard';
import { requireUser, assertEnvAllowed, errorResponse, HttpError } from '@/lib/auth';
import { getConfig, baseUrlFrom } from '@/lib/config';
import { db } from '@/lib/db';
import { mitCharge, extractOrder, syncOrder } from '@/lib/geidea';
import { responseInsights } from '@/lib/insights';
import { shortId } from '@/lib/crypto';

export async function POST(req) {
  try {
    const user = requireUser();
    const { env = 'test', tokenId, agreementId, agreementType = 'Unscheduled', amount, currency = 'AED', operation = 'Pay', confirmed } = await req.json();
    await assertEnvAllowed(user, env);
    if (!tokenId || !agreementId) throw new HttpError(400, 'Token ID and agreement ID are both needed for an MIT.');
    if (!(Number(amount) > 0)) throw new HttpError(400, 'Amount must be above zero.');
    assertConfirmed(env, confirmed, 'A merchant-initiated charge');
    await assertProdPayment(env, amount);
    const cfg = await getConfig();
    const order = { ref: `MIT-${shortId()}-${Math.floor(Date.now() / 1000)}`, env, operation: operation === 'PreAuthorize' ? 'PreAuthorize' : 'Pay', amount: Math.round(Number(amount) * 100) / 100, currency, token_id: tokenId, agreement_id: agreementId, agreement_type: agreementType, options: { mit: true, auth: 'none' }, created_by: user.user };
    await db().from('orders').insert(order);
    const { session, pay } = await mitCharge({ env, order, tokenId, agreementId, agreementType, baseUrl: baseUrlFrom(req, cfg), user });
    const last = pay || session;
    const o = extractOrder(last.json);
    if (o) await syncOrder(order.ref, o);
    else await db().from('orders').update({ status: 'Failed', detailed_status: pay ? 'PayFailed' : 'SessionFailed' }).eq('ref', order.ref);
    const ins = responseInsights({ status: last.status, res_body: last.json, error: last.error });
    return Response.json({ ref: order.ref, ok: last.ok, insights: ins });
  } catch (e) {
    return errorResponse(e);
  }
}
