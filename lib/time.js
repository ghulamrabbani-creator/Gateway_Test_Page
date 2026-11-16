// R22: every date and time on the page in UAE time (Asia/Dubai, UTC+4), whether rendered on the server (Vercel runs
// in UTC) or in the browser. Pure helpers, safe on server and client.
const TZ = 'Asia/Dubai';
const dt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const d = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' });
const t = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const ok = (v) => v != null && v !== '' && !Number.isNaN(new Date(v).getTime());
export const fmtDT = (v) => (ok(v) ? `${dt.format(new Date(v)).replace(',', '')} GST` : '—');
export const fmtD = (v) => (ok(v) ? d.format(new Date(v)) : '—');
export const fmtT = (v) => (ok(v) ? t.format(new Date(v)) : '—');
