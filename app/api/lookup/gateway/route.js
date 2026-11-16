// View-only lookup straight on the gateway: an MPGS order by order ID (for PGW orders, MPGS order ID = Geidea orderId)
// or a CYBS transaction by ID. Nothing is imported, so no capture/void/refund from here: actions on PGW orders must go
// through PGW. The call is logged under LOOKUP-<gateway>-<id> for the inspector.
import { requireUser, assertEnvAllowed, errorResponse, HttpError } from '@/lib/auth';
import { retrieveOrder } from '@/lib/mpgs';
import { getTransaction } from '@/lib/cybs';
import { responseInsights } from '@/lib/insights';
import { getOrderRow } from '@/lib/orders';

export async function POST(req) {
  try {
    const user = requireUser();
    const { env: envIn = 'production', gateway, id: raw, orderRef } = await req.json();
    // R23: from a Geidea order's page — look its PGW order up on MPGS (MPGS order ID = Geidea orderId) and log the
    // call under that order, so it shows in the order's request inspector
    const row = orderRef ? await getOrderRow(orderRef) : null;
    const env = row?.env || envIn;
    await assertEnvAllowed(user, env);
    const id = String(raw || row?.geidea_order_id || '').trim();
    if (!id) throw new HttpError(400, 'Enter an ID.');
    const ref = row && gateway !== 'cybs' ? row.ref : `LOOKUP-${gateway === 'cybs' ? 'CYBS' : 'MPGS'}-${id}`.slice(0, 120);
    const r = gateway === 'cybs' ? await getTransaction(env, id, ref, user) : await retrieveOrder(env, ref, user, id);
    return Response.json({ ok: r.ok, status: r.status, body: r.json, error: r.error, insights: responseInsights({ status: r.status, res_body: r.json, error: r.error }) });
  } catch (e) {
    return errorResponse(e);
  }
}
