import { db } from './db';
import { fetchOrder, fetchOrderByRef, extractOrder, syncOrder } from './geidea';

export async function getOrderRow(ref) {
  const { data } = await db().from('orders').select('*').eq('ref', ref).maybeSingle();
  return data;
}

// Pull the latest order from Geidea and store it. Uses the Geidea orderId when known.
export async function refreshFromGeidea(row, user) {
  const r = row.geidea_order_id ? await fetchOrder(row.env, row.geidea_order_id, row.ref, user) : await fetchOrderByRef(row.env, row.ref, user);
  const order = extractOrder(r.json);
  const updated = order ? await syncOrder(row.ref, order) : null;
  return { r, order, row: updated || row };
}

export async function logsFor(ref) {
  const { data } = await db().from('api_logs').select('*').eq('order_ref', ref).order('created_at', { ascending: false });
  return data || [];
}
