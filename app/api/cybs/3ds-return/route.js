// returnUrl for CYBS payer authentication. Cardinal posts TransactionId (and MD) here after the challenge, from the
// step-up iframe (cross-site, no session cookie). We log it, keep the authentication transaction ID, and send the top
// window to /cybs/complete, which runs the validate + authorization with the user's session.
import { db } from '@/lib/db';
import { logBrowser } from '@/lib/orders';
import { patchCybs } from '@/lib/cybs';

async function handle(req) {
  const url = new URL(req.url);
  const ref = url.searchParams.get('ref') || '';
  const n = url.searchParams.get('n') || '';
  const fields = Object.fromEntries([...url.searchParams].filter(([k]) => k !== 'ref' && k !== 'n'));
  if (req.method === 'POST') { try { const fd = await req.formData(); for (const [k, v] of fd.entries()) fields[k] = String(v); } catch {} }
  const { data: row } = await db().from('orders').select('ref,options').eq('ref', ref).maybeSingle();
  if (row && row.options?.cybs?.nonce === n) {
    await logBrowser(ref, 'CYBS 3DS → returnUrl', fields, { user: 'browser' }, 'Cardinal → /api/cybs/3ds-return (browser POST)');
    const tid = fields.TransactionId || fields.transactionId;
    if (tid) await patchCybs(ref, { authTxnId: tid, challengeDone: true });
  }
  const target = `/cybs/complete?ref=${encodeURIComponent(ref)}`;
  const html = `<!doctype html><meta charset="utf-8"><title>Returning…</title><body style="font-family:system-ui;padding:24px">Authentication finished. Returning to the shop… <a href="${target}" target="_top">continue</a><script>try{window.top.location.replace(${JSON.stringify(target)})}catch(e){location.replace(${JSON.stringify(target)})}</script></body>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
export const POST = handle;
export const GET = handle;
