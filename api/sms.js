// Vercel Serverless Function: /api/sms.js
// Text-message intake for the Google Voice bridge (scripts/google-voice-bridge.gs, see docs/google-voice-bridge.md).
//
// Google Voice has no API, so a small Google Apps Script running inside the owner's Gmail reads the
// "New text message" emails Google Voice sends, POSTs { from, text } here, and replies to the email with
// whatever comes back (Google Voice turns that email reply into a text). This endpoint is the brain:
// the same assistant as the website chat, with the same lead capture, callbacks and HQ transcripts.
//
// Safety, because this one talks to strangers' phones:
//   * Only the bridge can call it: a shared secret (SMS_BRIDGE_SECRET, 20+ characters) in a header.
//   * STOP / UNSUBSCRIBE are honoured at once and remembered (sms_optouts); START undoes it; HELP gets a fixed answer.
//   * It never texts first: it only answers a text the person sent.
//   * No replies to short codes, non-US numbers, our own number, or automated senders, so it cannot get into a
//     robot-to-robot loop. A conversation goes quiet after MAX_VISITOR_MESSAGES, and one number gets at most 10 replies an hour.
//   * Every reply is identified as an automated assistant, and short (320 characters).
import { createHash, timingSafeEqual } from 'node:crypto';
import { supabaseConfig, supabase } from '../lib/supabase-rest.js';
import { runChat, str, errTag } from '../lib/chat-core.js';
import { FACTS } from '../lib/chat-knowledge.js';

const MIN_SECRET = 20;
const DB_TIMEOUT_MS = 4000;
const PER_PHONE_LIMIT = 10;
const WINDOW_MS = 60 * 60_000;

const sha = (s) => createHash('sha256').update(s).digest();
const authorized = (req) => {
  const given = str(req.headers?.['x-bridge-secret'], 300);
  return given.length > 0 && timingSafeEqual(sha(given), sha(process.env.SMS_BRIDGE_SECRET));
};

// "+1 (661) 555-0100", "661.555.0100", "16615550100" -> "6615550100"; anything that is not a 10-digit US number -> ''.
export const usDigits = (raw) => {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  return d.length === 10 ? d : '';
};
const pretty = (d) => `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;

const STOP = /^(stop|stopall|unsubscribe|cancel|end|quit|opt ?out)$/i;
const START = /^(start|unstop|resume)$/i;
const HELP = /^(help|info)$/i;
// Texts from other systems (codes, alerts, other auto-responders). Answering these starts robot-to-robot loops.
const AUTOMATED = /do not reply|don'?t reply|automated (message|text|reply|response)|auto-?reply|no-?reply|verification code|security code|login code|one[- ]time (code|password)|\botp\b|your code is|reply stop to (end|opt|unsub)|msg ?& ?data rates|out of office/i;

const hits = new Map();
const rateOk = (key) => {
  const now = Date.now();
  const rec = hits.get(key);
  if (!rec || rec.resetAt <= now) { hits.set(key, { n: 1, resetAt: now + WINDOW_MS }); return true; }
  rec.n += 1;
  return rec.n <= PER_PHONE_LIMIT;
};
const sweeper = setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k); }, WINDOW_MS);
if (sweeper.unref) sweeper.unref();

const out = (res, code, body) => res.status(code).json(body);
const quiet = (res, why) => out(res, 200, { ok: true, reply: '', skipped: why });

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return out(res, 405, { ok: false }); }
  if (str(process.env.SMS_BRIDGE_SECRET, 300).length < MIN_SECRET) {
    console.error(`SMS bridge: SMS_BRIDGE_SECRET missing or shorter than ${MIN_SECRET} characters; endpoint is closed.`);
    return out(res, 503, { ok: false, error: 'not set up' });
  }
  if (!authorized(req)) return out(res, 401, { ok: false });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { return out(res, 400, { ok: false }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return out(res, 400, { ok: false });

  const phone = usDigits(body.from);
  const text = str(body.text, 600);
  if (!phone) return quiet(res, 'not a 10-digit US number');
  if (phone === usDigits(FACTS.phone)) return quiet(res, 'our own number');
  if (!text) return quiet(res, 'empty');

  const db = supabaseConfig();
  if (!db || !process.env.ANTHROPIC_API_KEY) {
    console.error('SMS bridge: SUPABASE_* or ANTHROPIC_API_KEY not set.');
    return out(res, 503, { ok: false, error: 'not set up' });
  }

  try {
    const phoneQ = encodeURIComponent(phone);
    const word = text.replace(/[^\w ]/g, '').trim();
    const optedOut = (await (await supabase(db, `sms_optouts?phone=eq.${phoneQ}&select=phone`, {}, DB_TIMEOUT_MS)).json()).length > 0;

    if (STOP.test(word)) {
      if (optedOut) return quiet(res, 'already opted out');
      await supabase(db, 'sms_optouts?on_conflict=phone', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ phone })
      }, DB_TIMEOUT_MS);
      return out(res, 200, { ok: true, reply: `You're unsubscribed and will get no more texts from this number. Call ${FACTS.phone} any time.`, optedOut: true });
    }
    if (START.test(word)) {
      await supabase(db, `sms_optouts?phone=eq.${phoneQ}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, DB_TIMEOUT_MS);
      return out(res, 200, { ok: true, reply: `${FACTS.name}: you're back on. Text HOMES any time, or call ${FACTS.phone}. Reply STOP to stop.` });
    }
    if (optedOut) return quiet(res, 'opted out');
    if (HELP.test(word)) {
      return out(res, 200, { ok: true, reply: `${FACTS.name} (${FACTS.license}), new homes in Tehachapi. Call ${FACTS.phone}, 7am-7pm daily. Reply STOP to stop texts.` });
    }

    if (AUTOMATED.test(text)) return quiet(res, 'looks automated');
    if (!rateOk(phone)) return quiet(res, 'rate limited');

    // One thread per number per month; the id is a hash, so the number itself is not the key.
    const month = new Date().toISOString().slice(0, 7);
    const sid = `sms-${createHash('sha256').update(`${process.env.SMS_BRIDGE_SECRET}:${phone}:${month}`).digest('hex').slice(0, 32)}`;
    const { reply, done } = await runChat(db, { sid, message: text, host: 'aspen2homes.com', channel: 'sms', senderPhone: pretty(phone) });
    return out(res, 200, { ok: true, reply, done });
  } catch (err) {
    // The bridge keeps the email unread and tries again on its next run.
    console.error('SMS bridge error:', errTag(err));
    return out(res, 502, { ok: false });
  }
}
