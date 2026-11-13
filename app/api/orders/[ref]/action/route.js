import { requireUser, assertEnvAllowed, errorResponse, HttpError } from '@/lib/auth';
import { getConfig, baseUrlFrom } from '@/lib/config';
import { getOrderRow, refreshFromGeidea } from '@/lib/orders';
import { capture, voidOrder, refund } from '@/lib/geidea';
import { responseInsights } from '@/lib/insights';
import * as mpgs from '@/lib/mpgs';
import * as cybs from '@/lib/cybs';

// Direct CYBS orders: act on the CYBS payment (our ledger of CYBS transaction IDs lives in options.cybs.txns).
async function cybsAction(row, type, amount, user) {
  const cy = row.options?.cybs || {};
  const txns = cy.txns || [];
  const okT = (t) => t.id && !['DECLINED', 'INVALID_REQUEST', 'ERROR', 'SERVER_ERROR', 'PENDING_AUTHENTICATION', 'AUTHORIZED_RISK_DECLINED'].includes(t.status);
  const pay = txns.find((t) => (t.kind === 'sale' || t.kind === 'auth') && okT(t));
  if (type === 'fetch') {
    if (!pay) throw new HttpError(400, 'No authorized CYBS payment on this order.');
    const r = await cybs.getTransaction(row.env, pay.id, row.ref, user);
    return { ok: r.ok, summary: `Fetched from CYBS: ${r.json?.applicationInformation?.status || r.json?.applicationInformation?.reasonCode || `HTTP ${r.status}`}` };
  }
  if (!pay) throw new HttpError(400, 'No authorized CYBS payment on this order.');
  let r, kind;
  if (type === 'capture') { kind = 'capture'; r = await cybs.capturePayment(row.env, row.ref, pay.id, amount, row.currency, user); }
  else if (type === 'refund') {
    kind = 'refund';
    const cap = [...txns].reverse().find((t) => t.kind === 'capture' && okT(t));
    r = pay.kind === 'sale' ? await cybs.refundTxn(row.env, row.ref, 'payment', pay.id, amount, row.currency, user) : cap ? await cybs.refundTxn(row.env, row.ref, 'capture', cap.id, amount, row.currency, user) : null;
    if (!r) throw new HttpError(400, 'Nothing captured to refund.');
  } else if (type === 'void') {
    const last = [...txns].reverse().find((t) => ['capture', 'refund', 'sale'].includes(t.kind) && okT(t));
    if (pay.kind === 'auth' && (!last || last.kind === 'sale')) { kind = 'reversal'; r = await cybs.reverseAuth(row.env, row.ref, pay.id, row.amount, user); }
    else { kind = 'void'; r = await cybs.voidTxn(row.env, row.ref, last.kind === 'capture' ? 'captures' : last.kind === 'refund' ? 'refunds' : 'payments', last.id, user); }
  } else throw new HttpError(400, 'Unknown action');
  await cybs.recordTxn(row.ref, kind, r, type === 'void' ? null : amount);
  return { ok: r.ok, summary: `${type[0].toUpperCase() + type.slice(1)}: ${r.json?.status || r.json?.errorInformation?.message || (r.ok ? 'done' : `HTTP ${r.status}`)}` };
}

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
    if (row.route === 'cybs') return Response.json(await cybsAction(row, type, amount, user));
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
