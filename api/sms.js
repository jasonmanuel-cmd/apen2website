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
import { supabaseConfig } from '../lib/supabase-rest.js';
import { str, errTag } from '../lib/chat-core.js';
import { answerText, usDigits } from '../lib/sms-core.js';

export { usDigits };

const MIN_SECRET = 20;

const sha = (s) => createHash('sha256').update(s).digest();
const authorized = (req) => {
  const given = str(req.headers?.['x-bridge-secret'], 300);
  return given.length > 0 && timingSafeEqual(sha(given), sha(process.env.SMS_BRIDGE_SECRET));
};

const out = (res, code, body) => res.status(code).json(body);

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

  const db = supabaseConfig();
  if (!db || !process.env.ANTHROPIC_API_KEY) {
    console.error('SMS bridge: SUPABASE_* or ANTHROPIC_API_KEY not set.');
    return out(res, 503, { ok: false, error: 'not set up' });
  }

  try {
    const result = await answerText(db, { from: body.from, text: str(body.text, 600), secret: process.env.SMS_BRIDGE_SECRET });
    return out(res, 200, { ok: true, ...result });
  } catch (err) {
    // The bridge keeps the email unread and tries again on its next run.
    console.error('SMS bridge error:', errTag(err));
    return out(res, 502, { ok: false });
  }
}
