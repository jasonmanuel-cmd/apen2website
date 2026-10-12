// Vercel Serverless Function: /api/chat.js
// Website chat assistant. POST { sid, message } -> { ok, reply }.
// The conversation lives in Supabase (conversations + messages), so staff can read it in /hq and the
// browser can never inject its own history. The model gets three tools (lib/chat-brain.js): save a lead,
// request an appointment, flag for a human. Each tool validates its own input.
// Same-origin only (no CORS headers). Best effort: any failure tells the visitor to call the office.
import { supabaseConfig, supabase } from '../lib/supabase-rest.js';
import { runTurn } from '../lib/chat-brain.js';
import { buildSystemPrompt, APPT, FACTS } from '../lib/chat-knowledge.js';
import { notifyStaff, esc } from '../lib/notify.js';

const DB_TIMEOUT_MS = 4000;
const MAX_MESSAGE = 600;          // characters per visitor message
const MAX_VISITOR_MESSAGES = 40;  // per conversation; stops a runaway or abusive chat
const HISTORY_LIMIT = 24;
const RATE_LIMIT = 20;            // requests per minute per address
const RATE_WINDOW_MS = 60_000;

const str = (v, max = 200) => (v == null ? '' : String(v)).trim().slice(0, max);
const errTag = (err) => String((err && (err.code || err.name)) || 'error');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validPhone = (p) => { const d = p.replace(/\D/g, ''); return d.length >= 10 && d.length <= 15; };
const SID = /^[A-Za-z0-9-]{16,64}$/;
const CALL = `Please call ${FACTS.phone}.`;

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

// "Now" in Tehachapi, as { date: 'YYYY-MM-DD', minutes: minutes since midnight }.
export function localNow(at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: APPT.tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(at).map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

// Returns an error string for the model, or null when the slot is acceptable.
export function checkSlot(date, time, now = localNow()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Date must be YYYY-MM-DD.';
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) return 'That is not a real date.';
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!m) return 'Time must be 24-hour HH:MM.';
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  if (minutes < APPT.openHour * 60 || minutes > APPT.lastStartHour * 60) {
    return `We are open ${FACTS.hours}. Tours start between 7:00 AM and 6:00 PM.`;
  }
  if (date < now.date || (date === now.date && minutes <= now.minutes + 60)) return 'That time has passed or is too soon. Pick a later time.';
  const limit = new Date(`${now.date}T12:00:00Z`); limit.setUTCDate(limit.getUTCDate() + APPT.maxDaysAhead);
  if (d > limit) return `We can only take requests up to ${APPT.maxDaysAhead} days ahead.`;
  return null;
}

const rows = async (res) => res.json();

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
    // 1. Find or create the conversation.
    const sidQ = encodeURIComponent(sid);
    let conv = (await rows(await supabase(db, `conversations?id=eq.${sidQ}&select=*`, {}, DB_TIMEOUT_MS)))[0];
    if (!conv) {
      conv = (await rows(await supabase(db, 'conversations', {
        method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ id: sid })
      }, DB_TIMEOUT_MS)))[0];
    }
    if (conv.message_count >= MAX_VISITOR_MESSAGES) {
      return res.status(200).json({ ok: true, reply: `This chat has reached its limit. ${CALL} Or use the form at /contact/.` });
    }

    // 2. Load history, then store the visitor's message.
    const past = (await rows(await supabase(db,
      `messages?conversation_id=eq.${sidQ}&select=role,content&order=id.desc&limit=${HISTORY_LIMIT}`, {}, DB_TIMEOUT_MS))).reverse();
    await supabase(db, 'messages', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ conversation_id: sid, role: 'user', content: message })
    }, DB_TIMEOUT_MS);

    // 3. Tools. `state` is what the model is told about this conversation.
    const state = { leadId: conv.lead_id || null, leadName: '', phone: '', email: '', appointments: 0, needsHuman: Boolean(conv.needs_human) };
    if (state.leadId) {
      const l = (await rows(await supabase(db, `leads?id=eq.${encodeURIComponent(state.leadId)}&select=name,phone,email`, {}, DB_TIMEOUT_MS)))[0];
      if (l) Object.assign(state, { leadName: l.name, phone: l.phone, email: l.email || '' });
    }
    state.appointments = (await rows(await supabase(db, `appointments?conversation_id=eq.${sidQ}&select=id`, {}, DB_TIMEOUT_MS))).length;
    const host = str(req.headers.host, 100).toLowerCase().replace(/:\d+$/, '');

    const handlers = {
      async save_contact(i) {
        const name = str(i.name, 100), phone = str(i.phone, 40), email = str(i.email, 150);
        if (name.length < 2) return { error: 'Need the visitor\'s full name.' };
        if (!validPhone(phone)) return { error: 'That phone number is not valid. Ask for a number with area code.' };
        if (!EMAIL.test(email)) return { error: 'That email address is not valid. Ask for it again.' };
        const interest = str(i.interest, 150), notes = str(i.notes, 1500);
        const payload = {
          name, phone, email, interest: interest || null, notes: notes || null,
          source: 'Website chat', origin_domain: host || null, raw: { channel: 'chat', conversation_id: sid }
        };
        const first = !state.leadId;
        if (first) {
          const r = await supabase(db, 'leads?select=id', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payload) }, DB_TIMEOUT_MS);
          state.leadId = (await rows(r))[0]?.id || null;
          if (!state.leadId) return { error: 'Could not save. Give the visitor the office phone number.' };
          await supabase(db, `conversations?id=eq.${sidQ}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ lead_id: state.leadId }) }, DB_TIMEOUT_MS);
        } else {
          const { raw, source, origin_domain, ...update } = payload;
          await supabase(db, `leads?id=eq.${encodeURIComponent(state.leadId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(update) }, DB_TIMEOUT_MS);
        }
        Object.assign(state, { leadName: name, phone, email });
        if (first) {
          await notifyStaff({
            subject: `[New Lead][Chat] ${name} - ${interest || 'General Inquiry'}`, replyTo: email,
            html: `<h2>New lead from the website chat</h2><p><strong>Name:</strong> ${esc(name)}</p><p><strong>Phone:</strong> <a href="tel:${esc(phone)}">${esc(phone)}</a></p><p><strong>Email:</strong> <a href="mailto:${esc(email)}">${esc(email)}</a></p><p><strong>Interested in:</strong> ${esc(interest) || 'Not given'}</p><p><strong>Notes:</strong><br>${esc(notes).replace(/\n/g, '<br>') || 'None'}</p><hr><small>Collected by the AI chat assistant. Read the full conversation in HQ.</small>`
          });
        }
        return { saved: true };
      },

      async request_appointment(i) {
        if (!state.leadId) return { error: 'Save the visitor\'s contact details first.' };
        const kind = i.kind === 'call' ? 'call' : i.kind === 'tour' ? 'tour' : '';
        if (!kind) return { error: 'kind must be tour or call.' };
        const date = str(i.date, 10), time = str(i.time, 5);
        const bad = checkSlot(date, time);
        if (bad) return { error: bad };
        if (state.appointments >= 2) return { error: 'Two requests already made. Tell the visitor the team will follow up.' };
        const notes = str(i.notes, 500);
        await supabase(db, 'appointments', {
          method: 'POST', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ conversation_id: sid, lead_id: state.leadId, name: state.leadName, phone: state.phone, email: state.email || null, kind, preferred_date: date, preferred_time: time, notes: notes || null })
        }, DB_TIMEOUT_MS);
        state.appointments += 1;
        await notifyStaff({
          subject: `[Appointment Request] ${state.leadName} - ${kind} ${date} ${time}`, replyTo: state.email || undefined,
          html: `<h2>Appointment request from the website chat</h2><p><strong>${esc(kind)}</strong> on <strong>${esc(date)}</strong> at <strong>${esc(time)}</strong> (Tehachapi time)</p><p><strong>Name:</strong> ${esc(state.leadName)}<br><strong>Phone:</strong> <a href="tel:${esc(state.phone)}">${esc(state.phone)}</a><br><strong>Email:</strong> ${esc(state.email) || 'Not given'}</p><p><strong>Notes:</strong> ${esc(notes) || 'None'}</p><p>This is a request. Confirm it with the visitor, then mark it confirmed in HQ.</p>`
        });
        return { requested: true, note: 'Tell the visitor the team will confirm by phone or text.' };
      },

      async handoff(i) {
        const reason = str(i.reason, 300) || 'Visitor needs a person';
        await supabase(db, `conversations?id=eq.${sidQ}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ needs_human: true, handoff_reason: reason, resolved: false })
        }, DB_TIMEOUT_MS);
        if (!state.needsHuman) {
          await notifyStaff({
            subject: `[Chat needs a person] ${state.leadName || 'Unknown visitor'}`,
            html: `<h2>The chat assistant asked for a person</h2><p><strong>Reason:</strong> ${esc(reason)}</p><p><strong>Visitor:</strong> ${esc(state.leadName) || 'No contact details yet'} ${esc(state.phone)}</p><p>Open HQ &gt; Chats to read the conversation.</p>`
          });
        }
        state.needsHuman = true;
        return { flagged: true, note: `Tell the visitor the team will follow up, and give the phone number ${FACTS.phone}.` };
      }
    };

    // 4. Ask the model.
    const system = buildSystemPrompt({
      today: `${localNow().date}`, contactSaved: Boolean(state.leadId), appointmentCount: state.appointments, needsHuman: state.needsHuman
    });
    let reply = '';
    try {
      reply = await runTurn({ system, history: [...past, { role: 'user', content: message }], handlers });
    } catch (err) {
      console.error('Chat model error:', errTag(err));
    }
    if (!reply) reply = `Sorry, I had trouble with that. ${CALL}`;
    reply = reply.slice(0, 1500);

    // 5. Store the reply and bump the conversation.
    await supabase(db, 'messages', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ conversation_id: sid, role: 'assistant', content: reply })
    }, DB_TIMEOUT_MS);
    await supabase(db, `conversations?id=eq.${sidQ}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ message_count: conv.message_count + 1, last_message_at: new Date().toISOString() })
    }, DB_TIMEOUT_MS);

    return res.status(200).json({ ok: true, reply });
  } catch (err) {
    console.error('Chat error:', errTag(err));
    return res.status(502).json({ ok: false, error: `Chat hit a problem. ${CALL}` });
  }
}
