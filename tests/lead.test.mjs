// Run: npm test. Checks the lead form handler with Resend mocked (no email is sent).
import assert from 'node:assert';
import handler from '../api/lead.js';

const run = async (body, headers = {}) => {
  const out = { headers: {} };
  const res = { setHeader(k, v) { out.headers[k] = v; }, status(c) { out.code = c; return this; }, json(j) { out.body = j; return this; }, end(b) { out.html = b; return this; } };
  await handler({ method: 'POST', body, headers }, res);
  return out;
};
const lead = { name: 'Test <b>Buyer</b>', phone: '555-0100', email: 'buyer@example.com', plan: 'Sunset Retreat', timeline: 'Reserve', notes: 'hi' };
const log = console.log; console.log = () => {}; console.error = () => {};

// 1. no key: nothing can be delivered, so the visitor is told to call
delete process.env.RESEND_API_KEY;
let r = await run(lead); assert.equal(r.code, 503); assert.equal(r.body.success, false);
// 2. missing phone rejected
r = await run({ name: 'x' }); assert.equal(r.code, 400);
// 3. key set, Resend OK: email built correctly and escaped
process.env.RESEND_API_KEY = 'test';
let sent; globalThis.fetch = async (_url, opts) => { sent = JSON.parse(opts.body); return { ok: true }; };
r = await run(lead); assert.equal(r.code, 200); assert.equal(r.body.emailDispatched, true);
assert.equal(sent.from, 'Aspen II Homes <onboarding@resend.dev>');
assert.deepEqual(sent.to, ['Aspen2homes@gmail.com']);
assert.equal(sent.reply_to, 'buyer@example.com');
assert.ok(sent.html.includes('Test &lt;b&gt;Buyer&lt;/b&gt;') && !sent.html.includes('<b>Buyer'));
// Routing tags and optional fields reach the email.
r = await run({ ...lead, timeline: 'Reserve & customize a Sunset Retreat home', military: 'yes', budget: '$400K to $500K' });
assert.ok(sent.subject.startsWith('[New Lead][Sunset Retreat][Military/VA] Test'));
assert.ok(sent.html.includes('$400K to $500K'));
// 4. key set, Resend fails: visitor told to call
globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => 'forbidden' });
r = await run(lead); assert.equal(r.code, 502);

// 5. crash cases found in audit: non-string fields, broken JSON, junk email, oversized notes
globalThis.fetch = async (_url, opts) => { sent = JSON.parse(opts.body); return { ok: true }; };
r = await run({ name: 123, phone: 456 }); assert.equal(r.code, 200);
r = await run('{bad'); assert.equal(r.code, 400);
r = await run(['array']); assert.equal(r.code, 400);
r = await run({ ...lead, email: 'not-an-email' }); assert.equal(r.code, 200); assert.equal(sent.reply_to, undefined);
r = await run({ ...lead, notes: 'x'.repeat(100000) }); assert.ok(sent.html.length < 6000);
r = await run({ ...lead, honeypot: 1 }); assert.equal(r.code, 200); // bot: fake success
// 6. only POST allowed, no CORS headers
const hdrs = {}; let code;
await handler({ method: 'OPTIONS' }, { setHeader(k, v) { hdrs[k] = v; }, status(c) { code = c; return this; }, json() { return this; }, end() { return this; } });
assert.equal(code, 405); assert.equal(Object.keys(hdrs).length, 0);

// Several recipients: each gets its own email; one rejected address doesn't block the rest.
process.env.NOTIFICATION_EMAIL = 'owner@example.com, partner@example.com';
const tos = []; globalThis.fetch = async (_u, o) => { const t = JSON.parse(o.body).to[0]; tos.push(t); return { ok: t === 'owner@example.com', status: 403, text: async () => 'test sender' }; };
r = await run(lead); assert.equal(r.code, 200); assert.deepEqual(tos.sort(), ['owner@example.com', 'partner@example.com']);
delete process.env.NOTIFICATION_EMAIL;

// Plain HTML form post (no JavaScript): success redirects to the thank-you page, failure returns a readable page.
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
globalThis.fetch = async () => ({ ok: true });
r = await run(lead, FORM); assert.equal(r.code, 303); assert.equal(r.headers.Location, '/thank-you/');
r = await run({ name: 'x' }, FORM); assert.equal(r.code, 400); assert.ok(r.html.includes('(661) 238-3136'));
r = await run({ ...lead, honeypot: 'bot' }, FORM); assert.equal(r.code, 303);

// Database (Supabase REST). One fetch mock answers both Supabase (/rest/v1/leads) and Resend.
const SB = 'https://abc123.supabase.co';
process.env.SUPABASE_URL = SB;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
const events = [];
const ID = '11111111-1111-1111-1111-111111111111';
const mockWorld = ({ db = 'ok', resend = 'ok' } = {}) => {
  events.length = 0;
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith(`${SB}/rest/v1/leads`)) {
      events.push({ type: 'db', method: opts.method, url: String(url), headers: opts.headers, body: JSON.parse(opts.body) });
      if (db === 'throw') throw new Error('network down for Secret Name');
      if (db === 'fail') return { ok: false, status: 503, json: async () => ({ message: 'Secret Name was in this error' }) };
      return { ok: true, status: opts.method === 'POST' ? 201 : 204, json: async () => [{ id: ID }] };
    }
    events.push({ type: 'email' });
    return { ok: resend === 'ok', status: 403, text: async () => 'forbidden' };
  };
};
const dbEvents = () => events.filter((e) => e.type === 'db');
process.env.RESEND_API_KEY = 'test';
const full = { ...lead, community: 'Tehachapi', contactPref: 'phone', stage: 'Looking', when: '3-6 months', budget: '$400K', firstTime: 'yes', source: 'Contact page' };

// 7. stored first, then emailed, then the email outcome is recorded on the row
mockWorld();
r = await run(full, { host: 'aspen2homes.com:443' });
assert.equal(r.code, 200); assert.equal(r.body.saved, true); assert.equal(r.body.emailDispatched, true);
assert.deepEqual(events.map((e) => e.type), ['db', 'email', 'db']);
const [ins, upd] = dbEvents();
assert.equal(ins.method, 'POST'); assert.equal(ins.url, `${SB}/rest/v1/leads?select=id`);
assert.equal(ins.headers.apikey, 'sb_secret_test'); assert.equal(ins.headers.Authorization, undefined);
assert.equal(ins.body.name, 'Test <b>Buyer</b>', 'raw (unescaped) name is stored; escaping is for the email only');
assert.equal(ins.body.origin_domain, 'aspen2homes.com'); assert.equal(ins.body.source, 'Contact page');
assert.equal(ins.body.first_time, true); assert.equal(ins.body.military, false); assert.equal(ins.body.buy_window, '3-6 months');
assert.equal(upd.method, 'PATCH'); assert.equal(upd.url, `${SB}/rest/v1/leads?id=eq.${ID}`);
assert.deepEqual(upd.body, { email_sent: true, email_error: null });
// Legacy service_role keys are JWTs and also go in the Authorization header.
process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOi.payload.sig'; mockWorld(); await run(lead);
assert.equal(dbEvents()[0].headers.Authorization, 'Bearer eyJhbGciOi.payload.sig');
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
// Optional fields the visitor left blank are stored as NULL, not empty strings.
mockWorld(); await run({ name: 'Solo', phone: '555-0101' });
assert.equal(dbEvents()[0].body.email, null); assert.equal(dbEvents()[0].body.community, null);
assert.ok(Object.values(dbEvents()[0].body).every((v) => v !== ''));
// The response never exposes the row id.
mockWorld(); r = await run(lead); assert.ok(!JSON.stringify(r.body).includes(ID));

// 8. email down but lead stored: visitor still succeeds, the failure is recorded on the row
mockWorld({ resend: 'fail' }); r = await run(lead);
assert.equal(r.code, 200); assert.equal(r.body.saved, true); assert.equal(r.body.emailDispatched, false);
assert.deepEqual(dbEvents()[1].body, { email_sent: false, email_error: 'Resend rejected or unreachable' });
// ...and with no Resend key at all
delete process.env.RESEND_API_KEY; mockWorld(); r = await run(lead);
assert.equal(r.code, 200); assert.equal(r.body.saved, true); assert.deepEqual(dbEvents()[1].body, { email_sent: false, email_error: 'RESEND_API_KEY not set' });
process.env.RESEND_API_KEY = 'test';

// 9. database down (error response, or the request itself throws) but email works: lead is emailed, no update is attempted
for (const db of ['fail', 'throw']) {
  mockWorld({ db }); r = await run(lead);
  assert.equal(r.code, 200); assert.equal(r.body.saved, false); assert.equal(r.body.emailDispatched, true);
  assert.equal(dbEvents().length, 1);
}
// 10. both down: only now does the visitor see a failure
mockWorld({ db: 'fail', resend: 'fail' }); r = await run(lead); assert.equal(r.code, 502);
delete process.env.RESEND_API_KEY; mockWorld({ db: 'fail' }); r = await run(lead); assert.equal(r.code, 503);
process.env.RESEND_API_KEY = 'test';

// 11. bots and invalid posts never touch the database
mockWorld(); await run({ ...lead, honeypot: 'bot' }); await run({ name: 'x' }); await run('{bad');
assert.equal(dbEvents().length, 0);

// 12. database errors never put submitted values in the logs
const errs = []; console.error = (...a) => errs.push(a.join(' '));
for (const db of ['fail', 'throw']) { mockWorld({ db }); await run({ ...lead, name: 'Secret Name', phone: '999-SECRET' }); }
assert.ok(errs.length > 0 && errs.every((e) => !e.includes('Secret') && !e.includes('SECRET')));
console.error = () => {};

// 13. missing or half-set Supabase config must not break the form: the lead is still emailed
const goodUrl = process.env.SUPABASE_URL, goodKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_URL; mockWorld(); r = await run(lead);
assert.equal(r.code, 200); assert.equal(r.body.saved, false); assert.equal(r.body.emailDispatched, true); assert.equal(dbEvents().length, 0);
process.env.SUPABASE_URL = goodUrl; delete process.env.SUPABASE_SERVICE_ROLE_KEY; mockWorld(); r = await run(lead);
assert.equal(r.code, 200); assert.equal(r.body.saved, false); assert.equal(dbEvents().length, 0);
process.env.SUPABASE_SERVICE_ROLE_KEY = goodKey;

log('ALL LEAD TESTS PASSED (33 cases)');
