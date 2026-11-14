import { db } from './db';
import { fetchOrder, fetchOrderByRef, extractOrder, syncOrder } from './geidea';

export async function getOrderRow(ref) {
  const { data } = await db().from('orders').select('*').eq('ref', ref).maybeSingle();
  return data;
}

// Pull the latest order from Geidea and store it. Uses the Geidea orderId when known.
// Fetch by MerchantReferenceId returns a summary only (no transactions, no paymentMethod),
// so when we only know the reference we look it up first and then fetch the full order by ID.
export async function refreshFromGeidea(row, user) {
  let r = row.geidea_order_id ? await fetchOrder(row.env, row.geidea_order_id, row.ref, user) : await fetchOrderByRef(row.env, row.ref, user);
  let order = extractOrder(r.json);
  if (!row.geidea_order_id && order?.orderId) {
    const full = await fetchOrder(row.env, order.orderId, row.ref, user);
    const fo = extractOrder(full.json);
    if (fo) { r = full; order = fo; }
  }
  const updated = order ? await syncOrder(row.ref, order) : null;
  return { r, order, row: updated || row };
}

export async function logsFor(ref) {
  const { data } = await db().from('api_logs').select('*').eq('order_ref', ref).order('created_at', { ascending: false });
  return data || [];
}

// What Geidea hands back through the browser (SDK callback data or return-URL parameters).
// Shown in the request inspector next to the server-side calls.
export async function logBrowser(ref, action, payload, user, url) {
  const { error } = await db().from('api_logs').insert({
    order_ref: ref, action, method: 'BROWSER', url: url || 'Geidea checkout → shop (browser)', req_headers: null, req_body: null,
    status: 200, res_body: payload ?? null, duration_ms: 0, created_by: user?.user || 'browser',
  });
  if (error) console.error('logBrowser failed', error);
}

// A typed merchant reference must be new: it is our order key, Geidea's merchantReferenceId and the MPGS order ID.
export async function freeRef(v) {
  const { cleanRef } = await import('./refs');
  const { HttpError } = await import('./auth');
  const ref = cleanRef(v);
  if (!ref) return null;
  const { data } = await db().from('orders').select('ref').eq('ref', ref).maybeSingle();
  if (data) throw new HttpError(409, `Merchant reference ${ref} is already used by another order. Generate a new one.`);
  return ref;
}
