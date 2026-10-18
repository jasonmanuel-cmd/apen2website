// Run: npm test. Checks the phone-message endpoint (/api/voice) with Supabase and Resend mocked: nothing is contacted.
import assert from 'node:assert';
import handler from '../api/voice.js';

const SB = 'https://abc123.supabase.co';
const SECRET = 'voice-webhook-secret-0123456789abcdef';
const errs = []; console.error = (...a) => errs.push(a.join(' ')); console.log = () => {};
process.env.SUPABASE_URL = SB; process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test'; process.env.RESEND_API_KEY = 're_test';
process.env.NOTIFICATION_EMAIL = 'one@example.com, two@example.com, three@example.com';
process.env.VOICE_WEBHOOK_SECRET = SECRET;

const run = async ({ method = 'POST', body, headers = { 'x-voice-secret': SECRET }, query = {} } = {}) => {
  const out = { headers: {} };
  const res = { setHeader(k, v) { out.headers[k] = v; }, status(c) { out.code = c; return this; }, json(j) { out.body = j; return this; } };
  await handler({ method, body, headers, query }, res);
  await new Promise((r) => setTimeout(r, 20)); // the staff email is sent after the reply
  return out;
};

const json = (j, ok = true, status = 200) => ({ ok, status, headers: new Headers(), json: async () => j, text: async () => '' });
let db, calls;
const world = ({ existingLead = null, fail = false, dupCallback = false } = {}) => {
  calls = []; db = { leads: [], callbacks: [], patches: [] };
  globalThis.fetch = async (url, opts = {}) => {
    url = String(url); const method = opts.method || 'GET'; calls.push({ url, method, body: opts.body });
    if (url.startsWith('https://api.resend.com')) return json({ id: 'e' });
    if (fail) return json({}, false, 500);
    const path = decodeURIComponent(url.replace(`${SB}/rest/v1/`, ''));
    if (path.startsWith('callbacks') && method === 'GET') return json(dupCallback ? [{ id: 'cb1' }] : []);
    if (path.startsWith('leads') && method === 'GET') return json(existingLead ? [existingLead] : []);
    if (path.startsWith('leads') && method === 'POST') { const row = JSON.parse(opts.body); db.leads.push(row); return json([{ id: 'lead-1' }]); }
    if (path.startsWith('leads') && method === 'PATCH') { db.patches.push(JSON.parse(opts.body)); return json([]); }
    if (path.startsWith('callbacks') && method === 'POST') { db.callbacks.push(JSON.parse(opts.body)); return json([]); }
    return json([]);
  };
};
const mails = () => calls.filter((c) => c.url.startsWith('https://api.resend.com')).map((c) => JSON.parse(c.body));
const good = { name: 'Pat Lee', callback_number: '661-555-0123', email: 'pat@example.com', message: 'Interested in a tour of Sunset Retreat this week.', best_time: 'after 5pm' };

// ---- who may call it ---------------------------------------------------------------------------------
world();
assert.equal((await run({ body: good, headers: {} })).code, 401, 'no secret');
assert.equal((await run({ body: good, headers: { 'x-voice-secret': 'wrong-wrong-wrong-wrong-wrong' } })).code, 401, 'wrong secret');
assert.equal((await run({ method: 'GET' })).code, 405);
assert.equal(db.leads.length + db.callbacks.length + mails().length, 0, 'nothing saved without the secret');
assert.equal((await run({ body: good, headers: { authorization: `Bearer ${SECRET}` } })).code, 200, 'bearer works');
world(); assert.equal((await run({ body: good, headers: {}, query: { k: SECRET } })).code, 200, 'query secret works');
process.env.VOICE_WEBHOOK_SECRET = 'short'; assert.equal((await run({ body: good })).code, 503, 'closed when the secret is too short'); process.env.VOICE_WEBHOOK_SECRET = SECRET;

// ---- a message is saved to the CRM and emailed --------------------------------------------------------
world(); let r = await run({ body: good });
assert.equal(r.code, 200); assert.equal(r.body.ok, true); assert.match(r.body.message, /team will call back/);
assert.equal(db.leads.length, 1); assert.equal(db.leads[0].source, 'Phone call'); assert.equal(db.leads[0].name, 'Pat Lee');
assert.equal(db.leads[0].phone, '(661) 555-0123'); assert.equal(db.leads[0].email, 'pat@example.com'); assert.equal(db.leads[0].raw.channel, 'voice');
assert.equal(db.callbacks.length, 1); assert.equal(db.callbacks[0].lead_id, 'lead-1'); assert.equal(db.callbacks[0].message, good.message); assert.equal(db.callbacks[0].best_time, 'after 5pm');
const m = mails(); assert.equal(m.length, 3, 'one email per address on the list');
assert(m.every((x) => /\[Phone Message\] Pat Lee/.test(x.subject) && x.html.includes('tel:6615550123') && x.html.includes('sms:6615550123') && x.html.includes('Sunset Retreat')));
assert.deepEqual(m.map((x) => x.to[0]).sort(), ['one@example.com', 'three@example.com', 'two@example.com']);

// ---- tolerant of how the tool sends its arguments -----------------------------------------------------
world(); r = await run({ body: { arguments: { first_name: 'Ana', last_name: 'Ruiz', phone: '(661) 555-0188', message: 'Call me about financing' } } });
assert.equal(db.leads[0].name, 'Ana Ruiz'); assert.equal(db.callbacks[0].phone, '(661) 555-0188');
world(); r = await run({ body: { name: 'Sam Cole', caller_number: '+16615550144', message: 'Do you build on my lot?' } });
assert.equal(db.callbacks[0].phone, '(661) 555-0144', 'falls back to the caller number'); assert.equal(db.leads[0].email, null);
world(); r = await run({ body: { callback_number: '661-555-0100', message: 'hello' } });
assert.equal(db.leads[0].name, 'Phone caller (name not captured)', 'a message without a name is still saved');

// ---- missing or bad details come back as a question for the assistant ---------------------------------
for (const [body, re] of [[{ name: 'Pat', message: 'hi' }, /phone number/], [{ name: 'Pat', callback_number: '12', message: 'hi' }, /phone number/], [{ name: 'Pat', callback_number: '6615550123' }, /message/], [{ name: 'Pat', callback_number: '6615550123', email: 'nope', message: 'hi' }, /email/]]) {
  world(); r = await run({ body }); assert.equal(r.code, 200); assert.equal(r.body.ok, false); assert.match(r.body.message, re);
  assert.equal(db.leads.length + db.callbacks.length + mails().length, 0, 'nothing saved until the details are complete');
}

// ---- known number: reuse the lead, add the email it lacked --------------------------------------------
world({ existingLead: { id: 'lead-9', name: 'Pat Lee', email: null } }); r = await run({ body: good });
assert.equal(db.leads.length, 0, 'no duplicate lead'); assert.equal(db.callbacks[0].lead_id, 'lead-9'); assert.deepEqual(db.patches, [{ email: 'pat@example.com' }]);

// ---- a retry of the same message is saved once --------------------------------------------------------
world({ dupCallback: true }); r = await run({ body: good });
assert.equal(r.body.ok, true); assert.equal(db.leads.length + db.callbacks.length + mails().length, 0, 'retry: nothing new');

// ---- database trouble: honest answer, no email --------------------------------------------------------
world({ fail: true }); r = await run({ body: good });
assert.equal(r.code, 502); assert.equal(r.body.ok, false); assert.equal(mails().length, 0, 'no email for something that was not saved');
assert(!errs.some((e) => /sb_secret|re_test|voice-webhook-secret/.test(e)), 'no secrets in logs');
console.log = process.stdout.write.bind(process.stdout); console.log('voice: ok');
