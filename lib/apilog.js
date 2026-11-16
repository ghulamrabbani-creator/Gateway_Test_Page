// R21: api_logs rows are written in two parts so the live log can show a request while it is in flight.
// logStart inserts the request (status null = waiting); logEnd fills in the response. If the first insert
// failed, logEnd inserts the whole row instead, so nothing is lost.
import { db } from './db';

export async function logStart(row) {
  const { data, error } = await db().from('api_logs').insert({ ...row, status: null, res_body: null, duration_ms: null, error: null }).select('id').single();
  if (error) console.error('logStart failed', error);
  return data?.id || null;
}

export async function logEnd(id, row, result) {
  const patch = { status: result.status || 0, res_body: result.res_body ?? null, duration_ms: result.duration_ms, error: result.error || null };
  const { error } = id ? await db().from('api_logs').update(patch).eq('id', id) : await db().from('api_logs').insert({ ...row, ...patch });
  if (error) console.error('logEnd failed', error);
}
