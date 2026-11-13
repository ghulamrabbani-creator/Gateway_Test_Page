import { requireUser, assertEnvAllowed, errorResponse, HttpError } from '@/lib/auth';
import { db } from '@/lib/db';
import { getOrderRow, refreshFromGeidea, logBrowser } from '@/lib/orders';

function findTokenId(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (/^(tokenId|cardTokenId)$/i.test(k) && typeof v === 'string' && v.length > 10) return v;
    const inner = findTokenId(v, depth + 1);
    if (inner) return inner;
  }
  return null;
}

// Asks Geidea what happened to a card save, after the payment page closes or on demand.
export async function POST(req) {
  try {
    const user = requireUser();
    const { id, ref, outcome, data } = await req.json();
    const q = db().from('tokens').select('*');
    const { data: tok } = await (id ? q.eq('id', Number(id)) : q.eq('order_ref', ref)).maybeSingle();
    if (!tok) throw new HttpError(404, 'Saved card not found');
    await assertEnvAllowed(user, tok.env);
    const row = tok.order_ref ? await getOrderRow(tok.order_ref) : null;
    if (data !== undefined || outcome) await logBrowser(tok.order_ref, `Save card checkout → ${outcome || 'closed'}`, data ?? null, user, 'GeideaCheckout callback (browser)');

    if (outcome === 'cancel' && tok.status === 'PENDING') {
      await db().from('tokens').update({ status: 'CANCELLED', note: 'The card form was closed before the card was saved.' }).eq('id', tok.id);
    } else if (row) {
      const { order } = await refreshFromGeidea(row, user);
      const fromBrowser = findTokenId(data);
      const { data: now } = await db().from('tokens').select('*').eq('id', tok.id).single();
      if (now.status === 'PENDING') {
        if (fromBrowser) {
          await db().from('tokens').update({ token_id: fromBrowser, status: 'ACTIVE', note: 'Token taken from the checkout response.' }).eq('id', tok.id);
        } else if (!order) {
          await db().from('tokens').update({ note: 'Geidea has no result for this save yet. If the card form was completed, press Check status again in a minute; if it was closed, remove this card.' }).eq('id', tok.id);
        } else if (!order.tokenId) {
          await db().from('tokens').update({ status: order.status === 'Failed' ? 'FAILED' : 'PENDING', note: `Geidea order ${order.orderId} is ${order.detailedStatus || order.status} and carries no token.` }).eq('id', tok.id);
        }
      }
    }
    const { data: fresh } = await db().from('tokens').select('*').eq('id', tok.id).single();
    return Response.json({ token: fresh });
  } catch (e) {
    return errorResponse(e);
  }
}
