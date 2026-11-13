// Geidea server-to-server callback. Answers 200 straight away, drops duplicates, keeps the order in sync.
import crypto from 'crypto';
import { db } from '@/lib/db';
import { extractOrder, syncOrder } from '@/lib/geidea';

export async function GET() {
  return new Response('ok', { status: 200 });
}

export async function POST(req) {
  let payload = null;
  try {
    const text = await req.text();
    try { payload = JSON.parse(text); } catch { payload = { raw: text.slice(0, 20000) }; }
    const order = extractOrder(payload);
    const ref = order?.merchantReferenceId || payload?.merchantReferenceId || null;
    const fingerprint = JSON.stringify([order?.orderId, order?.status, order?.detailedStatus, order?.transactions?.length, order?.totalCapturedAmount, order?.totalRefundedAmount, order?.tokenId]);
    const dedupe = crypto.createHash('sha256').update(order ? fingerprint : JSON.stringify(payload)).digest('hex');

    const { data: existing } = await db().from('callbacks').select('id,duplicate_count').eq('dedupe_key', dedupe).maybeSingle();
    if (existing) {
      await db().from('callbacks').update({ duplicate_count: existing.duplicate_count + 1, last_seen_at: new Date().toISOString() }).eq('id', existing.id);
    } else {
      await db().from('callbacks').insert({ order_ref: ref, geidea_order_id: order?.orderId || null, status: order ? `${order.status}/${order.detailedStatus}` : 'unparsed', amount: order?.amount ?? null, currency: order?.currency || null, payload, dedupe_key: dedupe });
      if (ref && order) await syncOrder(ref, order);
    }
  } catch (e) {
    console.error('callback handling failed', e);
  }
  // Always 200 so Geidea does not keep retrying
  return Response.json({ received: true });
}
