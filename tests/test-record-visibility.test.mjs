import assert from 'node:assert/strict';
import staff from '../api/staff/leads.js';
import analytics from '../api/hq/analytics.js';

process.env.STAFF_TOKEN = 'local-test-token-0123456789';
process.env.SUPABASE_URL = 'https://local-fixture.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only';
const rows = [
  { id: '11111111-1111-4111-8111-111111111111', status: 'new' },
  { id: '22222222-2222-4222-8222-222222222222', status: 'test' },
  { id: '33333333-3333-4333-8333-333333333333', status: 'spam' },
];
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(url);
  assert.equal(u.origin, process.env.SUPABASE_URL);
  if (!u.pathname.endsWith('/leads')) return new Response('[]');
  let selected = rows.filter(r => !u.searchParams.has('id') || u.searchParams.get('id') === `eq.${r.id}`);
  const filter = u.searchParams.get('status');
  if (filter?.startsWith('eq.')) selected = selected.filter(r => r.status === filter.slice(3));
  if (filter?.startsWith('neq.')) selected = selected.filter(r => r.status !== filter.slice(4));
  if (filter === 'not.in.(spam,test)') selected = selected.filter(r => !['spam', 'test'].includes(r.status));
  if (options.method === 'PATCH') selected.forEach(r => Object.assign(r, JSON.parse(options.body)));
  return new Response(JSON.stringify(selected), { headers: { 'content-range': `0-0/${selected.length}` } });
};
const run = async (handler, query, method = 'GET', body) => {
  const out = {};
  await handler({ method, query, body, headers: { authorization: `Bearer ${process.env.STAFF_TOKEN}` } }, {
    setHeader() {}, status(code) { out.code = code; return this; }, json(body) { out.body = body; return this; },
  });
  assert.equal(out.code, 200);
  return out.body;
};
let result = await run(staff, { status: 'all' });
assert.deepEqual(result.leads.map(r => r.status), ['new', 'spam'], 'ordinary All excludes test, preserves spam semantics');
assert.equal(result.total, 2);
result = await run(analytics, { days: '30' });
assert.equal(result.totals.leadsInWindow, 2, 'test records do not inflate lead totals');
result = await run(staff, { status: 'test' });
assert.equal(result.leads.length, 1, 'Test view retains recoverable record');
const id = result.leads[0].id;
await run(staff, { id }, 'PATCH', { status: 'new' });
assert.equal((await run(staff, { status: 'all' })).total, 3, 'normal product status edit restores visibility');
assert.equal((await run(analytics, {})).totals.leadsInWindow, 3, 'restored lead returns to totals');
console.log('test-record visibility: PASS (All, totals, Test view, restore)');
