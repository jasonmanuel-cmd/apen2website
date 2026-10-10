// Vercel Serverless Function: /api/staff/leads
// Staff-only lead inbox API over Supabase public.leads.
//   GET   ?status=new|contacted|...|all  &unsent=1  &q=text  &limit=50  &offset=0   -> list + counts
//   PATCH ?id=<uuid>  { status?, staff_notes?, assigned_to?, follow_up_at? }       -> updated lead
// Access: Authorization: Bearer <STAFF_TOKEN>. With no (or a short) STAFF_TOKEN the endpoint stays closed.
// Staff can change only the follow-up fields below; contact details and what the buyer wrote are read-only here.
// Same-origin only (no CORS headers), never cached, and errors never echo database messages or lead data.
import { createHash, timingSafeEqual } from 'node:crypto';
import { supabaseConfig, supabase } from '../../lib/supabase-rest.js';

const STATUSES = ['new', 'contacted', 'qualified', 'nurturing', 'won', 'lost', 'spam', 'test'];
// Everything the inbox shows. Deliberately leaves out `raw` and the generated phone_digits column.
const COLUMNS = [
  'id', 'created_at', 'name', 'phone', 'email', 'interest', 'plan', 'community', 'contact_pref', 'stage',
  'buy_window', 'budget', 'first_time', 'military', 'notes', 'source', 'origin_domain', 'email_sent',
  'email_error', 'status', 'assigned_to', 'contacted_at', 'follow_up_at', 'staff_notes'
].join(',');
const EDITABLE = ['status', 'staff_notes', 'assigned_to', 'follow_up_at'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_TOKEN = 20;
const FAIL_DELAY_MS = 300; // slows password guessing a little; the token is long and random anyway

const str = (v, max = 200) => (v == null ? '' : String(v)).trim().slice(0, max);
const errTag = (err) => String((err && (err.code || err.name)) || 'error');
const sha = (s) => createHash('sha256').update(s).digest();

const authorized = (req) => {
  const given = str(req.headers && req.headers.authorization, 600).replace(/^Bearer\s+/i, '');
  return given.length > 0 && timingSafeEqual(sha(given), sha(process.env.STAFF_TOKEN));
};

// Search terms go into a PostgREST or() filter, so keep only plain characters (no commas, parentheses or wildcards).
const cleanQuery = (q) => str(q, 80).replace(/[^\p{L}\p{N} @.+_-]/gu, '').trim().slice(0, 60);

const total = (res) => {
  const n = Number(String(res.headers.get('content-range') || '').split('/')[1]);
  return Number.isFinite(n) ? n : null;
};

const listLeads = async (db, query) => {
  const status = str(query.status, 20) || 'new';
  if (status !== 'all' && !STATUSES.includes(status)) return { code: 400, body: { ok: false, error: 'Unknown status.' } };
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
  const offset = Math.max(0, parseInt(query.offset, 10) || 0);

  const p = new URLSearchParams({ select: COLUMNS, order: 'created_at.desc', limit: String(limit), offset: String(offset) });
  if (status !== 'all') p.append('status', `eq.${status}`);
  if (str(query.unsent, 5) === '1') p.append('email_sent', 'eq.false');
  const q = cleanQuery(query.q);
  if (q) {
    const digits = q.replace(/\D/g, '');
    p.append('or', `(name.ilike.*${q}*,email.ilike.*${q}*${digits.length >= 3 ? `,phone_digits.like.*${digits}*` : ''})`);
  }

  const count = (filter) => supabase(db, `leads?select=id&limit=1&${filter}`, { headers: { Prefer: 'count=exact' } })
    .then(total, () => null);
  const [res, newCount, unsentCount] = await Promise.all([
    supabase(db, `leads?${p}`, { headers: { Prefer: 'count=exact' } }),
    count('status=eq.new'),
    count('email_sent=eq.false&status=not.in.(spam,test)')
  ]);
  return { code: 200, body: { ok: true, leads: await res.json(), total: total(res), newCount, unsentCount, limit, offset } };
};

const validateEdit = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Send a JSON object.' };
  const keys = Object.keys(body);
  if (!keys.length) return { error: 'Nothing to change.' };
  const unknown = keys.filter((k) => !EDITABLE.includes(k));
  if (unknown.length) return { error: 'Only status, staff_notes, assigned_to and follow_up_at can be changed.' };
  const patch = {};
  if ('status' in body) {
    if (!STATUSES.includes(body.status)) return { error: 'Unknown status.' };
    patch.status = body.status;
  }
  if ('staff_notes' in body) {
    if (body.staff_notes != null && typeof body.staff_notes !== 'string') return { error: 'Notes must be text.' };
    if (body.staff_notes && body.staff_notes.length > 3000) return { error: 'Notes are limited to 3,000 characters.' };
    patch.staff_notes = str(body.staff_notes, 3000) || null;
  }
  if ('assigned_to' in body) {
    if (body.assigned_to != null && typeof body.assigned_to !== 'string') return { error: 'Assigned to must be text.' };
    if (body.assigned_to && body.assigned_to.trim().length > 60) return { error: 'Assigned to is limited to 60 characters.' };
    patch.assigned_to = str(body.assigned_to, 60) || null;
  }
  if ('follow_up_at' in body) {
    const d = body.follow_up_at;
    if (d === null || d === '') patch.follow_up_at = null;
    else if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`))
      && new Date(`${d}T12:00:00Z`).toISOString().startsWith(d)) patch.follow_up_at = `${d}T12:00:00Z`;
    else return { error: 'Follow-up must be a date like 2026-10-15.' };
  }
  return { patch };
};

const editLead = async (db, id, body) => {
  if (!UUID.test(id)) return { code: 400, body: { ok: false, error: 'Invalid lead id.' } };
  const { patch, error } = validateEdit(body);
  if (error) return { code: 400, body: { ok: false, error } };

  const res = await supabase(db, `leads?id=eq.${id}&select=${COLUMNS}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch)
  });
  let [lead] = await res.json();
  if (!lead) return { code: 404, body: { ok: false, error: 'Lead not found.' } };

  // First time a lead is marked contacted, stamp when. Later status changes leave the original time alone.
  if (patch.status === 'contacted' && !lead.contacted_at) {
    try {
      const r2 = await supabase(db, `leads?id=eq.${id}&contacted_at=is.null&select=${COLUMNS}`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ contacted_at: new Date().toISOString() })
      });
      lead = (await r2.json())[0] || lead;
    } catch (err) {
      console.error('Could not stamp contacted_at:', errTag(err));
    }
  }
  return { code: 200, body: { ok: true, lead } };
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.method !== 'GET' && req.method !== 'PATCH') {
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }
  if (str(process.env.STAFF_TOKEN, 600).length < MIN_TOKEN) {
    console.error(`Staff inbox: STAFF_TOKEN missing or shorter than ${MIN_TOKEN} characters; endpoint is closed.`);
    return res.status(503).json({ ok: false, error: 'The staff inbox is not set up yet.' });
  }
  if (!authorized(req)) {
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    return res.status(401).json({ ok: false, error: 'Wrong or missing password.' });
  }
  const db = supabaseConfig();
  if (!db) {
    console.error('Staff inbox: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.');
    return res.status(503).json({ ok: false, error: 'The lead database is not connected.' });
  }

  try {
    let out;
    if (req.method === 'GET') {
      out = await listLeads(db, req.query || {});
    } else {
      let body;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      } catch {
        return res.status(400).json({ ok: false, error: 'Invalid request.' });
      }
      out = await editLead(db, str(req.query && req.query.id, 60), body);
    }
    return res.status(out.code).json(out.body);
  } catch (err) {
    console.error('Staff inbox database error:', errTag(err));
    return res.status(502).json({ ok: false, error: 'Could not reach the lead database.' });
  }
}
