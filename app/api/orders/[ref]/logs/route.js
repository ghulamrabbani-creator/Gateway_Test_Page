// R21: the live log polls this while a step runs. Every API call for one order, oldest first; rows with
// status null are requests still waiting for the gateway's response.
import { requireUser, errorResponse } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
  try {
    requireUser();
    const ref = decodeURIComponent(params.ref);
    const { data, error } = await db().from('api_logs').select('*').eq('order_ref', ref).order('id', { ascending: true }).limit(200);
    if (error) throw error;
    return Response.json({ logs: data || [] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
}
