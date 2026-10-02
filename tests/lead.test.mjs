// Run: npm test. Checks the lead form handler with Resend mocked (no email is sent).
import assert from 'node:assert';
import handler from '../api/lead.js';

const run = async (body) => {
  const out = {};
  const res = { setHeader() {}, status(c) { out.code = c; return this; }, json(j) { out.body = j; return this; }, end() { return this; } };
  await handler({ method: 'POST', body }, res);
  return out;
};
const lead = { name: 'Test <b>Buyer</b>', phone: '555-0100', email: 'buyer@example.com', plan: 'Sunset Retreat', timeline: 'Reserve', notes: 'hi' };
const log = console.log; console.log = () => {}; console.error = () => {};

// 1. no key yet: accepted, not emailed
delete process.env.RESEND_API_KEY;
let r = await run(lead); assert.equal(r.code, 200); assert.equal(r.body.emailDispatched, false);
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

log('ALL LEAD TESTS PASSED (12 cases)');
