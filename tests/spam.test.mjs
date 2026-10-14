// Run: npm test. Checks the intake-form spam filter (lib/spam.js and its use in api/lead.js).
// The "spam" samples are the kinds of messages that actually reached the leads table in October 2026.
// The "real" samples are genuine inquiries from the same table, which must never be filed as spam.
import assert from 'node:assert';
import { assessLead, normalizeText, THRESHOLD } from '../lib/spam.js';
import handler from '../api/lead.js';

const log = console.log; console.log = () => {}; console.error = () => {};

const spam = [
  ['SEO vendor pitch', { name: 'David Schipper (CEO, Technicia', notes: '100% Tx Based - a One-Man SEO Army - 27 Years Experience\nOnly $199/mo -- Hosting Included upon client request\n\nFind out more: https://advent' }],
  ['search index pitch', { name: 'Zac Ngabidj', notes: "Dear Sir/Madam\r\n\r\nFeature aspen2bakersfield.com in Google's Search Index to appear in web search results!\r\n\r\nList aspen2bakersfield.com toda" }],
  ['traffic pitch', { name: 'Rachel Emerson', notes: 'I help websites like yours get more traffic from search engines without expensive ad campaigns. After a quick review of your site, I spotted' }],
  ['gibberish name, foreign filler', { name: 'cristosiefermatoaeHob', notes: "L'opera leviana è un classico che attraversa le generazioni, parlando di temi universali come la libertà, la giustizia e l'identità." }],
  ['mostly non-Latin text', { name: 'Ivan', notes: 'Здравствуйте, мы предлагаем вам недорогие услуги для вашего сайта и бизнеса сегодня' }],
  ['links', { name: 'Sam', notes: 'Check www.cheap-leads.biz or https://x.co/offer now' }],
  ['bot speed', { name: 'Pat Lee', notes: 'hello', elapsedMs: 300 }],
  ['same message again', { name: 'Pat Lee', notes: 'Hello there', duplicate: true }],
];
const real = [
  ['lowest priced homes', { name: 'Chastidy', notes: 'Im wanting to inquire about the lowest priced homes you offer', elapsedMs: 41000 }],
  ['project inquiry', { name: 'James Ford', notes: 'Interested in 2 projects on Mustang Drive in Stallion Springs. One is being built and he cannot find the listing; the other is listed but no' }],
  ['quick follow-up', { name: 'Jordon Baird', notes: 'Interested in speaking about a project. Available to chat today?' }],
  ['lender inquiry', { name: 'Ryan Thomas', notes: 'Looking for a contact who can provide lien subordination requirements for our mutual client.' }],
  ['verification of employment', { name: 'Martha Cisneros', notes: 'Please provide a fax number or email where I can request a verification of employment.' }],
  ['mentions our own site', { name: 'Dana Ruiz', notes: 'I saw Sunset Retreat on aspen2homes.com. Is Home 2 still available?' }],
  ['gives an email in the note', { name: 'Lee Park', notes: 'Best to reach my wife at kim.park@gmail.com, she handles the loan.' }],
  ['monthly payment question', { name: 'Omar Haddad', notes: 'What would the payment be per month with 5% down?' }],
  ['no notes, normal speed', { name: 'Maria', notes: '', elapsedMs: 15000 }],
  ['no notes, plain HTML post (no timing)', { name: 'Maria Gonzalez', notes: '' }],
  ['accented Latin name', { name: 'José Núñez', notes: 'Estoy interesado en la casa de tres recámaras.' }],
  ['McDonald-style name', { name: 'McKenzie DeShawn', notes: 'Tour on Saturday?' }],
  ['fast autofill is not flagged', { name: 'Pat Lee', notes: 'Tour please', elapsedMs: 4500 }],
];
for (const [label, input] of spam) { const v = assessLead(input); assert(v.spam, `should be spam: ${label} (score ${v.score}: ${v.reasons})`); assert(v.reasons.length > 0); }
for (const [label, input] of real) { const v = assessLead(input); assert(!v.spam, `real lead flagged: ${label} (score ${v.score}: ${v.reasons.join('; ')})`); }
assert.equal(THRESHOLD, 3);
assert.equal(normalizeText('  Hello   WORLD '), 'hello world');
assert.equal(assessLead({}).spam, false, 'empty input is not spam');
assert.equal(assessLead({ name: 'x', notes: 'free quote', elapsedMs: NaN }).spam, false);

// ---- through the real handler -------------------------------------------------------------------
const SB = 'https://abc123.supabase.co';
process.env.SUPABASE_URL = SB; process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test'; process.env.RESEND_API_KEY = 're_test';
let stored, emails, existing;
const world = (rows = []) => {
  stored = []; emails = []; existing = rows;
  globalThis.fetch = async (url, opts = {}) => {
    url = String(url);
    if (url.startsWith('https://api.resend.com')) { emails.push(JSON.parse(opts.body)); return { ok: true, status: 200, text: async () => '' }; }
    const method = opts.method || 'GET';
    if (url.includes('/rest/v1/leads?select=notes')) return { ok: true, status: 200, json: async () => existing };
    if (url.includes('/rest/v1/leads?select=id') && method === 'POST') { stored.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => [{ id: 'lead-1' }] }; }
    return { ok: true, status: 200, json: async () => [] };
  };
};
let n = 0;
const run = async (body, ip) => {
  const out = { headers: {} };
  const res = { setHeader(k, v) { out.headers[k] = v; }, status(c) { out.code = c; return this; }, json(j) { out.body = j; return this; }, end() { return this; } };
  await handler({ method: 'POST', body, headers: { host: 'aspen2homes.com', 'x-forwarded-for': ip || `198.51.100.${++n % 250}.${Math.floor(n / 250)}` } }, res);
  return out;
};
const good = { name: 'Pat Lee', phone: '(661) 555-0100', email: 'pat@example.com', notes: 'Is Home 2 still available?', timeline: 'Schedule a tour', source: 'Contact page', elapsedMs: 22000 };

// a real lead: stored as new (no status override) and emailed
world(); let r = await run(good);
assert.equal(r.code, 200); assert.equal(stored.length, 1); assert.equal(stored[0].status, undefined); assert.equal(emails.length, 1);

// the SEO pitch: stored as spam with the reasons, NOT emailed, and the sender sees a normal thank-you
world(); r = await run({ ...good, name: 'David Schipper', email: 'x@dig1.com', notes: spam[0][1].notes });
assert.equal(r.code, 200); assert.equal(r.body.success, true); assert.equal(r.body.saved, true);
assert.equal(stored.length, 1); assert.equal(stored[0].status, 'spam'); assert.ok(stored[0].raw.spam.score >= 3 && stored[0].raw.spam.reasons.length);
assert.equal(emails.length, 0, 'spam is never emailed');
assert.ok(!JSON.stringify(r.body).match(/spam|score|reason/i), 'the sender is not told why');

// the same message sent again today is a duplicate: filed, not emailed; a different message is fine
world([{ notes: 'Is Home 2 still available?' }]); r = await run(good);
assert.equal(stored[0].status, 'spam'); assert.deepEqual(stored[0].raw.spam.reasons, ['same message already received today']); assert.equal(emails.length, 0);
world([{ notes: 'something else entirely' }]); r = await run(good); assert.equal(stored[0].status, undefined); assert.equal(emails.length, 1);

// a bot-speed submission is filed; a plain HTML post with no timing is judged on content only
world(); r = await run({ ...good, elapsedMs: 250 }); assert.equal(stored[0].status, 'spam'); assert.equal(emails.length, 0);
world(); { const { elapsedMs, ...noTiming } = good; r = await run(noTiming); assert.equal(stored[0].status, undefined); assert.equal(emails.length, 1); }

// the duplicate lookup failing must not block a real lead
world(); const base = globalThis.fetch; globalThis.fetch = async (u, o) => String(u).includes('select=notes') ? { ok: false, status: 503, json: async () => ({}) } : base(u, o);
r = await run(good); assert.equal(r.code, 200); assert.equal(emails.length, 1);

// honeypot still pretends success and stores nothing
world(); r = await run({ ...good, honeypot: 'x' }); assert.equal(r.code, 200); assert.equal(stored.length, 0); assert.equal(emails.length, 0);

// per-address limit: 8 per 10 minutes, then 429 with the phone number; other addresses are unaffected
world(); let last; for (let i = 0; i < 10; i++) last = await run({ ...good, name: `Person ${i}`, email: `p${i}@example.com`, notes: `note ${i}` }, '203.0.113.50');
assert.equal(last.code, 429); assert.match(last.body.error, /661\) 241-0306/);
r = await run(good, '203.0.113.51'); assert.equal(r.code, 200);

console.log = log; console.log('spam: ok');
