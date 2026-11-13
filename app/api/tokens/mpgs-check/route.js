// Look a saved card up in the MPGS token repository. MPGS-route cards use their MPGS token; Geidea-route cards use the
// value PGW gives MPGS (Geidea tokenId without dashes, upper case). schemeToken.provider (MDES / VTS) means a network
// token exists behind the gateway token; on v80 MPGS shows the provider only, no status.
import { requireUser, assertEnvAllowed, errorResponse, HttpError } from '@/lib/auth';
import { db } from '@/lib/db';
import { getToken, pgwTokenValue, cardFromMpgs } from '@/lib/mpgs';
import { getInstrumentIdentifier } from '@/lib/cybs';
import { responseInsights } from '@/lib/insights';

export async function POST(req) {
  try {
    const user = requireUser();
    const { id } = await req.json();
    const { data: t } = await db().from('tokens').select('*').eq('id', Number(id)).maybeSingle();
    if (!t?.token_id) throw new HttpError(404, 'Saved card has no token yet.');
    await assertEnvAllowed(user, t.env);
    if (t.route === 'cybs') {
      // TMS instrument identifier: tokenizedCard holds the network token (state ACTIVE / SUSPENDED / DELETED / UNPROVISIONED)
      const r = await getInstrumentIdentifier(t.env, t.token_id, t.order_ref, user);
      const tc = r.json?.tokenizedCard;
      const scheme = r.ok ? { found: true, value: t.token_id, provider: tc?.type ? ({ visa: 'VTS', mastercard: 'MDES' }[String(tc.type).toLowerCase()] || tc.type) : null, status: tc?.state || null, number: tc?.number || null, expiry: tc?.expirationMonth ? `${tc.expirationMonth}/${tc.expirationYear}` : null, repositoryId: 'CYBS TMS', iiState: r.json?.state } : { found: false, value: t.token_id, error: r.json?.errorInformation?.message || r.json?.message || r.error || `HTTP ${r.status}` };
      await db().from('tokens').update({ scheme, checked_at: new Date().toISOString() }).eq('id', t.id);
      return Response.json({ ok: r.ok, scheme, insights: responseInsights({ status: r.status, res_body: r.json, error: r.error }) });
    }
    const value = t.route === 'mpgs' ? t.token_id : pgwTokenValue(t.token_id);
    const r = await getToken(t.env, value, t.order_ref, user);
    const found = r.ok && r.json?.token;
    const scheme = found ? { ...(r.json.schemeToken || {}), repositoryId: r.json.repositoryId, status: r.json.status, value, found: true } : { found: false, value, error: r.json?.error?.explanation || r.error || `HTTP ${r.status}` };
    const patch = { scheme, checked_at: new Date().toISOString() };
    if (found && !t.card?.masked) patch.card = cardFromMpgs(r.json);
    await db().from('tokens').update(patch).eq('id', t.id);
    return Response.json({ ok: !!found, scheme, insights: responseInsights({ status: r.status, res_body: r.json, error: r.error }) });
  } catch (e) {
    return errorResponse(e);
  }
}
