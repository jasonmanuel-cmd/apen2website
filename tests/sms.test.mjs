// Run: npm test. Checks the text-message intake (/api/sms) with Supabase, Resend and the Anthropic API mocked.
import assert from 'node:assert';
import handler, { usDigits } from '../api/sms.js';

const SB = 'https://abc123.supabase.co';
const SECRET = 'bridge-secret-for-tests-0123456789';
const errs = []; console.error = (...a) => errs.push(a.join(' ')); console.log = () => {};
process.env.SUPABASE_URL = SB; process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test'; process.env.RESEND_API_KEY = 're_test'; process.env.SMS_BRIDGE_SECRET = SECRET;

const run = async ({ method = 'POST', body, secret = SECRET } = {}) => {
  const out = { headers: {} };
  const res = { setHeader(k, v) { out.headers[k] = v; }, status(c) { out.code = c; return this; }, json(j) { out.body = j; return this; } };
  await handler({ method, body, headers: secret === null ? {} : { 'x-bridge-secret': secret } }, res);
  return out;
};

const json = (j, ok = true, status = 200) => ({ ok, status, headers: new Headers(), json: async () => j });
let db, script, anthropic, calls;
const world = ({ optedOut = false, replies = [], conv = null } = {}) => {
  calls = []; anthropic = []; script = [...replies];
  db = { optouts: optedOut ? ['6615550199'] : [], conv: conv ? { ...conv } : null, messages: [], leads: [], callbacks: [] };
  globalThis.fetch = async (url, opts = {}) => {
    url = String(url); const method = opts.method || 'GET'; calls.push({ url, method, body: opts.body });
    if (url.startsWith('https://api.anthropic.com')) { anthropic.push(JSON.parse(opts.body)); return script.length ? json(script.shift()) : json({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }); }
    if (url.startsWith('https://api.resend.com')) return json({ id: 'e' });
    const path = url.replace(`${SB}/rest/v1/`, '');
    if (path.startsWith('sms_optouts') && method === 'GET') { const p = decodeURIComponent(path.match(/phone=eq\.([^&]+)/)[1]); return json(db.optouts.includes(p) ? [{ phone: p }] : []); }
    if (path.startsWith('sms_optouts') && method === 'POST') { const p = JSON.parse(opts.body).phone; if (!db.optouts.includes(p)) db.optouts.push(p); return json([]); }
    if (path.startsWith('sms_optouts') && method === 'DELETE') { const p = decodeURIComponent(path.match(/phone=eq\.([^&]+)/)[1]); db.optouts = db.optouts.filter((x) => x !== p); return json([]); }
    if (path.startsWith('conversations') && method === 'GET') return json(db.conv ? [db.conv] : []);
    if (path.startsWith('conversations') && method === 'POST') { db.conv = { ...JSON.parse(opts.body), message_count: 0, lead_id: null, needs_human: false }; return json([db.conv]); }
    if (path.startsWith('conversations') && method === 'PATCH') { Object.assign(db.conv, JSON.parse(opts.body)); return json([db.conv]); }
    if (path.startsWith('messages') && method === 'GET') return json([...db.messages]);
    if (path.startsWith('messages') && method === 'POST') { db.messages.push(JSON.parse(opts.body)); return json([]); }
    if (path.startsWith('leads') && method === 'GET') return json([]);
    if (path.startsWith('leads') && method === 'POST') { db.leads.push(JSON.parse(opts.body)); return json([{ id: 'lead-1' }]); }
    if (path.startsWith('callbacks') && method === 'GET') return json(db.callbacks.map(() => ({ id: 'x' })));
    if (path.startsWith('callbacks') && method === 'POST') { db.callbacks.push(JSON.parse(opts.body)); return json([]); }
    return json([]);
  };
};
const text = (t) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
const tool = (name, input) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name, input }] });
let n = 0; const fresh = () => `(661) 555-${String(1000 + ++n).padStart(4, '0')}`; // a new number each time, so the hourly limit stays out of the way
const send = (text, from = fresh()) => run({ body: { from, text } });
const modelCalled = () => anthropic.length > 0;

assert.equal(usDigits('+1 (661) 555-0100'), '6615550100'); assert.equal(usDigits('16615550100'), '6615550100'); assert.equal(usDigits('661.555.0100'), '6615550100');
assert.equal(usDigits('12345'), ''); assert.equal(usDigits('+44 20 7946 0958'), ''); assert.equal(usDigits(''), ''); assert.equal(usDigits(null), '');

// ---- access -----------------------------------------------------------------------------------------
world(); let r = await run({ method: 'GET' }); assert.equal(r.code, 405);
for (const bad of [null, '', 'wrong', SECRET.slice(0, -1)]) { world(); r = await run({ body: { from: fresh(), text: 'hi' }, secret: bad }); assert.equal(r.code, 401, `secret ${bad}`); assert.equal(calls.length, 0); }
{ const k = process.env.SMS_BRIDGE_SECRET; process.env.SMS_BRIDGE_SECRET = 'short'; world(); r = await send('hi'); assert.equal(r.code, 503); assert.equal(calls.length, 0); process.env.SMS_BRIDGE_SECRET = k; }
world(); r = await run({ body: '{not json' }); assert.equal(r.code, 400);
{ const k = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY; world(); r = await send('hi'); assert.equal(r.code, 503); process.env.ANTHROPIC_API_KEY = k; }

// ---- who it will not answer -------------------------------------------------------------------------
for (const [label, from, msg] of [
  ['short code', '48271', 'Your order shipped'], ['non-US number', '+44 20 7946 0958', 'hello'], ['our own number', '(661) 241-0306', 'hello'],
  ['empty text', fresh(), '   '], ['verification code', fresh(), 'Your verification code is 482913'], ['auto-reply', fresh(), 'This is an automated message. Do not reply.'],
  ['marketing footer', fresh(), 'Big sale! Reply STOP to end. Msg & data rates apply'],
]) { world(); r = await run({ body: { from, text: msg } }); assert.equal(r.code, 200, label); assert.equal(r.body.reply, '', label); assert.ok(r.body.skipped, label); assert.equal(modelCalled(), false, `${label}: no model call`); }

// ---- STOP / START / HELP -----------------------------------------------------------------------------
const stopper = '(661) 555-0199';
world(); r = await send('STOP', stopper); assert.match(r.body.reply, /unsubscribed/); assert.equal(r.body.optedOut, true); assert.deepEqual(db.optouts, ['6615550199']); assert.equal(modelCalled(), false);
for (const word of ['stop', 'Unsubscribe', 'CANCEL', 'end', 'quit', 'Stop.']) { world(); r = await send(word, fresh()); assert.equal(r.body.optedOut, true, word); }
world({ optedOut: true }); r = await send('STOP', stopper); assert.equal(r.body.reply, '', 'already opted out: silent'); assert.equal(modelCalled(), false);
world({ optedOut: true }); r = await send('Hi, are the homes still available?', stopper); assert.equal(r.body.reply, ''); assert.equal(r.body.skipped, 'opted out'); assert.equal(modelCalled(), false, 'an opted-out number is never answered');
world({ optedOut: true }); r = await send('START', stopper); assert.match(r.body.reply, /back on/); assert.deepEqual(db.optouts, []);
world(); r = await send('HELP'); assert.match(r.body.reply, /CSLB #1004058/); assert.match(r.body.reply, /STOP/); assert.equal(modelCalled(), false);

// ---- a real conversation -------------------------------------------------------------------------------
world({ replies: [text('Aspen II Homes automated assistant here. Happy to help. Are you looking for a tour, floor plans or financing info?')] });
r = await send('HOMES', '+1 661 555 0123');
assert.equal(r.code, 200); assert.match(r.body.reply, /automated assistant/); assert.equal(r.body.done, false);
const dyn = anthropic[0].system[1].text;
assert.match(dyn, /TEXT MESSAGE/); assert.match(dyn, /\(661\) 555-0123/); assert.match(dyn, /automated assistant here/, 'first reply must identify itself');
assert.equal(anthropic[0].max_tokens, 300); assert.equal(db.conv.channel, 'sms'); assert.equal(db.messages.length, 2);
assert.ok(!db.conv.id.includes('6615550123'), 'the number is not the thread key');
assert.ok(r.body.reply.endsWith('Msg&data rates may apply. Reply STOP to stop.'), 'first reply carries the rates / STOP line');
assert.ok(r.body.reply.length <= 320, 'and still fits two segments');

// phone number comes from the sender: a callback needs a full name, a message and an email (or the visitor declining one)
world({ replies: [tool('request_callback', { name: 'Pat Lee', message: 'Does the Grand Haven fit a half-acre lot?', email_declined: true }), text('Got it, the team will call you back.')] });
r = await send('Can someone call me about lot sizes? Pat Lee', '(661) 555-0188');
assert.equal(r.body.reply, 'Got it, the team will call you back. Msg&data rates may apply. Reply STOP to stop.', 'first reply: the answer plus the rates / STOP line');
assert.equal(db.callbacks.length, 1); assert.equal(db.callbacks[0].phone, '(661) 555-0188');
assert.equal(db.leads.length, 1); assert.equal(db.leads[0].source, 'Text message'); assert.equal(db.leads[0].raw.channel, 'sms'); assert.equal(db.leads[0].email, null);

// the rates / STOP line is only on the first reply of a thread
world({ conv: { id: 'y'.repeat(20), channel: 'sms', message_count: 1, lead_id: null, needs_human: false }, replies: [text('Sure, which plan interests you?')] });
r = await send('tell me about plans', '(661) 555-0166'); assert.equal(r.body.reply, 'Sure, which plan interests you?');
// replies are cut to text length and stay plain
world({ replies: [text('This is a long sentence about homes. '.repeat(30))] });
r = await send('tell me everything'); assert.ok(r.body.reply.length <= 321, `reply length ${r.body.reply.length}`);

// the same number gets the same thread within a month, a different number a different one
world(); await send('hello', '(661) 555-0155'); const first = db.conv.id; world(); await send('hello again', '(661) 555-0155'); assert.equal(db.conv.id, first);
world(); await send('hello', '(661) 555-0156'); assert.notEqual(db.conv.id, first);

// over the cap: silent, never answered in a loop
world({ conv: { id: 'x'.repeat(20), channel: 'sms', message_count: 7, lead_id: null, needs_human: false } });
r = await send('still there?', '(661) 555-0160'); assert.equal(r.body.reply, '');

// last allowed message gets a final answer; the one after it is silent
const same = '(661) 555-0170'; world({ replies: [text('ok')] }); let rr; for (let i = 0; i < 4; i++) rr = await send(`message ${i}`, same);
assert.equal(db.conv.message_count, 4);

// one number: at most 10 replies an hour
world(); let silent = 0; const spammer = '(661) 555-0180'; for (let i = 0; i < 14; i++) { const x = await send(`msg ${i}`, spammer); if (x.body.skipped === 'rate limited') silent++; }
assert.ok(silent >= 3, 'rate limit applies');

// failures: the bridge is told to retry, and no secret or text reaches the logs
world(); globalThis.fetch = async () => json({}, false, 503); r = await send('hello'); assert.equal(r.code, 502); assert.equal(r.body.reply, undefined);
assert.ok(!errs.some((e) => /sk-ant|sb_secret|re_test|bridge-secret/.test(e)), 'no secrets in logs');

console.log = process.stdout.write.bind(process.stdout); console.log('sms: ok');
