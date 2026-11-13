// redirectResponseUrl for MPGS 3DS. MPGS posts the authentication result here from the payer's browser (often from
// the challenge iframe, cross-site, so no session cookie). We log the posted fields and send the top window to
// /mpgs/complete, which runs the payment with the user's session. The per-order nonce stops strangers writing logs.
import { db } from '@/lib/db';
import { logBrowser } from '@/lib/orders';
import { patchMpgs } from '@/lib/mpgs';

async function handle(req) {
  const url = new URL(req.url);
  const ref = url.searchParams.get('ref') || '';
  const n = url.searchParams.get('n') || '';
  let fields = Object.fromEntries([...url.searchParams].filter(([k]) => k !== 'ref' && k !== 'n'));
  if (req.method === 'POST') {
    try { const fd = await req.formData(); for (const [k, v] of fd.entries()) fields[k] = String(v); } catch {}
  }
  const { data: row } = await db().from('orders').select('ref,options').eq('ref', ref).maybeSingle();
  if (row && row.options?.mpgs?.nonce === n) {
    await logBrowser(ref, 'MPGS 3DS → redirectResponseUrl', fields, { user: 'browser' }, 'MPGS → /api/mpgs/3ds-return (browser POST)');
    await patchMpgs(ref, { authResult: { recommendation: fields['response.gatewayRecommendation'] || null, result: fields.result || null, source: 'redirect', fields } });
  }
  const target = `/mpgs/complete?ref=${encodeURIComponent(ref)}`;
  const html = `<!doctype html><meta charset="utf-8"><title>Returning…</title><body style="font-family:system-ui;padding:24px">Authentication finished. Returning to the shop… <a href="${target}" target="_top">continue</a><script>try{window.top.location.replace(${JSON.stringify(target)})}catch(e){location.replace(${JSON.stringify(target)})}</script></body>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
export const POST = handle;
export const GET = handle;
