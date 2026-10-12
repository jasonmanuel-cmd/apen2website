// Vercel Serverless Function: /api/hq/chat
// Staff view of the website chat assistant, for the /hq dashboard.
//   GET   ?view=conversations [&filter=all|human] [&limit=50]   -> conversations (+ lead name/phone) and counts
//   GET   ?view=messages&id=<conversation id>                   -> that conversation's messages, oldest first
//   GET   ?view=appointments [&status=open|all|<status>]        -> appointment requests
//   PATCH ?view=appointments&id=<uuid>  { status?, staff_notes? }
//   PATCH ?view=conversations&id=<id>   { resolved? }
// Access: Authorization: Bearer <STAFF_TOKEN>, same password as /staff/ and the rest of /hq.
// Never cached, same-origin only, and errors never echo database messages or visitor text.
import { createHash, timingSafeEqual } from 'node:crypto';
import { supabaseConfig, supabase } from '../../lib/supabase-rest.js';

const MIN_TOKEN = 20;
const APPT_STATUSES = ['requested', 'confirmed', 'completed', 'cancelled', 'no_show'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SID = /^[A-Za-z0-9-]{16,64}$/;
const str = (v, max = 200) => (v == null ? '' : String(v)).trim().slice(0, max);
const errTag = (err) => String((err && (err.code || err.name)) || 'error');
const sha = (s) => createHash('sha256').update(s).digest();

const authorized = (req) => {
  const given = str(req.headers && req.headers.authorization, 600).replace(/^Bearer\s+/i, '');
  return given.length > 0 && timingSafeEqual(sha(given), sha(process.env.STAFF_TOKEN));
};
const total = (res) => {
  const n = Number(String(res.headers.get('content-range') || '').split('/')[1]);
  return Number.isFinite(n) ? n : null;
};
const count = (db, path) => supabase(db, `${path}&select=id&limit=1`, { headers: { Prefer: 'count=exact' } }).then(total, () => null);

const out = (res, code, body) => res.status(code).json(body);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.method !== 'GET' && req.method !== 'PATCH') {
    res.setHeader('Allow', 'GET, PATCH');
    return out(res, 405, { ok: false, error: 'Method not allowed.' });
  }
  if (str(process.env.STAFF_TOKEN, 600).length < MIN_TOKEN) {
    console.error(`HQ chat: STAFF_TOKEN missing or shorter than ${MIN_TOKEN} characters; endpoint is closed.`);
    return out(res, 503, { ok: false, error: 'The dashboard is not set up yet.' });
  }
  if (!authorized(req)) return out(res, 401, { ok: false, error: 'Wrong or missing password.' });
  const db = supabaseConfig();
  if (!db) return out(res, 503, { ok: false, error: 'The database is not connected.' });

  const q = req.query || {};
  const view = str(q.view, 20);
  try {
    if (req.method === 'GET') {
      if (view === 'conversations') {
        const limit = Math.min(100, Math.max(1, parseInt(q.limit, 10) || 50));
        const humanOnly = str(q.filter, 10) === 'human';
        const p = new URLSearchParams({
          select: 'id,channel,created_at,last_message_at,message_count,lead_id,needs_human,handoff_reason,resolved',
          order: 'last_message_at.desc', limit: String(limit)
        });
        if (humanOnly) { p.append('needs_human', 'eq.true'); p.append('resolved', 'eq.false'); }
        const convs = await (await supabase(db, `conversations?${p}`)).json();
        const ids = [...new Set(convs.map((c) => c.lead_id).filter((id) => UUID.test(String(id))))];
        const leads = new Map();
        if (ids.length) {
          const ls = await (await supabase(db, `leads?select=id,name,phone,email&id=in.(${ids.join(',')})`)).json();
          for (const l of ls) leads.set(l.id, l);
        }
        const [needHuman, openAppts] = await Promise.all([
          count(db, 'conversations?needs_human=eq.true&resolved=eq.false'),
          count(db, 'appointments?status=eq.requested')
        ]);
        return out(res, 200, {
          ok: true, needHuman, openAppointments: openAppts,
          conversations: convs.map((c) => ({ ...c, lead: leads.get(c.lead_id) || null }))
        });
      }
      if (view === 'messages') {
        const id = str(q.id, 64);
        if (!SID.test(id)) return out(res, 400, { ok: false, error: 'Bad conversation id.' });
        const messages = await (await supabase(db, `messages?conversation_id=eq.${encodeURIComponent(id)}&select=role,content,created_at&order=id.asc&limit=200`)).json();
        return out(res, 200, { ok: true, messages });
      }
      if (view === 'appointments') {
        const status = str(q.status, 12) || 'open';
        const p = new URLSearchParams({
          select: 'id,created_at,conversation_id,name,phone,email,kind,preferred_date,preferred_time,notes,status,staff_notes',
          order: 'preferred_date.asc,preferred_time.asc', limit: '100'
        });
        if (status === 'open') p.append('status', 'in.(requested,confirmed)');
        else if (status !== 'all') {
          if (!APPT_STATUSES.includes(status)) return out(res, 400, { ok: false, error: 'Unknown status.' });
          p.append('status', `eq.${status}`);
        }
        const appointments = await (await supabase(db, `appointments?${p}`)).json();
        return out(res, 200, { ok: true, appointments });
      }
      return out(res, 400, { ok: false, error: 'Unknown view.' });
    }

    // PATCH
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return out(res, 400, { ok: false, error: 'Invalid request.' });
    const id = str(q.id, 64);

    if (view === 'appointments') {
      if (!UUID.test(id)) return out(res, 400, { ok: false, error: 'Bad appointment id.' });
      const patch = {};
      if (body.status !== undefined) {
        if (!APPT_STATUSES.includes(body.status)) return out(res, 400, { ok: false, error: 'Unknown status.' });
        patch.status = body.status;
      }
      if (body.staff_notes !== undefined) patch.staff_notes = str(body.staff_notes, 2000) || null;
      if (!Object.keys(patch).length) return out(res, 400, { ok: false, error: 'Nothing to update.' });
      const r = await (await supabase(db, `appointments?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) })).json();
      if (!r.length) return out(res, 404, { ok: false, error: 'Not found.' });
      return out(res, 200, { ok: true, appointment: r[0] });
    }
    if (view === 'conversations') {
      if (!SID.test(id)) return out(res, 400, { ok: false, error: 'Bad conversation id.' });
      if (typeof body.resolved !== 'boolean') return out(res, 400, { ok: false, error: 'Nothing to update.' });
      const r = await (await supabase(db, `conversations?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ resolved: body.resolved }) })).json();
      if (!r.length) return out(res, 404, { ok: false, error: 'Not found.' });
      return out(res, 200, { ok: true, conversation: r[0] });
    }
    return out(res, 400, { ok: false, error: 'Unknown view.' });
  } catch (err) {
    console.error('HQ chat database error:', errTag(err));
    return out(res, 502, { ok: false, error: 'Could not reach the database.' });
  }
}
