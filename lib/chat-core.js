// The chat assistant's conversation logic, shared by the web chat (api/chat.js) and text messages (api/sms.js).
// Stores every turn in Supabase (conversations + messages), runs the model with its tools
// (lib/chat-brain.js), and returns { reply, done }. HTTP concerns (rate limits, validation, secrets) stay in the callers.
import { supabase } from './supabase-rest.js';
import { runTurn } from './chat-brain.js';
import { buildSystemPrompt, APPT, FACTS, MAX_VISITOR_MESSAGES } from './chat-knowledge.js';
import { notifyStaff, esc } from './notify.js';

const DB_TIMEOUT_MS = 4000;
export const MAX_MESSAGE = 600;   // characters per visitor message
const HISTORY_LIMIT = 24;

export const str = (v, max = 200) => (v == null ? '' : String(v)).trim().slice(0, max);
export const errTag = (err) => String((err && (err.code || err.name)) || 'error');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const validPhone = (p) => { const d = p.replace(/\D/g, ''); return d.length >= 10 && d.length <= 15; };
export const SID = /^[A-Za-z0-9-]{16,64}$/;
export const CALL = `Please call ${FACTS.phone}.`;
// Tap-to-call and tap-to-text links for staff emails: they open the phone's own calling and texting apps.
const tel = (p) => `tel:${String(p).replace(/[^\d+]/g, '')}`;
const sms = (p) => `sms:${String(p).replace(/[^\d+]/g, '')}`;
const contactLinks = (phone) => `<a href="${esc(tel(phone))}">Call ${esc(phone)}</a> &middot; <a href="${esc(sms(phone))}">Text</a>`;


// A text reply stays short: at most about two SMS segments, cut at a sentence end when possible.
export const SMS_MAX = 320;
// Carriers like the first text in a thread to say how to stop and that rates may apply. Added by us, not left to the model.
export const SMS_FIRST_FOOTER = ' Msg frequency varies. Msg&data rates may apply. Reply STOP to stop, HELP for help.';
export function textLength(s, max = SMS_MAX) {
  s = String(s).replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return end > 120 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…';
}

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
// A usable name has a first and a last part. On the final message we take what we have rather than lose the lead.
// When the AI step fails, a phone number or email the visitor typed must still reach the team.
const PHONE_IN_TEXT = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
const EMAIL_IN_TEXT = /[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+/;
export const salvageContact = (text) => {
  const t = String(text || '');
  const phone = (PHONE_IN_TEXT.exec(t) || [''])[0].trim();
  const email = (EMAIL_IN_TEXT.exec(t) || [''])[0].trim();
  return { phone: validPhone(phone) ? phone : '', email: EMAIL.test(email) ? email : '' };
};
const hasFullName = (n) => n.trim().split(/\s+/).filter(Boolean).length >= 2;

/**
 * One visitor message in, one reply out. `channel` is 'web' or 'sms'; `senderPhone` is the number a text came
 * from (so the assistant never has to ask for it). Throws on database failure; the caller decides what to show.
 */
export async function runChat(db, { sid, message, host = '', channel = 'web', senderPhone = '' }) {
  // 1. Find or create the conversation.
    const sidQ = encodeURIComponent(sid);
    let conv = (await rows(await supabase(db, `conversations?id=eq.${sidQ}&select=*`, {}, DB_TIMEOUT_MS)))[0];
    if (!conv) {
      conv = (await rows(await supabase(db, 'conversations', {
        method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ id: sid, channel })
      }, DB_TIMEOUT_MS)))[0];
    }
    if (conv.message_count >= MAX_VISITOR_MESSAGES) {
      // Over the cap: a web chat gets one closing line; a text thread goes quiet (never answer in a loop).
      const handled = conv.lead_id || conv.needs_human;
      return { done: true, capped: true, reply: channel === 'sms' ? '' : handled
        ? `This chat has ended. The team has your details and will follow up. You can also call ${FACTS.phone}.`
        : `This chat has ended. Please call ${FACTS.phone} or use the form at /contact/ and the team will get back to you.` };
    }
    const turn = conv.message_count + 1;

    // 2. Load history, then store the visitor's message.
    const past = (await rows(await supabase(db,
      `messages?conversation_id=eq.${sidQ}&select=role,content&order=id.desc&limit=${HISTORY_LIMIT}`, {}, DB_TIMEOUT_MS))).reverse();
    await supabase(db, 'messages', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ conversation_id: sid, role: 'user', content: message })
    }, DB_TIMEOUT_MS);

    // 3. Tools. `state` is what the model is told about this conversation.
    const state = { leadId: conv.lead_id || null, leadName: '', phone: senderPhone, email: '', appointments: 0, callbacks: 0, needsHuman: Boolean(conv.needs_human) };
    if (state.leadId) {
      const l = (await rows(await supabase(db, `leads?id=eq.${encodeURIComponent(state.leadId)}&select=name,phone,email`, {}, DB_TIMEOUT_MS)))[0];
      if (l) Object.assign(state, { leadName: l.name, phone: l.phone, email: l.email || '' });
    }
    state.appointments = (await rows(await supabase(db, `appointments?conversation_id=eq.${sidQ}&select=id`, {}, DB_TIMEOUT_MS))).length;
    state.callbacks = (await rows(await supabase(db, `callbacks?conversation_id=eq.${sidQ}&select=id`, {}, DB_TIMEOUT_MS))).length;

    // Create the lead on first contact, update it afterwards. Returns an error string for the model, or null.
    const upsertLead = async ({ name, phone, email, interest, notes }) => {
      const payload = {
        name, phone, email: email || null, interest: interest || null, notes: notes || null,
        source: channel === 'sms' ? 'Text message' : 'Website chat', origin_domain: host || null, raw: { channel: channel === 'sms' ? 'sms' : 'chat', conversation_id: sid }
      };
      if (!state.leadId) {
        const r = await supabase(db, 'leads?select=id', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payload) }, DB_TIMEOUT_MS);
        state.leadId = (await rows(r))[0]?.id || null;
        if (!state.leadId) return { error: 'Could not save. Give the visitor the office phone number.' };
        await supabase(db, `conversations?id=eq.${sidQ}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ lead_id: state.leadId }) }, DB_TIMEOUT_MS);
        Object.assign(state, { leadName: name, phone, email: email || '', isNewLead: true });
        return null;
      }
      const { raw, source, origin_domain, ...update } = payload;
      // Never blank out an email or note the visitor gave earlier.
      for (const k of Object.keys(update)) if (update[k] == null) delete update[k];
      await supabase(db, `leads?id=eq.${encodeURIComponent(state.leadId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(update) }, DB_TIMEOUT_MS);
      Object.assign(state, { leadName: name, phone, email: email || state.email });
      return null;
    };

    const handlers = {
      async save_contact(i) {
        const name = str(i.name, 100), phone = str(i.phone, 40), email = str(i.email, 150);
        if (name.length < 2) return { error: 'Need the visitor\'s name.' };
        if (!hasFullName(name) && turn < MAX_VISITOR_MESSAGES) return { error: 'Need first AND last name. Ask for the last name.' };
        if (!validPhone(phone)) return { error: 'That phone number is not valid. Ask for a number with area code.' };
        if (!EMAIL.test(email)) return { error: 'That email address is not valid. Ask for it again.' };
        const interest = str(i.interest, 150), notes = str(i.notes, 1500);
        state.isNewLead = false;
        const bad = await upsertLead({ name, phone, email, interest, notes });
        if (bad) return bad;
        if (state.isNewLead) {
          await notifyStaff({
            subject: `[New Lead][Chat] ${name} - ${interest || 'General Inquiry'}`, replyTo: email,
            html: `<h2>New lead from the website chat</h2><p><strong>Name:</strong> ${esc(name)}</p><p><strong>Phone:</strong> ${contactLinks(phone)}</p><p><strong>Email:</strong> <a href="mailto:${esc(email)}">${esc(email)}</a></p><p><strong>Interested in:</strong> ${esc(interest) || 'Not given'}</p><p><strong>Notes:</strong><br>${esc(notes).replace(/\n/g, '<br>') || 'None'}</p><hr><small>Collected by the AI chat assistant. Read the full conversation in HQ.</small>`
          });
        }
        return { saved: true };
      },

      async request_callback(i) {
        const name = str(i.name, 100) || state.leadName, phone = str(i.phone, 40) || state.phone;
        const email = str(i.email, 150);
        const message = str(i.message, 1000), bestTime = str(i.best_time, 100);
        if (name.length < 2) return { error: 'Need the visitor\'s name.' };
        if (!hasFullName(name) && turn < MAX_VISITOR_MESSAGES) return { error: 'Need first AND last name. Ask for the last name.' };
        if (!validPhone(phone)) return { error: 'That phone number is not valid. Ask for a number with area code.' };
        if (email && !EMAIL.test(email)) return { error: 'That email address is not valid. Ask for it again, or leave it out.' };
        if (!message) return { error: 'Need a short message for the team.' };
        if (!email && !state.email && i.email_declined !== true && turn < MAX_VISITOR_MESSAGES) return { error: 'Ask for their email address (the team can write back with details). If they decline, call again with email_declined true.' };
        if (state.callbacks >= 2) return { error: 'Two messages already left. Tell the visitor the team will follow up.' };
        // On an existing lead the message lives in the callbacks table; don't overwrite the interest and notes already saved.
        const fresh = !state.leadId;
        const bad = await upsertLead({ name, phone, email, interest: fresh ? 'Callback request' : '', notes: fresh ? message : '' });
        if (bad) return bad;
        await supabase(db, 'callbacks', {
          method: 'POST', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ conversation_id: sid, lead_id: state.leadId, name, phone, email: email || state.email || null, message, best_time: bestTime || null })
        }, DB_TIMEOUT_MS);
        await supabase(db, `conversations?id=eq.${sidQ}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ needs_human: true, handoff_reason: 'Callback requested', resolved: false })
        }, DB_TIMEOUT_MS);
        state.callbacks += 1; state.needsHuman = true;
        await notifyStaff({
          subject: `[Callback Request] ${name} - ${phone}`, replyTo: email || state.email || undefined,
          html: `<h2>Please call this visitor back</h2><p><strong>${esc(name)}</strong> &middot; ${contactLinks(phone)}</p><p><strong>Best time:</strong> ${esc(bestTime) || 'Not given'}</p><p><strong>Their message:</strong><br>${esc(message).replace(/\n/g, '<br>')}</p><p><strong>Email:</strong> ${esc(email || state.email) || 'Not given'}</p><hr><small>Left through the AI chat assistant. Mark it called in HQ &gt; Callbacks. The full conversation is in HQ &gt; Chats.</small>`
        });
        return { requested: true, note: 'Tell the visitor the team will call them back. Do not promise a time.' };
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
          html: `<h2>Appointment request from the website chat</h2><p><strong>${esc(kind)}</strong> on <strong>${esc(date)}</strong> at <strong>${esc(time)}</strong> (Tehachapi time)</p><p><strong>Name:</strong> ${esc(state.leadName)}<br><strong>Phone:</strong> ${contactLinks(state.phone)}<br><strong>Email:</strong> ${esc(state.email) || 'Not given'}</p><p><strong>Notes:</strong> ${esc(notes) || 'None'}</p><p>This is a request. Confirm it with the visitor, then mark it confirmed in HQ.</p>`
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
            html: `<h2>The chat assistant asked for a person</h2><p><strong>Reason:</strong> ${esc(reason)}</p><p><strong>Visitor:</strong> ${esc(state.leadName) || 'No contact details yet'} ${state.phone ? contactLinks(state.phone) : ''}</p><p>Open HQ &gt; Chats to read the conversation.</p>`
          });
        }
        state.needsHuman = true;
        return { flagged: true, note: `Tell the visitor the team will follow up, and give the phone number ${FACTS.phone}.` };
      }
    };

    // 4. Ask the model.
    const system = buildSystemPrompt({
      today: localNow().date, turn, contactSaved: Boolean(state.leadId), appointmentCount: state.appointments,
      callbackRequested: state.callbacks > 0, needsHuman: state.needsHuman, channel, senderPhone
    });
    let reply = '', modelError = '';
    try {
      reply = await runTurn({ system, history: [...past, { role: 'user', content: message }], handlers, maxTokens: channel === 'sms' ? 300 : undefined });
    } catch (err) {
      modelError = `${errTag(err)}${err?.detail ? ` ${err.detail}` : ''}`;
      console.error('Chat model error:', modelError);
    }
    let failed = false;
    if (!reply) { failed = true; reply = `Sorry, I had trouble with that. ${CALL}`; }
    if (failed) {
      // Never lose a lead to an outage: flag the chat, save any contact the visitor typed, and email the team once.
      try {
        const found = salvageContact(message);
        const phone = found.phone || (channel === 'sms' ? senderPhone : '');
        if (phone && !state.leadId) {
          const bad = await upsertLead({ name: 'Chat visitor (name not captured)', phone, email: found.email, interest: 'Chat message (auto-captured)', notes: str(message, 1500) });
          if (bad) console.error('Chat salvage: lead not saved');
        }
        await supabase(db, `conversations?id=eq.${sidQ}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ needs_human: true, handoff_reason: `The assistant could not answer; the visitor needs a person${modelError ? ` (${modelError})` : ''}`, resolved: false })
        }, DB_TIMEOUT_MS);
        if (!state.needsHuman) {
          await notifyStaff({
            subject: `[Chat needs a person] ${phone || found.email || 'no contact details yet'}`,
            html: `<h2>The chat assistant could not answer</h2><p><strong>Visitor wrote:</strong><br>${esc(str(message, 600)).replace(/\n/g, '<br>')}</p><p><strong>Phone:</strong> ${phone ? contactLinks(phone) : 'Not given'}<br><strong>Email:</strong> ${found.email ? `<a href="mailto:${esc(found.email)}">${esc(found.email)}</a>` : 'Not given'}</p><p>Open HQ &gt; Chats to read the conversation.</p>`
          });
        }
        if (phone && channel !== 'sms') reply = `Thanks. I passed your message to our team and they will call you back. You can also call ${FACTS.phone}.`;
      } catch (err) {
        console.error('Chat salvage failed:', errTag(err));
      }
    }
    reply = channel === 'sms'
      ? (turn === 1 ? textLength(reply, SMS_MAX - SMS_FIRST_FOOTER.length) + SMS_FIRST_FOOTER : textLength(reply))
      : reply.slice(0, 1500);

    // 5. Store the reply and bump the conversation.
    await supabase(db, 'messages', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ conversation_id: sid, role: 'assistant', content: reply })
    }, DB_TIMEOUT_MS);
    await supabase(db, `conversations?id=eq.${sidQ}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ message_count: conv.message_count + 1, last_message_at: new Date().toISOString() })
    }, DB_TIMEOUT_MS);

    return { reply, done: turn >= MAX_VISITOR_MESSAGES };
}
