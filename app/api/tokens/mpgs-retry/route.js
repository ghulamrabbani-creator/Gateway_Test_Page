// Retry tokenizing a failed MPGS save-card from the order's Hosted Session (works while MPGS still holds the session).
import { requireUser, assertEnvAllowed, errorResponse, HttpError } from '@/lib/auth';
import { db } from '@/lib/db';
import { tokenizeSession, cardFromMpgs } from '@/lib/mpgs';
import { responseInsights } from '@/lib/insights';

export async function POST(req) {
  try {
    const user = requireUser();
    const { id } = await req.json();
    const { data: t } = await db().from('tokens').select('*').eq('id', Number(id)).maybeSingle();
    if (!t || t.route !== 'mpgs') throw new HttpError(404, 'MPGS saved card not found');
    await assertEnvAllowed(user, t.env);
    const { data: row } = await db().from('orders').select('ref,session_id,options').eq('ref', t.order_ref).maybeSingle();
    const sessionId = row?.options?.mpgs?.sessionId || row?.session_id;
    if (!sessionId) throw new HttpError(400, 'The order has no MPGS session to tokenize from.');
    const r = await tokenizeSession(t.env, sessionId, t.order_ref, user, row?.options?.mpgsTokenValue === 'mpgs' ? 'mpgs' : 'geidea');
    const value = r.json?.token;
    await db().from('tokens').update(value
      ? { token_id: value, status: 'ACTIVE', card: cardFromMpgs(r.json), scheme: r.json?.schemeToken ? { ...r.json.schemeToken, repositoryId: r.json.repositoryId, status: r.json.status, value, found: true } : null, checked_at: new Date().toISOString(), note: null }
      : { note: `MPGS token not created: ${r.json?.error?.explanation || r.error || 'no token in response'}` }).eq('id', t.id);
    if (value) await db().from('orders').update({ token_id: value }).eq('ref', t.order_ref);
    return Response.json({ ok: !!value, insights: responseInsights({ status: r.status, res_body: r.json, error: r.error }) });
  } catch (e) {
    return errorResponse(e);
  }
}
