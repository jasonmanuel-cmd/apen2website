// Run: npm test. Checks the analytics ingest API (/api/track) with Supabase mocked: nothing is contacted.
// Also checks the one rule that matters most there — no IP address is ever stored.
import assert from 'node:assert';
import handler from '../api/track.js';

const SB = 'https://abc123.supabase.co';
const IP = '203.0.113.45';
const SID = 'a2-session-1111-2222-3333';
const errs = []; console.error = (...a) => errs.push(a.join(' ')); console.log = () => {};

const run = async ({ method = 'POST', body, headers = {} } = {}) => {
  const out = { headers: {} };
  const res = {
    setHeader(k, v) { out.headers[k] = v; },
    status(c) { out.code = c; return this; },
    json(j) { out.body = j; return this; }
  };
  await handler({ method, body, headers: { 'x-forwarded-for': IP, 'user-agent': UA, ...headers } }, res);
  return out;
};

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';

const calls = [];
// db: 'ok' | 'fail' | 'throw'
const world = ({ db = 'ok' } = {}) => {
  calls.length = 0;
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body });
    if (db === 'throw') throw new Error('network down for sb_secret_test');
    if (db === 'fail') return { ok: false, status: 503, headers: new Headers(), json: async () => ({ message: 'sb_secret_test leaked' }) };
    return { ok: true, status: 200, headers: new Headers(), json: async () => [] };
  };
};
process.env.SUPABASE_URL = SB; process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
delete process.env.ANALYTICS_SALT;
const bodyOf = (i = 0) => JSON.parse(calls[i].body);

// --- method -----------------------------------------------------------------
world(); let r = await run({ method: 'GET' });
assert.equal(r.code, 405); assert.equal(calls.length, 0);

// --- the IP must never be stored --------------------------------------------
world();
r = await run({ body: { sid: SID, type: 'start', path: '/', referrerHost: 'google.com', referrerType: 'search' },
  headers: { 'x-vercel-ip-country': 'US', 'x-vercel-ip-country-region': 'CA' } });
assert.equal(r.code, 200);
const sent = JSON.stringify(calls);
assert.ok(!sent.includes(IP), `IP leaked into the database payload: ${sent}`);
const start = bodyOf(0);
assert.ok(start.visitor_hash && start.visitor_hash.length === 32, 'visitor hash is a 32-char digest');
assert.notEqual(start.visitor_hash, IP);

// Same IP on a different day must produce a different hash, so uniques cannot
// be tracked across days.
const hashToday = bodyOf(0).visitor_hash;
const RealDate = globalThis.Date;
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : ['2026-01-02T00:00:00Z'])); }
  static now() { return new RealDate('2026-01-02T00:00:00Z').getTime(); }
};
world();
await run({ body: { sid: 'other-session', type: 'start', path: '/' } });
const hashTomorrow = bodyOf(0).visitor_hash;
globalThis.Date = RealDate;
assert.notEqual(hashToday, hashTomorrow, 'visitor hash must rotate daily');

// A salt in the environment changes the hash, so a rotated ANALYTICS_SALT
// invalidates old hashes instead of leaving them comparable.
process.env.ANALYTICS_SALT = 'a-different-salt';
world(); await run({ body: { sid: SID, type: 'start', path: '/' } });
assert.notEqual(bodyOf(0).visitor_hash, hashToday);
delete process.env.ANALYTICS_SALT;

// --- event handling ---------------------------------------------------------
world();
r = await run({ body: { sid: SID, type: 'pageview', path: '/floor-plans/', title: 'Floor Plans', pageToken: 'tok-1' } });
assert.equal(r.code, 200);
assert.ok(calls[0].url.includes('/visits'), 'pageview inserts a visit');
assert.equal(bodyOf(0).page_token, 'tok-1');
assert.ok(calls[1].url.includes('rpc/bump_session'), 'pageview bumps the session');

world();
r = await run({ body: { sid: SID, type: 'heartbeat', pageToken: 'tok-1', durationSeconds: 30 } });
assert.equal(r.code, 200);
assert.ok(calls[0].url.includes('visits?page_token=eq.tok-1'), 'dwell updates the existing row by token');
assert.equal(bodyOf(0).duration_seconds, 30);

// A forgotten tab cannot inflate engagement: dwell is clamped.
world(); await run({ body: { sid: SID, type: 'end', pageToken: 'tok-1', durationSeconds: 99_999 } });
assert.equal(bodyOf(1).p_duration_seconds, 1800);

// 'end' and 'heartbeat' behave identically, and the client total is not added to
// the session again (every earlier page already sent its own heartbeat).
world(); await run({ body: { sid: SID, type: 'end', pageToken: 'tok-1', durationSeconds: 10 } });
assert.equal(bodyOf(1).p_duration_seconds, 10);
assert.equal(bodyOf(1).p_page_views, 0, 'an end event must not count another page view');

// --- input validation -------------------------------------------------------
for (const bad of [{}, { type: 'start' }, { sid: SID }, { sid: SID, type: 'nonsense' }]) {
  world(); r = await run({ body: bad });
  assert.equal(r.code, 400, JSON.stringify(bad));
  assert.equal(calls.length, 0, `invalid payload reached the database: ${JSON.stringify(bad)}`);
}
world(); r = await run({ body: '{ not json' });
assert.equal(r.code, 400); assert.equal(calls.length, 0);

// A referrer type outside the allowed set is coerced, never passed through.
world(); await run({ body: { sid: SID, type: 'start', path: '/', referrerType: "'; drop table--" } });
assert.equal(bodyOf(0).referrer_type, 'other');

// Oversized strings are capped rather than stored whole.
world(); await run({ body: { sid: SID, type: 'pageview', path: '/' + 'a'.repeat(5000), title: 't'.repeat(5000), pageToken: 'x'.repeat(200) } });
assert.equal(bodyOf(0).path.length, 300);
assert.equal(bodyOf(0).title.length, 200);
assert.equal(bodyOf(0).page_token.length, 64);

// --- never a hard failure for the visitor -----------------------------------
for (const db of ['fail', 'throw']) {
  world({ db });
  r = await run({ body: { sid: SID, type: 'pageview', path: '/', pageToken: 'tok-1' } });
  assert.equal(r.code, 202, `db=${db} must not fail the page`);
  assert.equal(r.body.ok, true);
}
assert.ok(errs.length > 0, 'database errors are logged');
assert.ok(!errs.join(' ').includes('sb_secret_test'), 'logs must not contain the service key');

// Without a database the endpoint still acknowledges and stores nothing.
delete process.env.SUPABASE_URL;
world(); r = await run({ body: { sid: SID, type: 'start', path: '/' } });
assert.equal(r.code, 202); assert.equal(r.body.stored, false); assert.equal(calls.length, 0);
process.env.SUPABASE_URL = SB;

// --- rate limiting ----------------------------------------------------------
// The limiter is module-level and keyed by IP, so this uses a fresh one to get
// a clean budget rather than inheriting what the tests above spent.
const rlIp = { 'x-forwarded-for': '198.51.100.7' };
const rl = () => run({ body: { sid: SID, type: 'pageview', path: '/', pageToken: 't' }, headers: rlIp });
world();
let allowed = 0;
for (let i = 0; i < 130; i++) { const res2 = await rl(); if (res2.code === 200) allowed++; }
assert.ok(allowed > 0 && allowed <= 121, `rate limit should allow ~120 per minute, allowed ${allowed}`);
assert.equal((await rl()).code, 429, 'over the limit it is refused');
// A different IP has its own budget, so one noisy visitor cannot lock out others.
assert.equal((await run({ body: { sid: SID, type: 'pageview', path: '/', pageToken: 't' } })).code, 200, 'other IPs unaffected');

console.log('track: ok');
