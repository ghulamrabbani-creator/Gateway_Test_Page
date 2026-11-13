// CYBS direct, the payment steps (one route, step in the body):
//  token    → keep the Microform transient token (encrypted, ~15 min life) and the expiry the customer typed
//  setup    → payer auth setup → device data collection URL + JWT for the browser
//  enrol    → payment with actionList CONSUMER_AUTHENTICATION: frictionless authorizes; otherwise PENDING_AUTHENTICATION + step-up
//  validate → after the challenge: payment with VALIDATE_CONSUMER_AUTHENTICATION + authenticationTransactionId
//  pay      → no 3DS (internet or MOTO)
import { requireUser, assertEnvAllowed, errorResponse, HttpError } from '@/lib/auth';
import { getConfig, baseUrlFrom } from '@/lib/config';
import { getOrderRow } from '@/lib/orders';
import { db } from '@/lib/db';
import { encrypt, decrypt } from '@/lib/crypto';
import { authSetup, payment, paymentInfo, patchCybs, recordTxn } from '@/lib/cybs';
import { clientIp } from '@/lib/mpgs';
import { responseInsights } from '@/lib/insights';

export async function POST(req, { params }) {
  try {
    const user = requireUser();
    const row = await getOrderRow(decodeURIComponent(params.ref));
    if (!row || row.route !== 'cybs') throw new HttpError(404, 'CYBS order not found');
    await assertEnvAllowed(user, row.env);
    const { step, transientToken, expiry, browser, referenceId } = await req.json();
    const s = row.options || {};
    const cy = s.cybs || {};

    if (step === 'token') {
      if (!transientToken) throw new HttpError(400, 'No transient token');
      await patchCybs(row.ref, { tt: encrypt(transientToken), expiry: expiry || null, ttAt: new Date().toISOString() });
      return Response.json({ ok: true });
    }

    const funds = cy.savedIi ? paymentInfo({ iiId: cy.savedIi, expiry: cy.savedExpiry }) : paymentInfo({ transientToken: cy.tt ? decrypt(cy.tt) : null });
    if (!cy.savedIi && !cy.tt) throw new HttpError(400, 'Card not captured yet.');
    if (cy.paymentId && step !== 'setup') throw new HttpError(409, 'Payment already authorized. Open the order to see it.');
    const saving = !cy.savedIi && s.saveCard && s.saveCard !== 'none';
    const cof = cy.savedIi ? { type: 'customer', storedCredentialUsed: true } : saving ? { type: 'customer', credentialStoredOnFile: true } : undefined;
    const kind = row.operation === 'PreAuthorize' ? 'auth' : 'sale';
    const common = { env: row.env, row, funds, capture: row.operation !== 'PreAuthorize', cof, saveCard: saving, customer: row.customer, user };

    if (step === 'setup') {
      const r = await authSetup(row.env, row, funds, user);
      const ca = r.json?.consumerAuthenticationInformation || {};
      return Response.json({ ok: r.ok, url: ca.deviceDataCollectionUrl, accessToken: ca.accessToken, referenceId: ca.referenceId, insights: responseInsights({ status: r.status, res_body: r.json, error: r.error }) });
    }

    let r;
    if (step === 'enrol') {
      const returnUrl = `${baseUrlFrom(req, await getConfig())}/api/cybs/3ds-return?ref=${encodeURIComponent(row.ref)}&n=${cy.nonce}`;
      r = await payment({ ...common, actions: ['CONSUMER_AUTHENTICATION'], auth: { referenceId, returnUrl }, browser, ip: clientIp(req), action: '3DS enrolment + authorization' });
    } else if (step === 'validate') {
      if (!cy.authTxnId) throw new HttpError(400, 'No authentication transaction ID from the challenge yet.');
      r = await payment({ ...common, actions: ['VALIDATE_CONSUMER_AUTHENTICATION'], auth: { authenticationTransactionId: cy.authTxnId }, action: '3DS validation + authorization' });
    } else if (step === 'pay') {
      r = await payment({ ...common, commerceIndicator: s.auth === 'moto' ? 'moto' : 'internet' });
    } else throw new HttpError(400, 'Unknown step');

    const updated = await recordTxn(row.ref, kind, r, row.amount);
    const ca = r.json?.consumerAuthenticationInformation || {};
    const challenge = r.json?.status === 'PENDING_AUTHENTICATION';
    if (challenge) await patchCybs(row.ref, { authTxnId: ca.authenticationTransactionId || null });
    if (!challenge) await afterPayment(row, r, cy, saving, user);
    return Response.json({ ok: r.ok, challenge, stepUpUrl: ca.stepUpUrl, accessToken: ca.accessToken, status: r.json?.status, detailed: updated?.detailed_status, insights: responseInsights({ status: r.status, res_body: r.json, error: r.error }) });
  } catch (e) {
    return errorResponse(e);
  }
}

// Save card result and saved-card usage
async function afterPayment(row, r, cy, saving, user) {
  const j = r.json || {};
  const approved = r.ok && ['AUTHORIZED', 'AUTHORIZED_PENDING_REVIEW'].includes(j.status);
  if (saving) {
    const ii = j.tokenInformation?.instrumentIdentifier?.id;
    const t = j.paymentInformation?.card?.type || j.paymentAccountInformation?.card?.type;
    const brand = { '001': 'VISA', '002': 'MASTERCARD', '003': 'AMEX' }[t] || t;
    const card = { brand, masked: j.paymentInformation?.card?.suffix ? `•••• ${j.paymentInformation.card.suffix}` : null, expiry: row.options?.cybs?.expiry || null };
    await db().from('tokens').update(approved && ii
      ? { token_id: ii, status: 'ACTIVE', card, agreement_id: j.processorInformation?.networkTransactionId || null, agreement_type: 'NTID', note: j.tokenInformation?.instrumentIdentifierNewlyCreated === false ? 'Instrument identifier already existed for this card (TMS reuses one per card number).' : null }
      : { status: 'FAILED', note: approved ? 'Approved, but no instrument identifier came back (TOKEN_CREATE not done?).' : 'Payment not approved, so no token was created.' }).eq('order_ref', row.ref);
    if (approved && ii) await db().from('orders').update({ token_id: ii, agreement_id: j.processorInformation?.networkTransactionId || null, agreement_type: 'NTID' }).eq('ref', row.ref);
  }
  if (cy.savedIi && approved) await db().from('tokens').update({ last_used_at: new Date().toISOString(), last_used_ref: row.ref }).eq('token_id', cy.savedIi);
}
