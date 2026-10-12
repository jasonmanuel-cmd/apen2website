// Run: npm test. Checks the /hq dashboard analytics API with Supabase mocked: nothing is contacted.
// The point of most of these is that lead and visitor data can only be read with the staff password.
import assert from 'node:assert';
import handler from '../api/hq/analytics.js';

const TOKEN = 'staff-token-for-tests-0123456789';
const SB = 'https://abc123.supabase.co';
const errs = []; console.error = (...a) => errs.push(a.join(' ')); console.log = () => {};

const run = async ({ method = 'GET', query = {}, auth = `Bearer ${TOKEN}` } = {}) => {
  const out = { headers: {} };
  const res = { setHeader(k, v) { out.headers[k] = v; }, status(c) { out.code = c; return this; }, json(j) { out.body = j; return this; } };
  await handler({ method, query, headers: auth === null ? {} : { authorization: auth } }, res);
  return out;
};

const calls = [];
const day = (n) => new Date(Date.now() - n * 864e5).toISOString();
const sessions = [
  { session_id: 's1', created_at: day(0), visitor_hash: 'h1', referrer_host: 'google.com', referrer_type: 'search', utm_source: null, utm_campaign: null, entry_path: '/', exit_path: '/floor-plans/', page_views: 3, device_type: 'mobile', browser: 'Safari', os: 'iOS', country: 'US', region: 'CA', city: 'Bakersfield', duration_seconds: 120 },
  { session_id: 's2', created_at: day(1), visitor_hash: 'h2', referrer_host: null, referrer_type: 'direct', utm_source: 'facebook', utm_campaign: 'spring', entry_path: '/floor-plans/', exit_path: '/', page_views: 1, device_type: 'desktop', browser: 'Chrome', os: 'Windows', country: 'US', region: 'NV', city: 'Reno', duration_seconds: 20 },
  { session_id: 's3', created_at: day(1), visitor_hash: 'h2', referrer_host: null, referrer_type: 'direct', utm_source: 'facebook', utm_campaign: 'spring', entry_path: '/contact/', exit_path: '/contact/', page_views: 2, device_type: 'desktop', browser: 'Chrome', os: 'Windows', country: 'US', region: 'NV', city: 'Reno', duration_seconds: 300 },
];
const visits = [
  { path: '/', duration_seconds: 60 }, { path: '/floor-plans/', duration_seconds: 200 },
  { path: '/contact/', duration_seconds: 180 }, { path: '/', duration_seconds: 5 },
];

const world = ({ db = 'ok', s = sessions, v = visits, leads = 4 } = {}) => {
  calls.length = 0;
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET' });
    if (db === 'throw') throw new Error('network down for sb_secret_test');
    if (db === 'fail') return { ok: false, status: 503, headers: new Headers(), json: async () => ({ message: 'sb_secret_test leaked' }) };
    if (String(url).includes('/leads')) return { ok: true, status: 200, headers: new Headers({ 'content-range': `0-0/${leads}` }), json: async () => ({}) };
    return { ok: true, status: 200, headers: new Headers(), json: async () => (String(url).includes('/visits') ? v : s) };
  };
};
process.env.STAFF_TOKEN = TOKEN;
process.env.SUPABASE_URL = SB; process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';

// --- access control ---------------------------------------------------------
world(); let r = await run({ method: 'POST' }); assert.equal(r.code, 405); assert.equal(calls.length, 0);
for (const bad of [null, '', 'Bearer', 'Bearer wrong', TOKEN.slice(0, -1)]) {
  world(); r = await run({ auth: bad === null ? null : bad });
  assert.equal(r.code, 401, `auth ${bad}`); assert.equal(calls.length, 0);
}
for (const t of [undefined, '', 'short']) {
  if (t === undefined) delete process.env.STAFF_TOKEN; else process.env.STAFF_TOKEN = t;
  world(); r = await run({ auth: `Bearer ${t || ''}` }); assert.equal(r.code, 503); assert.equal(calls.length, 0);
}
process.env.STAFF_TOKEN = TOKEN;

delete process.env.SUPABASE_URL;
world(); r = await run(); assert.equal(r.code, 503); assert.equal(calls.length, 0);
process.env.SUPABASE_URL = SB;

// --- the aggregation --------------------------------------------------------
world(); r = await run({ query: { days: '30' } });
assert.equal(r.code, 200);
const d = r.body;
assert.equal(d.ok, true);
assert.equal(d.days, 30);
assert.equal(d.totals.sessions, 3);
assert.equal(d.totals.uniqueVisitors, 2, 'h2 appears twice and counts once');
assert.equal(d.totals.pageViews, 6);
assert.equal(d.totals.pagesPerSession, 2);
assert.equal(d.totals.avgDurationSeconds, Math.round((120 + 20 + 300) / 3));
assert.equal(d.totals.medianDurationSeconds, 120);
assert.equal(d.totals.leadsInWindow, 4);

// One bucket per calendar day in the window, oldest first, today last.
assert.equal(d.daily.length, 30);
assert.equal(d.daily.at(-1).day, new Date().toISOString().slice(0, 10));
assert.equal(d.daily[0].day, new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10));
assert.equal(d.daily.at(-1).sessions, 1);
assert.equal(d.daily.at(-2).sessions, 2);

assert.deepEqual(d.referrers, [{ key: 'direct', value: 2 }, { key: 'search', value: 1 }]);
// Two of the three visits were direct, so they have no referring host. The UI
// labels that bucket "Direct / unknown" rather than inventing a source.
assert.deepEqual(d.referrerHosts, [{ key: 'unknown', value: 2 }, { key: 'google.com', value: 1 }]);
// Untagged visits land in an "unknown" bucket rather than being dropped, so the
// sum still equals the session count.
assert.deepEqual(d.campaigns, [{ key: 'spring', value: 2 }, { key: 'unknown', value: 1 }]);
assert.deepEqual(d.sources, [{ key: 'facebook', value: 2 }, { key: 'unknown', value: 1 }]);
assert.deepEqual(d.devices, [{ key: 'desktop', value: 2 }, { key: 'mobile', value: 1 }]);
assert.deepEqual(d.countries, [{ key: 'US', value: 3 }]);
assert.equal(d.topPages[0].key, '/', '/ is the most viewed');
assert.equal(d.topPages.find((p) => p.key === '/floor-plans/').duration, 200);
// Three sessions entered three different pages, so no entry page dominates.
assert.equal(d.entryPages.reduce((a, p) => a + p.value, 0), 3);
assert.equal(d.hourlyUtc.length, 24);

// The window is passed to the database, so a wider range really does read more.
world(); await run({ query: { days: '7' } });
assert.ok(calls.some((c) => c.url.includes('/visits')));

// Absurd and hostile ranges are clamped, never trusted.
world(); r = await run({ query: { days: '99999' } }); assert.equal(r.body.days, 365);
world(); r = await run({ query: { days: '-5' } }); assert.equal(r.body.days, 1);
world(); r = await run({ query: { days: 'abc' } }); assert.equal(r.body.days, 30);

// --- no data yet is not an error -------------------------------------------
world({ s: [], v: [] }); r = await run();
assert.equal(r.code, 200);
assert.equal(r.body.totals.sessions, 0);
assert.equal(r.body.totals.uniqueVisitors, 0);
assert.equal(r.body.referrers.length, 0, 'no phantom buckets');
assert.equal(r.body.topPages.length, 0);
assert.equal(r.body.daily.length, 30, 'the chart still has its axis');

// --- database trouble never leaks ------------------------------------------
for (const db of ['fail', 'throw']) {
  world({ db }); r = await run();
  assert.equal(r.code, 502, `db=${db}`);
  assert.ok(!JSON.stringify(r.body).includes('sb_secret_test'), 'the service key must never reach the browser');
}
assert.ok(errs.length > 0 && !errs.join(' ').includes('sb_secret_test'), 'logs must not contain the service key');

// --- the query never asks for the raw table --------------------------------
world(); await run();
for (const c of calls) {
  assert.ok(!c.url.includes('visitor_hash=eq'), 'dashboard must not filter on the visitor hash');
}
assert.ok(calls.some((c) => c.url.includes('device_type=neq.bot')), 'bots are excluded');

console.log('hq analytics: ok');
