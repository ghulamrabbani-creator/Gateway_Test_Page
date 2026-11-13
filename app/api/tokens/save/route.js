import { requireUser, assertEnvAllowed, errorResponse } from '@/lib/auth';
import { getConfig, baseUrlFrom } from '@/lib/config';
import { db } from '@/lib/db';
import { saveCardSession } from '@/lib/geidea';
import { responseInsights } from '@/lib/insights';
import { shortId } from '@/lib/crypto';

// Stand-alone tokenization (no payment): reference §3 #4, POST /payment-intent/api/v1/direct/session/saveCard
export async function POST(req) {
  try {
    const user = requireUser();
    const { env = 'test', currency = 'AED', usage = 'CIT' } = await req.json();
    await assertEnvAllowed(user, env);
    const cfg = await getConfig();
    const ref = `SC-${shortId()}-${Math.floor(Date.now() / 1000)}`;
    await db().from('orders').insert({ ref, env, operation: 'SaveCard', amount: 0, currency, options: { saveCard: usage.toLowerCase().replace('+', ''), standalone: true }, created_by: user.user });
    await db().from('tokens').insert({ env, usage, source: 'standalone', order_ref: ref, created_by: user.user });
    const r = await saveCardSession({ env, ref, currency, baseUrl: baseUrlFrom(req, cfg), user });
    const sessionId = r.json?.session?.id;
    if (!r.ok || !sessionId) {
      await db().from('tokens').update({ status: 'FAILED' }).eq('order_ref', ref);
      return Response.json({ error: 'Save card session failed', ref, insights: responseInsights({ status: r.status, res_body: r.json, error: r.error }) }, { status: 502 });
    }
    await db().from('orders').update({ session_id: sessionId, status: 'SessionCreated' }).eq('ref', ref);
    return Response.json({ ref, sessionId, sdkUrl: cfg.envs[env].sdkUrl });
  } catch (e) {
    return errorResponse(e);
  }
}
