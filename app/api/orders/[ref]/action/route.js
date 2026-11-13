import { requireUser, assertEnvAllowed, errorResponse, HttpError } from '@/lib/auth';
import { getConfig, baseUrlFrom } from '@/lib/config';
import { getOrderRow, refreshFromGeidea } from '@/lib/orders';
import { capture, voidOrder, refund } from '@/lib/geidea';
import { responseInsights } from '@/lib/insights';

export async function POST(req, { params }) {
  try {
    const user = requireUser();
    const row = await getOrderRow(decodeURIComponent(params.ref));
    if (!row) throw new HttpError(404, 'Order not found');
    await assertEnvAllowed(user, row.env);
    const { type, amount } = await req.json();
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
