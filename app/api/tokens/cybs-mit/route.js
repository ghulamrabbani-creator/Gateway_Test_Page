// MIT on a card saved through CYBS direct (TMS instrument identifier), per the 11-Nov POC:
// initiator merchant, credentialStoredOnFile false, storedCredentialUsed true, previousTransactionId = the CIT's NTID,
// no CVV; optional actionList DECISION_SKIP (Decision Manager rejected a test MIT on velocity).
import { assertProdPayment, assertConfirmed } from '@/lib/guard';
import { requireUser, assertEnvAllowed, errorResponse, HttpError } from '@/lib/auth';
import { db } from '@/lib/db';
import { cybsCreds, payment, paymentInfo, recordTxn } from '@/lib/cybs';
import { responseInsights } from '@/lib/insights';
import { shortId } from '@/lib/crypto';

export async function POST(req) {
  try {
    const user = requireUser();
    const { env = 'test', iiId, expiry, ntid, amount, currency = 'AED', operation = 'Pay', skipDm = true, confirmed } = await req.json();
    await assertEnvAllowed(user, env);
    if (!iiId || !ntid) throw new HttpError(400, 'Instrument identifier and the first CIT network transaction ID are both needed for an MIT.');
    if (!(Number(amount) > 0)) throw new HttpError(400, 'Amount must be above zero.');
    assertConfirmed(env, confirmed, 'A merchant-initiated charge');
    await assertProdPayment(env, amount);
    const c = await cybsCreds(env);
    const row = { ref: `CYMIT-${shortId()}-${Math.floor(Date.now() / 1000)}`, env, route: 'cybs', operation: operation === 'PreAuthorize' ? 'PreAuthorize' : 'Pay', amount: Math.round(Number(amount) * 100) / 100, currency, token_id: iiId, agreement_id: ntid, agreement_type: 'NTID', options: { mit: true, auth: 'none', cybs: { merchantId: c.merchantId, savedIi: iiId, savedExpiry: expiry || null, txns: [] } }, created_by: user.user };
    await db().from('orders').insert(row);
    const r = await payment({ env, row, funds: paymentInfo({ iiId, expiry }), capture: row.operation !== 'PreAuthorize', actions: skipDm ? ['DECISION_SKIP'] : [], cof: { type: 'merchant', credentialStoredOnFile: false, storedCredentialUsed: true, merchantInitiatedTransaction: { previousTransactionId: ntid } }, user, action: 'MIT' });
    await recordTxn(row.ref, row.operation === 'PreAuthorize' ? 'auth' : 'sale', r, row.amount);
    if (r.ok) await db().from('tokens').update({ last_used_at: new Date().toISOString(), last_used_ref: row.ref }).eq('token_id', iiId);
    return Response.json({ ref: row.ref, ok: r.ok, insights: responseInsights({ status: r.status, res_body: r.json, error: r.error }) });
  } catch (e) {
    return errorResponse(e);
  }
}
