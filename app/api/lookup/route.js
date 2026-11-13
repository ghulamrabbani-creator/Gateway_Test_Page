import { requireUser, assertEnvAllowed, errorResponse, HttpError } from '@/lib/auth';
import { db } from '@/lib/db';
import { fetchOrder, extractOrder } from '@/lib/geidea';
import { responseInsights } from '@/lib/insights';

// Look up any Geidea order on this environment's MID (e.g. one made through BESO) and bring it
// into the shop's order page so it can be inspected, captured, voided or refunded.
export async function POST(req) {
  try {
    const user = requireUser();
    const { env = 'production', orderId } = await req.json();
    await assertEnvAllowed(user, env);
    const id = String(orderId || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Enter a Geidea order ID (UUID, e.g. 1c65a2c8-12c4-4098-f3cd-08df31653829).');

    // Existing row for this Geidea order?
    const { data: existing } = await db().from('orders').select('ref').eq('geidea_order_id', id).maybeSingle();
    const tempRef = existing?.ref || `LOOKUP-${id}`;
    const r = await fetchOrder(env, id, tempRef, user);
    const o = extractOrder(r.json);
    if (!o) return Response.json({ error: 'Geidea did not return an order', insights: responseInsights({ status: r.status, res_body: r.json, error: r.error }) }, { status: 404 });

    let ref = existing?.ref;
    if (!ref) {
      ref = o.merchantReferenceId || id;
      const { data: clash } = await db().from('orders').select('ref').eq('ref', ref).maybeSingle();
      if (clash) ref = `${ref}-${id.slice(0, 8)}`;
      const { error } = await db().from('orders').insert({
        ref, env, route: 'geidea', operation: o.paymentOperation || 'Pay', amount: o.amount ?? 0, currency: o.currency || 'AED',
        status: o.status, detailed_status: o.detailedStatus, geidea_order_id: id, session_id: o.sessionId,
        token_id: o.tokenId, agreement_id: o.agreementId, agreement_type: o.agreementType,
        captured: o.totalCapturedAmount ?? 0, refunded: o.totalRefundedAmount ?? 0, last_order: o,
        options: { external: true, importedFrom: o.callbackUrl || null }, created_by: user.user,
      });
      if (error) throw error;
      // re-point the fetch log at the new row
      await db().from('api_logs').update({ order_ref: ref }).eq('order_ref', tempRef);
    } else {
      await db().from('orders').update({ status: o.status, detailed_status: o.detailedStatus, captured: o.totalCapturedAmount ?? 0, refunded: o.totalRefundedAmount ?? 0, last_order: o, updated_at: new Date().toISOString() }).eq('ref', ref);
    }
    return Response.json({ ref });
  } catch (e) {
    return errorResponse(e);
  }
}
