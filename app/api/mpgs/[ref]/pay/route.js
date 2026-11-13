// MPGS direct, final step: PAY or AUTHORIZE with the Hosted Session (or saved MPGS token + CVV session),
// linking the 3DS transaction when authentication ran. Then tokenize the card if Save card was set, and retrieve the order.
import { requireUser, assertEnvAllowed, errorResponse, HttpError } from '@/lib/auth';
import { db } from '@/lib/db';
import { getOrderRow } from '@/lib/orders';
import { payOrAuthorize, tokenizeSession, retrieveOrder, syncMpgsOrder, patchMpgs, cardFromMpgs } from '@/lib/mpgs';
import { responseInsights } from '@/lib/insights';



export async function POST(req, { params }) {
  try {
    const user = requireUser();
    const row = await getOrderRow(decodeURIComponent(params.ref));
    if (!row || row.route !== 'mpgs') throw new HttpError(404, 'MPGS order not found');
    await assertEnvAllowed(user, row.env);
    const { withoutAuth } = await req.json().catch(() => ({}));
    const m = row.options?.mpgs || {};
    if (m.payTxnId) throw new HttpError(409, `Payment already sent (${m.payTxnId}). Open the order to see the result.`);

    const s = row.options || {};
    const threeDs = s.auth === '3ds' && !withoutAuth;
    const rec = m.authResult?.recommendation;
    if (threeDs && (!m.authTxnId || rec !== 'PROCEED')) throw new HttpError(400, `3DS did not return PROCEED (${rec || m.initiate?.recommendation || 'no result'}). Use "Pay without 3DS" to send it anyway for testing.`);
    const savedToken = m.savedToken || null;
    const saving = !savedToken && s.saveCard && s.saveCard !== 'none';
    const txnId = `${row.operation === 'PreAuthorize' ? 'AUTH' : 'PAY'}-1`;
    await patchMpgs(row.ref, { payTxnId: txnId });

    const r = await payOrAuthorize({
      env: row.env, order: row, txnId, user,
      operation: row.operation === 'PreAuthorize' ? 'AUTHORIZE' : 'PAY',
      sessionId: m.sessionId, token: savedToken || undefined,
      authTxnId: threeDs ? m.authTxnId : undefined,
      source: s.auth === 'moto' ? 'MOTO' : 'INTERNET',
      storedOnFile: savedToken ? 'STORED' : saving ? 'TO_BE_STORED' : undefined,
      agreement: row.agreement_id ? { id: row.agreement_id, type: String(row.agreement_type || 'Unscheduled').toUpperCase() } : undefined,
    });

    // Save card: tokenize the session's card after an approved payment
    let tok = null;
    if (saving) {
      const approved = r.ok && r.json?.response?.gatewayCode === 'APPROVED';
      if (approved) {
        tok = await tokenizeSession(row.env, m.sessionId, row.ref, user, s.mpgsTokenValue === 'mpgs' ? 'mpgs' : 'geidea');
        const value = tok.json?.token;
        await db().from('tokens').update(value ? { token_id: value, status: 'ACTIVE', card: cardFromMpgs(tok.json), scheme: tok.json?.schemeToken ? { ...tok.json.schemeToken, repositoryId: tok.json.repositoryId, status: tok.json.status, value, found: true } : null, checked_at: new Date().toISOString(), note: null } : { status: 'FAILED', note: `MPGS token not created: ${tok.json?.error?.explanation || tok.error || 'no token in response'}` }).eq('order_ref', row.ref);
        if (value) await db().from('orders').update({ token_id: value }).eq('ref', row.ref);
      } else {
        await db().from('tokens').update({ status: 'FAILED', note: 'Payment not approved, so the card was not tokenized.' }).eq('order_ref', row.ref);
      }
    }
    if (savedToken && r.ok) await db().from('tokens').update({ last_used_at: new Date().toISOString(), last_used_ref: row.ref }).eq('token_id', savedToken);

    const o = await retrieveOrder(row.env, row.ref, user);
    if (o.json?.id) await syncMpgsOrder(row.ref, o.json);
    else await db().from('orders').update({ status: r.ok ? 'Success' : 'Failed', detailed_status: r.json?.order?.status || r.json?.response?.gatewayCode || 'Failed', last_order: r.json }).eq('ref', row.ref);
    return Response.json({ ok: r.ok, insights: responseInsights({ status: r.status, res_body: r.json, error: r.error }), token: tok?.json?.token || null });
  } catch (e) {
    return errorResponse(e);
  }
}
