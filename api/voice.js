// Vercel Serverless Function: /api/voice.js
// Messages taken by the Telnyx voice assistant (the AI that answers the office phone) -> the CRM and the staff inbox.
//
// Telnyx's assistant can call a "webhook tool" during a call. We give it one tool, `save_message`, that POSTs here with
// what the caller said: name, callback number, email, message. Setup is in docs/telnyx-voice-assistant.md.
//
// What one call to this endpoint does:
//   * saves (or reuses, by phone number) a lead in HQ > Leads, source "Phone call";
//   * saves a callback request in HQ > Callbacks (the "messages left for the team" list);
//   * emails the staff list (NOTIFICATION_EMAIL) with tap-to-call and tap-to-text links.
// Only Telnyx's tool can call it: VOICE_WEBHOOK_SECRET (20+ characters) in the x-voice-secret header.
// The reply is short plain text on purpose: the assistant reads it, so a missing detail comes back as a question to ask.
import { createHash, timingSafeEqual } from 'node:crypto';
import { supabase, supabaseConfig } from '../lib/supabase-rest.js';
import { notifyStaff, esc } from '../lib/notify.js';
import { str, errTag } from '../lib/chat-core.js';
import { usDigits, prettyPhone } from '../lib/sms-core.js';

const MIN_SECRET = 20;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DB_TIMEOUT_MS = 5000;

const sha = (s) => createHash('sha256').update(s).digest();
const sameSecret = (given) => given.length > 0 && timingSafeEqual(sha(given), sha(process.env.VOICE_WEBHOOK_SECRET));
const authorized = (req) => {
  const h = req.headers || {};
  const bearer = /^Bearer\s+(.+)$/i.exec(str(h.authorization, 400));
  return sameSecret(str(h['x-voice-secret'], 300)) || (bearer && sameSecret(bearer[1].trim())) || sameSecret(str(req.query?.k, 300));
};

const out = (res, code, body) => res.status(code).json(body);
// The assistant reads `message` back to the caller or uses it to ask for what is missing.
const ask = (res, message) => out(res, 200, { ok: false, message });

const phoneOf = (...candidates) => {
  for (const c of candidates) {
    const us = usDigits(c);
    if (us) return prettyPhone(us);
    const d = String(c || '').replace(/\D/g, '');
    if (d.length >= 10 && d.length <= 15) return str(c, 40);
  }
  return '';
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return out(res, 405, { ok: false }); }
  if (str(process.env.VOICE_WEBHOOK_SECRET, 300).length < MIN_SECRET) {
    console.error(`Voice messages: VOICE_WEBHOOK_SECRET missing or shorter than ${MIN_SECRET} characters; endpoint is closed.`);
    return out(res, 503, { ok: false, error: 'not set up' });
  }
  if (!authorized(req)) return out(res, 401, { ok: false });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { return out(res, 400, { ok: false }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return out(res, 400, { ok: false });
  // Be forgiving about where the tool arguments sit.
  const b = [body.arguments, body.args, body.data?.arguments, body].find((x) => x && typeof x === 'object' && !Array.isArray(x)) || {};

  const db = supabaseConfig();
  if (!db) { console.error('Voice messages: SUPABASE_* not set.'); return out(res, 503, { ok: false, error: 'not set up' }); }

  const first = str(b.first_name, 60), last = str(b.last_name, 60);
  const name = str(b.name, 100) || str(`${first} ${last}`, 100);
  const phone = phoneOf(b.callback_number, b.phone, b.caller_number, b.from, b.caller);
  const email = str(b.email, 150);
  const message = str(b.message || b.reason || b.notes, 1500);
  const bestTime = str(b.best_time, 100);

  if (!phone) return ask(res, 'I need a phone number to call back. Ask the caller for it, with area code, then save the message again.');
  if (email && !EMAIL.test(email)) return ask(res, 'That email address does not look right. Ask the caller to spell it, or save the message without an email.');
  if (!message) return ask(res, 'I need what the caller wants the team to know. Ask for their message, then save it again.');

  const digits = phone.replace(/\D/g, '');
  try {
    // A retry of the same message (Telnyx can retry) must not make a second record or a second email.
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const dup = await (await supabase(db, `callbacks?phone=eq.${encodeURIComponent(phone)}&message=eq.${encodeURIComponent(message)}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=1`, {}, DB_TIMEOUT_MS)).json();
    if (dup.length) return out(res, 200, { ok: true, message: 'Already saved. The team will call back.' });

    const found = await (await supabase(db, `leads?or=(phone_digits.eq.${digits.slice(-10)},phone_digits.eq.1${digits.slice(-10)})&select=id,name,email&limit=1`, {}, DB_TIMEOUT_MS)).json();
    let leadId = found[0]?.id || null;
    const leadName = name || found[0]?.name || 'Phone caller (name not captured)';
    if (!leadId) {
      const created = await (await supabase(db, 'leads?select=id', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          name: leadName, phone, email: email || null, interest: 'Phone call (AI assistant)', notes: message,
          source: 'Phone call', origin_domain: 'aspen2homes.com', raw: { channel: 'voice', bestTime: bestTime || null }
        })
      }, DB_TIMEOUT_MS)).json();
      leadId = created[0]?.id || null;
    } else if (email && !found[0].email) {
      await supabase(db, `leads?id=eq.${encodeURIComponent(leadId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ email }) }, DB_TIMEOUT_MS);
    }

    await supabase(db, 'callbacks', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ lead_id: leadId, name: leadName, phone, email: email || found[0]?.email || null, message, best_time: bestTime || null })
    }, DB_TIMEOUT_MS);
  } catch (err) {
    console.error('Voice messages: could not save:', errTag(err));
    return out(res, 502, { ok: false, message: 'I could not save that just now. Tell the caller the team will not have the message and to call the office again.' });
  }

  const tel = `tel:${digits}`;
  await notifyStaff({
    subject: `[Phone Message] ${name || 'Caller'} - ${phone}`,
    replyTo: email || undefined,
    html: `<h2>A caller left a message with the phone assistant</h2><p><strong>${esc(name) || 'Name not given'}</strong> &middot; <a href="${esc(tel)}">Call ${esc(phone)}</a> &middot; <a href="${esc(`sms:${digits}`)}">Text</a></p><p><strong>Email:</strong> ${email ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : 'Not given'}</p><p><strong>Best time:</strong> ${esc(bestTime) || 'Not given'}</p><p><strong>Message:</strong><br>${esc(message).replace(/\n/g, '<br>')}</p><hr><small>Saved to HQ &gt; Callbacks and Leads.</small>`
  });
  return out(res, 200, { ok: true, message: 'Saved. The team will call back. Do not promise a time.' });
}
