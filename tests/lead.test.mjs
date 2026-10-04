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

log('ALL LEAD TESTS PASSED (16 cases)');
