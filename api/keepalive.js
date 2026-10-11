// Vercel Cron target: /api/keepalive
// Runs once a day (see "crons" in vercel.json). It reads a single row from the Supabase leads table so the
// free-plan project always has recent activity and is never paused for being idle. It also fails loudly
// (non-200 in the Vercel cron log) if the database can't be reached, which is the early warning that leads
// are not being stored.
// Reads one id only and returns no lead data. If CRON_SECRET is set, Vercel sends it automatically and
// anyone else is refused.
import { timingSafeEqual } from 'node:crypto';

const DB_TIMEOUT_MS = 8000;
const str = (v, max = 200) => (v == null ? '' : String(v)).trim().slice(0, max);

// Errors can echo request details, so logs only get a short tag, never a message or body.
const errTag = (err) => String((err && (err.code || err.name)) || 'error');

const authorized = (req) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // optional: set CRON_SECRET in Vercel to lock this endpoint to the cron job
  const given = Buffer.from(str(req.headers && req.headers.authorization, 600));
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed. Use GET.' });
  }
  if (!authorized(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized.' });
  }

  const url = str(process.env.SUPABASE_URL, 300).replace(/\/+$/, '');
  const key = str(process.env.SUPABASE_SERVICE_ROLE_KEY, 600);
  if (!url || !key) {
    console.error('Keep-alive: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.');
    return res.status(503).json({ ok: false, error: 'Supabase is not configured.' });
  }

  try {
    const r = await fetch(`${url}/rest/v1/leads?select=id&limit=1`, {
      method: 'GET',
      headers: {
        apikey: key,
        // Legacy service_role keys are JWTs and go in both headers; newer sb_secret_ keys go in apikey only.
        ...(key.startsWith('eyJ') && { Authorization: `Bearer ${key}` })
      },
      signal: AbortSignal.timeout(DB_TIMEOUT_MS)
    });
    if (!r.ok) throw Object.assign(new Error('Supabase request failed'), { code: `HTTP_${r.status}` });
  } catch (err) {
    console.error('Keep-alive: Supabase NOT reachable:', errTag(err));
    return res.status(502).json({ ok: false, error: 'Could not reach Supabase.' });
  }

  return res.status(200).json({ ok: true });
}
