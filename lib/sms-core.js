// What happens to one inbound text, whichever line it arrived on (Telnyx: api/telnyx.js).
// Pure of any transport: the caller authenticates the request and delivers the reply; this decides what the reply is.
//
// Safety rules live here so every channel gets them:
//   * STOP / UNSUBSCRIBE / CANCEL / END / QUIT are honoured at once and remembered (sms_optouts); START undoes it; HELP is a fixed answer.
//   * Never texts first. Never answers short codes, non-US numbers, our own number, or automated senders (no robot loops).
//   * One number gets at most 10 replies an hour; a thread goes quiet after MAX_VISITOR_MESSAGES.
import { createHash } from 'node:crypto';
import { supabase } from './supabase-rest.js';
import { runChat } from './chat-core.js';
import { FACTS } from './chat-knowledge.js';

const DB_TIMEOUT_MS = 4000;
const PER_PHONE_LIMIT = 10;
const WINDOW_MS = 60 * 60_000;

// "+1 (661) 555-0100", "661.555.0100", "16615550100" -> "6615550100"; anything that is not a 10-digit US number -> ''.
export const usDigits = (raw) => {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  return d.length === 10 ? d : '';
};
export const prettyPhone = (d) => `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;

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

const quiet = (skipped) => ({ reply: '', skipped });

/**
 * `from` is the sender's number in any format, `text` what they wrote, `secret` any server-side secret (used only to
 * make the conversation id unguessable). Returns { reply, skipped?, optedOut?, done? }; reply '' means stay silent.
 * Throws on database failure (the caller decides whether to retry).
 */
export async function answerText(db, { from, text: rawText, secret }) {
  const text = String(rawText ?? '').trim();
  const phone = usDigits(from);
  if (!phone) return quiet('not a 10-digit US number');
  if (phone === usDigits(FACTS.phone)) return quiet('our own number');
  if (!text) return quiet('empty');

  const phoneQ = encodeURIComponent(phone);
  const word = text.replace(/[^\w ]/g, '').trim();
  const optedOut = (await (await supabase(db, `sms_optouts?phone=eq.${phoneQ}&select=phone`, {}, DB_TIMEOUT_MS)).json()).length > 0;

  if (STOP.test(word)) {
    if (optedOut) return quiet('already opted out');
    await supabase(db, 'sms_optouts?on_conflict=phone', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ phone })
    }, DB_TIMEOUT_MS);
    return { reply: `${FACTS.name}: You're unsubscribed and will get no more texts from this number. Call ${FACTS.phone} any time.`, optedOut: true };
  }
  if (START.test(word)) {
    await supabase(db, `sms_optouts?phone=eq.${phoneQ}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, DB_TIMEOUT_MS);
    return { reply: `${FACTS.name}: you're back on. Msg frequency varies. Msg&data rates may apply. Text HOMES any time or call ${FACTS.phone}. Reply STOP to stop, HELP for help.` };
  }
  if (optedOut) return quiet('opted out');
  if (HELP.test(word)) {
    return { reply: `${FACTS.name} (${FACTS.license}), new homes in Tehachapi. Call ${FACTS.phone}, 7am-7pm daily. Msg frequency varies. Reply STOP to stop texts.` };
  }

  if (AUTOMATED.test(text)) return quiet('looks automated');
  if (!rateOk(phone)) return quiet('rate limited');

  // One thread per number per month; the id is a hash, so the number itself is not the key.
  const month = new Date().toISOString().slice(0, 7);
  const sid = `sms-${createHash('sha256').update(`${secret}:${phone}:${month}`).digest('hex').slice(0, 32)}`;
  const { reply, done } = await runChat(db, { sid, message: text, host: 'aspen2homes.com', channel: 'sms', senderPhone: prettyPhone(phone) });
  return { reply, done };
}
