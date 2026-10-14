// Vercel Serverless Function: /api/chat.js
// Website chat assistant. POST { sid, message } -> { ok, reply }.
// The conversation lives in Supabase (conversations + messages), so staff can read it in /hq and the
// browser can never inject its own history. The conversation logic lives in lib/chat-core.js (shared with texting).
// Same-origin only (no CORS headers). Best effort: any failure tells the visitor to call the office.
import { supabaseConfig } from '../lib/supabase-rest.js';
import { runChat, localNow, checkSlot, str, errTag, SID, CALL, MAX_MESSAGE } from '../lib/chat-core.js';

export { localNow, checkSlot };

const RATE_LIMIT = 20;            // requests per minute per address
const RATE_WINDOW_MS = 60_000;

const hits = new Map();
const rateOk = (key) => {
  const now = Date.now();
  const rec = hits.get(key);
  if (!rec || rec.resetAt <= now) { hits.set(key, { n: 1, resetAt: now + RATE_WINDOW_MS }); return true; }
  rec.n += 1;
  return rec.n <= RATE_LIMIT;
};
const cleaner = setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k); }, RATE_WINDOW_MS);
if (cleaner.unref) cleaner.unref();

const clientIp = (req) =>
  str(req.headers['x-forwarded-for'], 200).split(',')[0].trim() || str(req.headers['x-real-ip'], 60) || '0.0.0.0';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'Method not allowed.' }); }
  if (!rateOk(clientIp(req))) return res.status(429).json({ ok: false, error: `Too many messages. ${CALL}` });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { return res.status(400).json({ ok: false, error: 'Invalid request.' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ ok: false, error: 'Invalid request.' });

  const sid = str(body.sid, 64);
  const message = str(body.message, MAX_MESSAGE);
  if (!SID.test(sid) || !message) return res.status(400).json({ ok: false, error: 'Invalid request.' });
  // Bot trap: a filled hidden field means a script, not a person.
  if (str(body.honeypot)) return res.status(200).json({ ok: true, reply: 'Thanks!' });

  const db = supabaseConfig();
  if (!db || !process.env.ANTHROPIC_API_KEY) {
    console.error('Chat unavailable: SUPABASE_* or ANTHROPIC_API_KEY not set.');
    return res.status(503).json({ ok: false, error: `Chat is offline right now. ${CALL}` });
  }

  try {
    const host = str(req.headers.host, 100).toLowerCase().replace(/:\d+$/, '');
    const { reply, done } = await runChat(db, { sid, message, host, channel: 'web' });
    return res.status(200).json({ ok: true, reply, done });
  } catch (err) {
    console.error('Chat error:', errTag(err));
    return res.status(502).json({ ok: false, error: `Chat hit a problem. ${CALL}` });
  }
}
