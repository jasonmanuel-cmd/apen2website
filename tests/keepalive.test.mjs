// Run: npm test. Checks the /api/keepalive cron endpoint with Supabase mocked (nothing is contacted).
import assert from 'node:assert';
import handler from '../api/keepalive.js';

const run = async (headers = {}, method = 'GET') => {
  const out = { headers: {} };
  const res = { setHeader(k, v) { out.headers[k] = v; }, status(c) { out.code = c; return this; }, json(j) { out.body = j; return this; } };
  await handler({ method, headers }, res);
  return out;
};
const log = console.log; console.log = () => {};

const SB = 'https://abc123.supabase.co';
const calls = [];
const world = ({ db = 'ok' } = {}) => {
  calls.length = 0;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), method: opts.method, headers: opts.headers });
    if (db === 'throw') throw new Error('network down for sb_secret_test');
    if (db === 'fail') return { ok: false, status: 503, text: async () => 'sb_secret_test was in this error' };
    return { ok: true, status: 200, json: async () => [{ id: 'row-id-that-must-not-leak' }] };
  };
};
const errs = []; console.error = (...a) => errs.push(a.join(' '));
delete process.env.CRON_SECRET;
process.env.SUPABASE_URL = SB; process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';

// 1. only GET (that is what Vercel cron sends)
world(); let r = await run({}, 'POST'); assert.equal(r.code, 405); assert.equal(calls.length, 0);
// 2. success: exactly one tiny read, nothing from the table is returned, responses are not cached
r = await run(); assert.equal(r.code, 200); assert.deepEqual(r.body, { ok: true });
assert.equal(calls.length, 1); assert.equal(calls[0].method, 'GET');
assert.equal(calls[0].url, `${SB}/rest/v1/leads?select=id&limit=1`);
assert.equal(calls[0].headers.apikey, 'sb_secret_test'); assert.equal(calls[0].headers.Authorization, undefined);
assert.ok(!JSON.stringify(r.body).includes('row-id-that-must-not-leak'));
assert.equal(r.headers['Cache-Control'], 'no-store');
// 3. legacy service_role keys are JWTs and also go in the Authorization header
process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOi.payload.sig'; world(); await run();
assert.equal(calls[0].headers.Authorization, 'Bearer eyJhbGciOi.payload.sig');
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
// 4. CRON_SECRET, when set, locks the endpoint to the cron job
process.env.CRON_SECRET = 'cron-secret-value'; world();
r = await run(); assert.equal(r.code, 401); assert.equal(calls.length, 0);
r = await run({ authorization: 'Bearer wrong-secret-value' }); assert.equal(r.code, 401);
r = await run({ authorization: 'Bearer cron-secret-value-but-longer' }); assert.equal(r.code, 401);
r = await run({ authorization: 'cron-secret-value' }); assert.equal(r.code, 401);
assert.equal(calls.length, 0, 'unauthorized calls never reach the database');
r = await run({ authorization: 'Bearer cron-secret-value' }); assert.equal(r.code, 200); assert.equal(calls.length, 1);
delete process.env.CRON_SECRET;
// 5. a database problem is reported as a failure (so the cron log shows it), never as success
for (const db of ['fail', 'throw']) { world({ db }); r = await run(); assert.equal(r.code, 502); assert.equal(r.body.ok, false); }
// 6. missing or half-set config is reported, and nothing is contacted
const goodUrl = process.env.SUPABASE_URL;
delete process.env.SUPABASE_URL; world(); r = await run(); assert.equal(r.code, 503); assert.equal(calls.length, 0);
process.env.SUPABASE_URL = goodUrl; delete process.env.SUPABASE_SERVICE_ROLE_KEY; r = await run(); assert.equal(r.code, 503);
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
// 7. logs never contain the key or the cron secret
process.env.CRON_SECRET = 'cron-secret-value';
for (const db of ['fail', 'throw']) { world({ db }); await run({ authorization: 'Bearer cron-secret-value' }); }
assert.ok(errs.length > 0 && errs.every((e) => !e.includes('sb_secret_test') && !e.includes('cron-secret-value')));

log('ALL KEEPALIVE TESTS PASSED');
