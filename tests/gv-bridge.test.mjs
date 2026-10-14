// Run: npm test. Checks how scripts/google-voice-bridge.gs reads a Google Voice notification email.
// The script itself runs in Google Apps Script; this loads its pure parsing function in a sandbox.
// The sample emails follow the format Google Voice uses as best as it is known; the owner confirms the real
// format with preview() before turning the bridge on (docs/google-voice-bridge.md).
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../scripts/google-voice-bridge.gs', import.meta.url), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(code, ctx);
const parse = (m) => vm.runInContext('parseGoogleVoiceEmail_', ctx)(m);

const signed = 'Authentication-Results: mx.google.com;\n       dkim=pass header.i=@google.com header.s=20230601;\n       spf=pass';
const base = {
  from: 'Google Voice <voice-noreply@google.com>',
  replyTo: '16612410306.16615550123.abc123XYZ@txt.voice.google.com',
  subject: 'New text message from (661) 555-0123',
  body: 'HOMES\n\nTo respond to this text message, reply to this email or visit Google Voice.\n\nYour account: aspen2homes@gmail.com',
  raw: signed,
};

let r = parse(base);
assert.equal(r.ok, true); assert.equal(r.from, '6615550123'); assert.equal(r.text, 'HOMES'); assert.equal(r.replyTo, '16612410306.16615550123.abc123XYZ@txt.voice.google.com');

// the two numbers can be in either order in the address
r = parse({ ...base, replyTo: '16615550123.16612410306.zzz@txt.voice.google.com' }); assert.equal(r.ok, true); assert.equal(r.from, '6615550123');
// a contact name in the subject (no number there): the number still comes from the reply address
r = parse({ ...base, subject: 'New text message from Pat Lee', body: 'Pat Lee: Is Home 2 still available?\n\nTo respond to this text message, reply to this email.' });
assert.equal(r.ok, true); assert.equal(r.from, '6615550123'); assert.equal(r.text, 'Is Home 2 still available?');
// a message that happens to contain a colon is left alone
r = parse({ ...base, body: 'Note: I can tour Saturday\n\nTo respond to this text message, reply to this email.' }); assert.equal(r.text, 'Note: I can tour Saturday');
// multi-line messages are joined; long ones are cut
r = parse({ ...base, body: 'Hi\nare you there?\n\nTo respond to this text message, reply.' }); assert.equal(r.text, 'Hi are you there?');
assert.equal(parse({ ...base, body: 'x'.repeat(5000) }).text.length, 600);
// regex characters in a contact name do not break the parser
r = parse({ ...base, subject: 'New text message from A.B (Realtor)', body: 'A.B (Realtor): hello\n\nTo respond to this text message, reply.' }); assert.equal(r.ok, true); assert.equal(r.text, 'hello');
// subject fallback when the address has only one number
r = parse({ ...base, replyTo: 'abc.def@txt.voice.google.com' }); assert.equal(r.ok, true); assert.equal(r.from, '6615550123');

// things it must refuse
const no = (m, why) => { const x = parse(m); assert.equal(x.ok, false); assert.match(x.why, why); };
no({ ...base, from: 'Evil <someone@example.com>' }, /not from Google Voice/);
no({ ...base, from: 'Google Voice <voice-noreply@google.com.evil.io>' }, /signed|reply address|not from/); // lookalike domain
no({ ...base, subject: 'New voicemail from Pat' }, /not a text message/);
no({ ...base, subject: 'New text message from Pat (picture)' }, /picture/);
no({ ...base, raw: '' }, /dkim/);
no({ ...base, raw: 'dkim=fail header.i=@google.com' }, /dkim/);
no({ ...base, replyTo: 'attacker@example.com' }, /reply address/);
no({ ...base, replyTo: 'x@txt.voice.google.com.evil.io' }, /reply address|sender/);
no({ ...base, replyTo: '' }, /reply address/);
no({ ...base, subject: 'New text message from Pat', replyTo: 'abc@txt.voice.google.com' }, /sender number/);
no({ ...base, replyTo: '16612410306.16612410306.x@txt.voice.google.com', subject: 'New text message from Pat' }, /sender number|our own/);
no({ ...base, body: '\n\nTo respond to this text message, reply.' }, /no message text/);

// ---- which messages get answered --------------------------------------------------------------------------------
const pick = (...a) => vm.runInContext('pickNewMessages_', ctx)(...a);
const T0 = 1_000_000;
const items = [
  { id: 'old', dateMs: T0 - 5000 },       // arrived before the bot was switched on: never answered
  { id: 'a', dateMs: T0 + 1000 },         // two texts from the same person (same Gmail thread)
  { id: 'b', dateMs: T0 + 3000 },
  { id: 'c', dateMs: T0 + 2000 },
];
assert.deepEqual(pick(items, [], T0, 10).map((i) => i.id), ['a', 'c', 'b'], 'oldest first, nothing from before switch-on');
assert.deepEqual(pick(items, ['a'], T0, 10).map((i) => i.id), ['c', 'b'], 'an answered message is not answered again, but the next text in its thread is');
assert.deepEqual(pick(items, ['a', 'b', 'c'], T0, 10), [], 'all done');
assert.deepEqual(pick(items, [], T0, 2).map((i) => i.id), ['a', 'c'], 'at most max per run');
assert.deepEqual(pick([], [], T0, 10), []);
assert.deepEqual(pick(items, [], T0 + 10_000, 10), [], 'switched on after all of them');
assert.ok(!/isUnread|addLabel|-label:/.test(code), 'does not depend on read/unread state or Gmail labels');

console.log('gv-bridge: ok');
