// Server-only Supabase client. Uses the service-role key: every table has RLS on
// with no policies, so only this server can read or write.
import { createClient } from '@supabase/supabase-js';

let client;
export function db() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in Vercel');
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}
