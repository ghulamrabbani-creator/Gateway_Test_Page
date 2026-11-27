import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Keep-alive for the free Supabase project, which pauses after a week with no activity.
// Vercel Cron calls this once a day (see vercel.json). It runs one tiny count query and
// returns no data, so it is safe to leave open without a sign-in.
export const dynamic = 'force-dynamic';

export async function GET() {
  const started = Date.now();
  const { error } = await db().from('app_config').select('*', { count: 'exact', head: true });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 503 });
  return NextResponse.json({ ok: true, ms: Date.now() - started, at: new Date().toISOString() });
}
