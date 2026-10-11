// Run: npm test. Checks the staff lead inbox API (/api/staff/leads) with Supabase mocked: nothing is contacted.
import assert from 'node:assert';
import handler from '../api/staff/leads.js';

const TOKEN = 'staff-token-for-tests-0123456789';
const SB = 'https://abc123.supabase.co';
const ID = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
const errs = []; console.error = (...a) => errs.push(a.join(' ')); console.log = () => {};

const run = async ({ method = 'GET', query = {}, body, auth = `Bearer ${TOKEN}` } = {}) => {
  const out = { headers: {} };
  const res = { setHeader(k, v) { out.headers[k] = v; }, status(c) { out.code = c; return this; }, json(j) { out.body = j; return this; } };
  await handler({ method, query, body, headers: auth === null ? {} : { authorization: auth } }, res);
  return out;
};

const calls = [];
// db: 'ok' | 'fail' | 'throw'; patchRows: what a PATCH returns (rows) in order
const world = ({ db = 'ok', rows = [], patchRows = [] } = {}) => {
  calls.length = 0; const patches = [...patchRows];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body, headers: opts.headers });
    if (db === 'throw') throw new Error('network down for sb_secret_test');
    if (db === 'fail') return { ok: false, status: 503, headers: new Headers(), json: async () => ({ message: 'sb_secret_test leaked' }) };
    if (opts.method === 'PATCH') return { ok: true, status: 200, headers: new Headers(), json: async () => patches.shift() ?? [] };
    return { ok: true, status: 200, headers: new Headers({ 'content-range': '0-0/7' }), json: async () => rows };
  };
};
process.env.STAFF_TOKEN = TOKEN;
process.env.SUPABASE_URL = SB; process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
const lead = (o = {}) => ({ id: ID, name: 'Pat', phone: '555-0100', status: 'new', contacted_at: null, ...o });
const patchBody = (i = 0) => JSON.parse(calls.filter((c) => c.method === 'PATCH')[i].body);

// --- access control -------------------------------------------------------
world(); let r = await run({ method: 'POST' }); assert.equal(r.code, 405); assert.equal(calls.length, 0);
for (const bad of [null, '', 'Bearer', 'Bearer wrong', TOKEN.slice(0, -1)]) {
  world(); r = await run({ auth: bad === null ? null : bad });
  assert.equal(r.code, 401, `auth ${bad}`); assert.equal(calls.length, 0);
}
world(); r = await run({ method: 'PATCH', query: { id: ID }, body: { status: 'won' }, auth: 'Bearer nope' });
assert.equal(r.code, 401); assert.equal(calls.length, 0);          // unauthorized writes never reach the database
// closed when the token is missing or too short, even for a "correct" guess
for (const t of [undefined, '', 'short']) {
  if (t === undefined) delete process.env.STAFF_TOKEN; else process.env.STAFF_TOKEN = t;
  world(); r = await run({ auth: `Bearer ${t || ''}` }); assert.equal(r.code, 503); assert.equal(calls.length, 0);
}
process.env.STAFF_TOKEN = TOKEN;
// Supabase not configured
const keep = process.env.SUPABASE_URL; delete process.env.SUPABASE_URL;
world(); r = await run(); assert.equal(r.code, 503); process.env.SUPABASE_URL = keep;
// responses are never cached or indexed
world({ rows: [lead()] }); r = await run();
assert.equal(r.headers['Cache-Control'], 'no-store'); assert.match(r.headers['X-Robots-Tag'], /noindex/);
assert.ok(!errs.join('\n').includes(TOKEN));

// --- listing --------------------------------------------------------------
world({ rows: [lead()] }); r = await run();
assert.equal(r.code, 200); assert.equal(r.body.ok, true); assert.equal(r.body.leads.length, 1);
assert.equal(r.body.total, 7); assert.equal(r.body.newCount, 7); assert.equal(r.body.unsentCount, 7);
const main = calls[0].url; assert.ok(main.startsWith(`${SB}/rest/v1/leads?`));
assert.ok(main.includes('status=eq.new') && main.includes('order=created_at.desc') && main.includes('limit=50'));
assert.ok(!/select=[^&]*\braw\b/.test(decodeURIComponent(main)) && !/phone_digits/.test(decodeURIComponent(main).split('&or=')[0]));
assert.equal(calls[0].headers.apikey, 'sb_secret_test'); assert.equal(calls[0].headers.Authorization, undefined);
// filters: status all, unsent, limit clamp, search sanitised (cannot add its own filter clauses)
world({ rows: [] }); r = await run({ query: { status: 'all', unsent: '1', limit: '9999', offset: '-5', q: 'Smith,status.eq.won)(*%' } });
let u = decodeURIComponent(calls[0].url);
assert.ok(!u.includes('status=eq.') && u.includes('email_sent=eq.false') && u.includes('limit=100') && u.includes('offset=0'));
const or = u.match(/or=(\(.*?\))(&|$)/)[1];
assert.equal(or, '(name.ilike.*Smithstatus.eq.won*,email.ilike.*Smithstatus.eq.won*)');
world({ rows: [] }); await run({ query: { status: 'all', q: '(661) 555-0100' } });
assert.ok(decodeURIComponent(calls[0].url).includes('phone_digits.like.*6615550100*'));
world(); r = await run({ query: { status: 'bogus' } }); assert.equal(r.code, 400); assert.equal(calls.length, 0);
// a failed count never fails the list
world({ rows: [lead()] }); const real = globalThis.fetch;
globalThis.fetch = async (url, o) => (String(url).includes('limit=1&') ? { ok: false, status: 500, headers: new Headers() } : real(url, o));
r = await run(); assert.equal(r.code, 200); assert.equal(r.body.newCount, null);

// --- edits: validation happens before any database call ---------------------
const bad = [
  [{ id: 'not-a-uuid' }, { status: 'won' }],
  [{ id: `${ID}' or '1'='1` }, { status: 'won' }],
  [{ id: ID }, null], [{ id: ID }, []], [{ id: ID }, 'text'], [{ id: ID }, 42], [{ id: ID }, {}],
  [{ id: ID }, '{not json'],
  [{ id: ID }, { name: 'Hacked' }], [{ id: ID }, { status: 'won', email: 'x@y.z' }], [{ id: ID }, { email_sent: true }],
  [{ id: ID }, { status: 'bogus' }], [{ id: ID }, { status: 5 }], [{ id: ID }, { status: ['won'] }],
  [{ id: ID }, { staff_notes: 'x'.repeat(3001) }], [{ id: ID }, { staff_notes: 12 }],
  [{ id: ID }, { assigned_to: 'x'.repeat(61) }], [{ id: ID }, { assigned_to: {} }],
  [{ id: ID }, { follow_up_at: 'tomorrow' }], [{ id: ID }, { follow_up_at: '2026-02-30' }], [{ id: ID }, { follow_up_at: 20261015 }]
];
for (const [query, body] of bad) {
  world(); r = await run({ method: 'PATCH', query, body });
  assert.equal(r.code, 400, JSON.stringify([query, body])); assert.equal(calls.length, 0, 'no database access on invalid edit');
}

// --- edits: success, 404, contacted stamp ------------------------------------
world({ patchRows: [[lead({ status: 'qualified', staff_notes: 'Called', assigned_to: 'Ryan', follow_up_at: '2026-10-15T12:00:00+00:00' })]] });
r = await run({ method: 'PATCH', query: { id: ID }, body: { status: 'qualified', staff_notes: '  Called  ', assigned_to: ' Ryan ', follow_up_at: '2026-10-15' } });
assert.equal(r.code, 200); assert.equal(r.body.lead.status, 'qualified');
assert.equal(calls.length, 1); assert.equal(calls[0].method, 'PATCH');
assert.ok(calls[0].url.startsWith(`${SB}/rest/v1/leads?id=eq.${ID}&`));
assert.deepEqual(patchBody(), { status: 'qualified', staff_notes: 'Called', assigned_to: 'Ryan', follow_up_at: '2026-10-15T12:00:00Z' });
// clearing fields
world({ patchRows: [[lead()]] }); await run({ method: 'PATCH', query: { id: ID }, body: { staff_notes: '', assigned_to: '', follow_up_at: null } });
assert.deepEqual(patchBody(), { staff_notes: null, assigned_to: null, follow_up_at: null });
// body arriving as a JSON string (some runtimes) works
world({ patchRows: [[lead()]] }); r = await run({ method: 'PATCH', query: { id: ID }, body: JSON.stringify({ status: 'lost' }) }); assert.equal(r.code, 200);
// missing record
world({ patchRows: [[]] }); r = await run({ method: 'PATCH', query: { id: ID }, body: { status: 'won' } });
assert.equal(r.code, 404); assert.equal(r.body.ok, false);
// first "contacted" stamps contacted_at once; a lead already contacted is not re-stamped
world({ patchRows: [[lead({ status: 'contacted' })], [lead({ status: 'contacted', contacted_at: '2026-10-09T10:00:00Z' })]] });
r = await run({ method: 'PATCH', query: { id: ID }, body: { status: 'contacted' } });
assert.equal(calls.length, 2); assert.ok(calls[1].url.includes('contacted_at=is.null'));
assert.ok(!Number.isNaN(Date.parse(patchBody(1).contacted_at))); assert.equal(r.body.lead.contacted_at, '2026-10-09T10:00:00Z');
world({ patchRows: [[lead({ status: 'contacted', contacted_at: '2026-10-01T10:00:00Z' })]] });
await run({ method: 'PATCH', query: { id: ID }, body: { status: 'contacted' } }); assert.equal(calls.length, 1);
// the stamp is best effort: if it fails the edit still succeeds
world({ patchRows: [[lead({ status: 'contacted' })]] }); const base = globalThis.fetch; let n = 0;
globalThis.fetch = async (u2, o) => (o?.method === 'PATCH' && ++n === 2 ? Promise.reject(new Error('boom')) : base(u2, o));
r = await run({ method: 'PATCH', query: { id: ID }, body: { status: 'contacted' } }); assert.equal(r.code, 200);

// --- database failures: generic error, no leakage ----------------------------
for (const db of ['fail', 'throw']) {
  for (const req of [{}, { method: 'PATCH', query: { id: ID }, body: { status: 'won' } }]) {
    world({ db }); errs.length = 0; r = await run(req);
    assert.equal(r.code, 502); assert.equal(r.body.ok, false);
    assert.ok(!JSON.stringify(r.body).includes('sb_secret') && !errs.join('\n').includes('sb_secret'));
  }
}
console.log = (...a) => process.stdout.write(a.join(' ') + '\n');
console.log('ALL STAFF INBOX TESTS PASSED');
