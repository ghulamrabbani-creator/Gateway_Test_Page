// MPGS direct, 3DS. step "initiate": INITIATE_AUTHENTICATION (returns the ACS method HTML for the browser to run).
// step "authenticate": AUTHENTICATE_PAYER (frictionless result, or challenge HTML that ends at /api/mpgs/3ds-return).
import { requireUser, assertEnvAllowed, errorResponse, HttpError } from '@/lib/auth';
import { getConfig, baseUrlFrom } from '@/lib/config';
import { getOrderRow } from '@/lib/orders';
import { initiateAuth, authenticatePayer, patchMpgs, clientIp } from '@/lib/mpgs';
import { responseInsights } from '@/lib/insights';

export async function POST(req, { params }) {
  try {
    const user = requireUser();
    const row = await getOrderRow(decodeURIComponent(params.ref));
    if (!row || row.route !== 'mpgs') throw new HttpError(404, 'MPGS order not found');
    await assertEnvAllowed(user, row.env);
    const { step, browser } = await req.json();
    const m = row.options?.mpgs || {};
    const token = m.savedToken || undefined;
    const agreement = row.agreement_id ? { id: row.agreement_id, type: String(row.agreement_type || 'Unscheduled').toUpperCase() } : undefined;

    if (step === 'initiate') {
      const authTxnId = `3DS-${Date.now().toString(36)}`;
      await patchMpgs(row.ref, { authTxnId, authResult: null });
      const r = await initiateAuth({ env: row.env, order: row, authTxnId, sessionId: m.sessionId, token, agreement, user });
      const rec = r.json?.response?.gatewayRecommendation;
      await patchMpgs(row.ref, { initiate: { result: r.json?.result, recommendation: rec, gatewayCode: r.json?.response?.gatewayCode, version: r.json?.authentication?.version } });
      return Response.json({ ok: r.ok, recommendation: rec, html: r.json?.authentication?.redirect?.html || '', methodSupported: r.json?.authentication?.['3ds2']?.methodSupported, insights: responseInsights({ status: r.status, res_body: r.json, error: r.error }) });
    }

    if (step === 'authenticate') {
      if (!m.authTxnId) throw new HttpError(400, 'Run initiate first.');
      const redirectResponseUrl = `${baseUrlFrom(req, await getConfig())}/api/mpgs/3ds-return?ref=${encodeURIComponent(row.ref)}&n=${m.nonce}`;
      const r = await authenticatePayer({ env: row.env, order: row, authTxnId: m.authTxnId, sessionId: m.sessionId, token, agreement, redirectResponseUrl, browser, ip: clientIp(req), user });
      const authStatus = r.json?.transaction?.authenticationStatus || r.json?.order?.authenticationStatus;
      const rec = r.json?.response?.gatewayRecommendation;
      const challenge = authStatus === 'AUTHENTICATION_PENDING';
      await patchMpgs(row.ref, { authResult: challenge ? null : { status: authStatus, recommendation: rec, source: 'frictionless' } });
      return Response.json({ ok: r.ok, challenge, authStatus, recommendation: rec, html: challenge ? r.json?.authentication?.redirect?.html || '' : '', insights: responseInsights({ status: r.status, res_body: r.json, error: r.error }) });
    }
    throw new HttpError(400, 'Unknown step');
  } catch (e) {
    return errorResponse(e);
  }
}
