import { requireUser, assertEnvAllowed, errorResponse, HttpError } from '@/lib/auth';
import { getConfig, baseUrlFrom } from '@/lib/config';
import { getOrderRow, refreshFromGeidea } from '@/lib/orders';
import { capture, voidOrder, refund } from '@/lib/geidea';
import { responseInsights } from '@/lib/insights';
import * as mpgs from '@/lib/mpgs';

// Direct MPGS orders: no PGW order exists, so act on the MPGS order (order ID = our reference).
async function mpgsAction(row, type, amount, user) {
  const refresh = async () => { const o = await mpgs.retrieveOrder(row.env, row.ref, user); if (o.json?.id) await mpgs.syncMpgsOrder(row.ref, o.json); return o; };
  if (type === 'fetch') {
    const o = await refresh();
    return { ok: o.ok, summary: `Fetched from MPGS: ${o.json?.status || o.json?.error?.explanation || `HTTP ${o.status}`}` };
  }
  const txns = Array.isArray(row.last_order?.transaction) ? row.last_order.transaction : [];
  let r;
  if (type === 'capture') r = await mpgs.capture(row.env, row.ref, mpgs.nextTxnId(row, 'CAP'), amount, row.currency, user);
  else if (type === 'refund') r = await mpgs.refund(row.env, row.ref, mpgs.nextTxnId(row, 'REF'), amount, row.currency, user);
  else if (type === 'void') {
    // Void the latest approved financial transaction (authorization, capture, pay or refund)
    const target = [...txns].reverse().find((t) => ['AUTHORIZATION', 'CAPTURE', 'PAYMENT', 'REFUND'].includes(t.transaction?.type) && t.result === 'SUCCESS');
    const id = target?.transaction?.id || row.options?.mpgs?.payTxnId;
    if (!id) throw new HttpError(400, 'No MPGS transaction to void. Fetch the order first.');
    r = await mpgs.voidTxn(row.env, row.ref, mpgs.nextTxnId(row, 'VOID'), id, user);
  } else throw new HttpError(400, 'Unknown action');
  await refresh();
  const gc = r.json?.response?.gatewayCode || r.json?.error?.explanation;
  return { ok: r.ok, summary: `${type[0].toUpperCase() + type.slice(1)}: ${gc || (r.ok ? 'done' : `HTTP ${r.status}`)}` };
}

export async function POST(req, { params }) {
  try {
    const user = requireUser();
    const row = await getOrderRow(decodeURIComponent(params.ref));
    if (!row) throw new HttpError(404, 'Order not found');
    await assertEnvAllowed(user, row.env);
    const { type, amount } = await req.json();
    if (row.route === 'mpgs') return Response.json(await mpgsAction(row, type, amount, user));
    const baseUrl = baseUrlFrom(req, await getConfig());

    let current = row;
    if (!current.geidea_order_id) current = (await refreshFromGeidea(current, user)).row;
    if (type === 'fetch') {
      const { r } = await refreshFromGeidea(current, user);
      const head = responseInsights({ status: r.status, res_body: r.json, error: r.error })[0];
      return Response.json({ ok: r.ok, summary: `Fetched: ${head?.value || r.status}` });
    }
    if (!current.geidea_order_id) throw new HttpError(400, 'Geidea has no order for this reference yet.');
    let r;
    if (type === 'capture') r = await capture(row.env, current.geidea_order_id, amount, baseUrl, row.ref, user);
    else if (type === 'void') r = await voidOrder(row.env, current.geidea_order_id, baseUrl, row.ref, user);
    else if (type === 'refund') r = await refund(row.env, current.geidea_order_id, amount, baseUrl, row.ref, user);
    else throw new HttpError(400, 'Unknown action');
    const head = responseInsights({ status: r.status, res_body: r.json, error: r.error }).find((x) => x.key === 'code' || x.key === 'decline' || x.key === 'outcome') || {};
    await refreshFromGeidea({ ...row, geidea_order_id: current.geidea_order_id }, user);
    return Response.json({ ok: r.ok, summary: `${type[0].toUpperCase() + type.slice(1)}: ${head.value || (r.ok ? 'done' : `HTTP ${r.status}`)}` });
  } catch (e) {
    return errorResponse(e);
  }
}
