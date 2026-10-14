// Run: npm test. Checks the Telnyx text-message webhook (/api/telnyx) with Supabase, Resend, Anthropic and Telnyx mocked.
// Signatures are real Ed25519, made with a throwaway key pair in the exact scheme Telnyx documents:
// sign(`${timestamp}|${raw body}`), base64 signature, base64 raw 32-byte public key.
import assert from 'node:assert';
import { generateKeyPairSync, sign } from 'node:crypto';
import { Readable } from 'node:stream';
import handler from '../api/telnyx.js';
import { verifyTelnyxSignature } from '../lib/telnyx.js';

const SB = 'https://abc123.supabase.co';
const SECRET = 'telnyx-webhook-secret-0123456789abcdef';
const errs = []; console.error = (...a) => errs.push(a.join(' ')); console.log = () => {};
process.env.SUPABASE_URL = SB; process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test'; process.env.RESEND_API_KEY = 're_test';
process.env.TELNYX_WEBHOOK_SECRET = SECRET; process.env.TELNYX_API_KEY = 'KEY_telnyx_test';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PUB = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
process.env.TELNYX_PUBLIC_KEY = PUB;
const signBody = (raw, ts = Math.floor(Date.now() / 1000)) => ({ 'telnyx-signature-ed25519': sign(null, Buffer.from(`${ts}|${raw}`), privateKey).toString('base64'), 'telnyx-timestamp': String(ts) });

let n = 0;
const event = (o = {}) => ({
  data: {
    event_type: 'message.received', id: `evt-${++n}`,
    payload: { id: o.id ?? `msg-${n}`, direction: 'inbound', text: 'HOMES', from: { phone_number: `+16615551${String(n).padStart(3, '0')}` }, to: [{ phone_number: '+16615550100' }], ...o }
  }
});

const run = async ({ method = 'POST', query = { k: SECRET }, body, headers, stream = false, parsed = false } = {}) => {
  const out = { headers: {} };
  const res = { setHeader(k, v) { out.headers[k] = v; }, status(c) { out.code = c; return this; }, json(j) { out.body = j; return this; } };
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const req = stream ? Object.assign(Readable.from([Buffer.from(raw)]), { method, query, headers: headers ?? signBody(raw) })
    : { method, query, headers: headers ?? signBody(raw), body: parsed ? JSON.parse(raw) : raw };
  const t0 = Date.now(); await handler(req, res); out.ms = Date.now() - t0;
  return out;
};

const json = (j, ok = true, status = 200) => ({ ok, status, headers: new Headers(), json: async () => j, text: async () => '' });
let db, script, sent, anthropicDelay, seen, calls;
const world = ({ optedOut = false, replies = [], seenTableMissing = false, sendFails = false, delay = 0 } = {}) => {
  calls = []; sent = []; script = [...replies]; seen = new Set(); anthropicDelay = delay;
  db = { optouts: optedOut ? ['6615551001'] : [], conv: null, messages: [], leads: [], callbacks: [] };
  globalThis.fetch = async (url, opts = {}) => {
    url = String(url); const method = opts.method || 'GET'; calls.push({ url, method, body: opts.body });
    if (url === 'https://api.telnyx.com/v2/messages') {
      if (sendFails) return json({}, false, 422);
      sent.push({ ...JSON.parse(opts.body), auth: opts.headers.Authorization }); return json({ data: {} });
    }
    if (url.startsWith('https://api.anthropic.com')) { if (anthropicDelay) await new Promise((r) => setTimeout(r, anthropicDelay)); return script.length ? json(script.shift()) : json({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Aspen II Homes automated assistant here. What can I help with?' }] }); }
    if (url.startsWith('https://api.resend.com')) return json({ id: 'e' });
    const path = url.replace(`${SB}/rest/v1/`, '');
    if (path.startsWith('sms_seen')) {
      if (seenTableMissing) return json({}, false, 404);
      const id = JSON.parse(opts.body).message_id; if (seen.has(id)) return json([]); seen.add(id); return json([{ message_id: id }]);
    }
    if (path.startsWith('sms_optouts') && method === 'GET') { const p = path.match(/phone=eq\.([^&]+)/)[1]; return json(db.optouts.includes(p) ? [{ phone: p }] : []); }
    if (path.startsWith('sms_optouts') && method === 'POST') { db.optouts.push(JSON.parse(opts.body).phone); return json([]); }
    if (path.startsWith('sms_optouts') && method === 'DELETE') { db.optouts = []; return json([]); }
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
// The reply is sent after the webhook has already been acknowledged, so wait for it.
const settle = async (want = 1, ms = 1500) => { const end = Date.now() + ms; while (sent.length < want && Date.now() < end) await new Promise((r) => setTimeout(r, 10)); await new Promise((r) => setTimeout(r, 30)); };
const text = (t) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
const tool = (name, input) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name, input }] });

// ---- the verifier on its own ---------------------------------------------------------------------------
{
  const raw = '{"data":{"x":1}}'; const h = signBody(raw);
  assert.equal(verifyTelnyxSignature({ rawBody: raw, headers: h, publicKey: PUB }).ok, true);
  assert.equal(verifyTelnyxSignature({ rawBody: raw + ' ', headers: h, publicKey: PUB }).ok, false, 'one extra byte breaks it');
  assert.equal(verifyTelnyxSignature({ rawBody: raw, headers: { 'Telnyx-Signature-Ed25519': h['telnyx-signature-ed25519'], 'Telnyx-Timestamp': h['telnyx-timestamp'] }, publicKey: PUB }).ok, true, 'header names are case-insensitive');
  const old = signBody(raw, Math.floor(Date.now() / 1000) - 301); assert.match(verifyTelnyxSignature({ rawBody: raw, headers: old, publicKey: PUB }).why, /5-minute/);
  const future = signBody(raw, Math.floor(Date.now() / 1000) + 301); assert.equal(verifyTelnyxSignature({ rawBody: raw, headers: future, publicKey: PUB }).ok, false);
  const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
  assert.equal(verifyTelnyxSignature({ rawBody: raw, headers: h, publicKey: other }).ok, false, 'someone else\'s key');
  assert.equal(verifyTelnyxSignature({ rawBody: raw, headers: { ...h, 'telnyx-timestamp': 'abc' }, publicKey: PUB }).ok, false);
  assert.equal(verifyTelnyxSignature({ rawBody: raw, headers: {}, publicKey: PUB }).ok, false);
  assert.equal(verifyTelnyxSignature({ rawBody: raw, headers: { ...h, 'telnyx-signature-ed25519': 'AAAA' }, publicKey: PUB }).ok, false);
  assert.equal(verifyTelnyxSignature({ rawBody: raw, headers: h, publicKey: 'not base64!!' }).ok, false);
  assert.equal(verifyTelnyxSignature({ rawBody: raw, headers: h, publicKey: Buffer.alloc(31).toString('base64') }).ok, false);
}

// ---- access ---------------------------------------------------------------------------------------------
world(); let r = await run({ method: 'GET', body: {} }); assert.equal(r.code, 405);
{ const k = process.env.TELNYX_WEBHOOK_SECRET; process.env.TELNYX_WEBHOOK_SECRET = 'short'; r = await run({ body: event() }); assert.equal(r.code, 503); assert.equal(calls.length, 0); process.env.TELNYX_WEBHOOK_SECRET = k; }
for (const q of [{}, { k: '' }, { k: 'wrong' }, { k: SECRET.slice(0, -1) }]) { world(); r = await run({ body: event(), query: q }); assert.equal(r.code, 401, JSON.stringify(q)); await settle(1, 60); assert.equal(sent.length, 0); assert.equal(calls.length, 0); }

// ---- signature ------------------------------------------------------------------------------------------
world(); { const ev = event(); const raw = JSON.stringify(ev); r = await run({ body: raw }); assert.equal(r.code, 200); await settle(); assert.equal(sent.length, 1, 'valid signature is answered'); }
world(); { const raw = JSON.stringify(event()); r = await run({ body: raw.replace('HOMES', 'free money'), headers: signBody(raw) }); assert.equal(r.code, 401, 'body changed after signing'); await settle(1, 60); assert.equal(sent.length, 0); }
world(); r = await run({ body: event(), headers: { 'telnyx-signature-ed25519': 'x', 'telnyx-timestamp': '1' } }); assert.equal(r.code, 401);
world(); r = await run({ body: event(), headers: {} }); assert.equal(r.code, 401, 'no signature headers at all');
world(); { const raw = JSON.stringify(event()); r = await run({ body: raw, headers: signBody(raw, Math.floor(Date.now() / 1000) - 3600) }); assert.equal(r.code, 401, 'replayed an hour later'); }
world(); { const raw = JSON.stringify(event()); r = await run({ body: raw, stream: true }); assert.equal(r.code, 200); await settle(); assert.equal(sent.length, 1, 'verified from the raw request stream'); }
// platform already parsed the body: exact bytes are gone, so only the URL secret protects the request (logged)
world(); errs.length = 0; r = await run({ body: event(), parsed: true }); assert.equal(r.code, 200); await settle(); assert.equal(sent.length, 1); assert.ok(errs.some((e) => /not checked/.test(e)));
// no public key configured: the URL secret alone is enough
{ const k = process.env.TELNYX_PUBLIC_KEY; delete process.env.TELNYX_PUBLIC_KEY; world(); r = await run({ body: event(), headers: {} }); assert.equal(r.code, 200); await settle(); assert.equal(sent.length, 1); process.env.TELNYX_PUBLIC_KEY = k; }

// ---- what it acknowledges and ignores -------------------------------------------------------------------
world(); r = await run({ body: { data: { event_type: 'message.finalized', payload: { direction: 'outbound', text: 'hi' } } } }); assert.equal(r.code, 200); assert.equal(r.body.ignored, true);
world(); r = await run({ body: { data: { event_type: 'message.received', payload: { direction: 'outbound', text: 'hi', from: { phone_number: '+16615550100' }, to: [{ phone_number: '+16615551234' }] } } } }); assert.equal(r.body.ignored, true);
world(); r = await run({ body: event({ text: '' }) }); assert.equal(r.code, 200); await settle(1, 60); assert.equal(sent.length, 0, 'picture-only text is not answered');
world(); r = await run({ body: '{not json', headers: signBody('{not json') }); assert.equal(r.code, 400);
world(); r = await run({ body: { nope: true } }); assert.equal(r.body.ignored, true);

// ---- acknowledging fast, answering after ----------------------------------------------------------------
world({ delay: 400 }); r = await run({ body: event() }); assert.equal(r.code, 200); assert.ok(r.ms < 200, `acknowledged in ${r.ms} ms, before the model answered`);
assert.equal(sent.length, 0, 'not answered yet at acknowledgement'); await settle(1, 3000); assert.equal(sent.length, 1, 'answered afterwards');

// ---- the reply ------------------------------------------------------------------------------------------
world(); { const ev = event({ text: 'HOMES', from: { phone_number: '+1 (661) 555-0123' } }); r = await run({ body: ev }); await settle();
  assert.equal(sent.length, 1); const m = sent[0];
  assert.equal(m.to, '+1 (661) 555-0123'); assert.equal(m.from, '+16615550100'); assert.equal(m.type, 'SMS'); assert.equal(m.auth, 'Bearer KEY_telnyx_test');
  assert.match(m.text, /automated assistant/); assert.ok(m.text.length <= 321);
  assert.equal(db.conv.channel, 'sms'); }
// a callback needs only a name and a message; the number is the sender's
world({ replies: [tool('request_callback', { name: 'Pat Lee', message: 'Can you call about lot sizes?' }), text('Got it, the team will call you back.')] });
r = await run({ body: event({ text: 'please call me, Pat Lee', from: { phone_number: '+16615550188' } }) }); await settle();
assert.equal(db.callbacks.length, 1); assert.equal(db.callbacks[0].phone, '(661) 555-0188'); assert.equal(db.leads[0].source, 'Text message'); assert.equal(sent[0].text, 'Got it, the team will call you back.');

// STOP: a confirmation, then silence for that number, and START turns it back on
world(); { const from = { phone_number: '+16615551001' }; await run({ body: event({ text: 'STOP', from }) }); await settle(); assert.match(sent[0].text, /unsubscribed/);
  await run({ body: event({ text: 'Are the homes still available?', from }) }); await settle(2, 120); assert.equal(sent.length, 1, 'no reply after STOP');
  await run({ body: event({ text: 'START', from }) }); await settle(2); assert.match(sent[1].text, /back on/); }
// never answers: our own number, a short code, a non-US number, automated text
for (const [label, ev] of [['our own number', event({ from: { phone_number: '+16612410306' } })], ['short code', event({ from: { phone_number: '48271' }, text: 'Your order shipped' })], ['non-US', event({ from: { phone_number: '+442079460958' } })], ['automated', event({ text: 'This is an automated message. Do not reply.' })]]) {
  world(); await run({ body: ev }); await settle(1, 80); assert.equal(sent.length, 0, label); }

// ---- the same message is answered once --------------------------------------------------------------------
world(); { const ev = event({ id: 'dup-1', from: { phone_number: '+16615551777' } }); await run({ body: ev }); await run({ body: ev }); await settle(2, 300); assert.equal(sent.length, 1, 'a retried webhook is answered once'); }
world({ seenTableMissing: true }); { await run({ body: event({ from: { phone_number: '+16615551778' } }) }); await settle(); assert.equal(sent.length, 1, 'dedupe table missing: answer anyway'); }

// ---- failures stay quiet and keep secrets out of the logs ----------------------------------------------------
world({ sendFails: true }); errs.length = 0; r = await run({ body: event({ from: { phone_number: '+16615551779' } }) }); assert.equal(r.code, 200); await settle(1, 200);
assert.ok(errs.some((e) => /Telnyx inbound failed: TELNYX_HTTP_422/.test(e)));
world(); globalThis.fetch = async () => json({}, false, 503); r = await run({ body: event() }); assert.equal(r.code, 200); await settle(1, 100);
{ const k = process.env.TELNYX_API_KEY; delete process.env.TELNYX_API_KEY; world(); r = await run({ body: event() }); assert.equal(r.code, 200); assert.equal(r.body.ignored, true); process.env.TELNYX_API_KEY = k; }
assert.ok(!errs.some((e) => /sk-ant|sb_secret|re_test|KEY_telnyx|telnyx-webhook-secret/.test(e)), 'no secrets in logs');

console.log = process.stdout.write.bind(process.stdout); console.log('telnyx: ok');
