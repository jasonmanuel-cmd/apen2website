// Vercel Serverless Function: /api/telnyx.js
// Inbound text messages from a Telnyx number. Telnyx POSTs a webhook for every text; this answers with the same
// assistant as the website chat (lib/sms-core.js -> lib/chat-core.js) and sends the reply through Telnyx's API.
//
// Telnyx wants a 2xx within 2 seconds, and the assistant takes longer, so this acknowledges first and does the work
// in the background (waitUntil keeps the function alive after the response is sent). Webhook URL to set in Telnyx:
//   https://aspen2homes.com/api/telnyx?k=<TELNYX_WEBHOOK_SECRET>
//
// Who may call it:
//   * The `k` secret in the URL is mandatory (TELNYX_WEBHOOK_SECRET, 20+ characters). The endpoint is closed without it.
//   * When TELNYX_PUBLIC_KEY is set, Telnyx's Ed25519 signature is verified too and a bad one is refused. If the platform
//     has already parsed the body (so the exact bytes are gone) the signature cannot be checked; the URL secret still
//     gates the request and a warning is logged.
import { timingSafeEqual, createHash } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { supabaseConfig, supabase } from '../lib/supabase-rest.js';
import { str, errTag } from '../lib/chat-core.js';
import { answerText } from '../lib/sms-core.js';
import { verifyTelnyxSignature, readRawBody, sendTelnyxSms } from '../lib/telnyx.js';

// Ask Vercel not to parse the body, so the exact bytes can be verified. Harmless where it is ignored.
export const config = { api: { bodyParser: false } };

const MIN_SECRET = 20;
const DB_TIMEOUT_MS = 4000;
const sha = (s) => createHash('sha256').update(s).digest();
const urlSecretOk = (req) => {
  const given = str((req.query || {}).k, 300);
  return given.length > 0 && timingSafeEqual(sha(given), sha(process.env.TELNYX_WEBHOOK_SECRET));
};

// Telnyx can deliver the same event twice (retries). Remember message ids so a text is answered once.
// Fails open: if the table is missing we answer anyway rather than ignore a real customer.
const firstTimeSeen = async (db, id) => {
  if (!id) return true;
  try {
    const rows = await (await supabase(db, 'sms_seen?on_conflict=message_id', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ message_id: String(id).slice(0, 100) })
    }, DB_TIMEOUT_MS)).json();
    return rows.length > 0;
  } catch (err) {
    console.error('Telnyx dedupe unavailable:', errTag(err));
    return true;
  }
};

async function processInbound(db, payload) {
  try {
    const from = payload.from?.phone_number;
    const to = payload.to?.[0]?.phone_number || process.env.TELNYX_FROM_NUMBER;
    const text = str(payload.text, 600);
    if (!from || !to || !text) return;
    if (!(await firstTimeSeen(db, payload.id))) return;

    const result = await answerText(db, { from, text, secret: process.env.TELNYX_WEBHOOK_SECRET });
    if (!result.reply) return;
    await sendTelnyxSms({ apiKey: process.env.TELNYX_API_KEY, from: to, to: from, text: result.reply });
  } catch (err) {
    // Nothing to retry: Telnyx has already been told 200. The conversation is still in HQ if the model got that far.
    console.error('Telnyx inbound failed:', errTag(err));
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false }); }
  if (str(process.env.TELNYX_WEBHOOK_SECRET, 300).length < MIN_SECRET) {
    console.error(`Telnyx: TELNYX_WEBHOOK_SECRET missing or shorter than ${MIN_SECRET} characters; endpoint is closed.`);
    return res.status(503).json({ ok: false });
  }
  if (!urlSecretOk(req)) return res.status(401).json({ ok: false });

  const raw = await readRawBody(req);
  const publicKey = str(process.env.TELNYX_PUBLIC_KEY, 200);
  if (publicKey) {
    if (raw === null) {
      console.error('Telnyx: request body was already parsed, so the signature was not checked (URL secret still applied).');
    } else {
      const v = verifyTelnyxSignature({ rawBody: raw, headers: req.headers, publicKey });
      if (!v.ok) { console.error('Telnyx signature refused:', v.why); return res.status(401).json({ ok: false }); }
    }
  }

  let event;
  try { event = raw !== null ? JSON.parse(raw) : req.body; } catch { return res.status(400).json({ ok: false }); }
  const data = event && typeof event === 'object' ? event.data : null;
  const payload = data?.payload;
  // Delivery receipts and our own outbound messages come through the same webhook: acknowledge and ignore.
  if (data?.event_type !== 'message.received' || payload?.direction !== 'inbound') return res.status(200).json({ ok: true, ignored: true });

  const db = supabaseConfig();
  if (!db || !process.env.ANTHROPIC_API_KEY || !process.env.TELNYX_API_KEY) {
    console.error('Telnyx: SUPABASE_*, ANTHROPIC_API_KEY or TELNYX_API_KEY not set.');
    // Still 200: a retry would not help, and Telnyx would keep resending.
    return res.status(200).json({ ok: true, ignored: true });
  }

  // Acknowledge now (Telnyx needs a 2xx within 2 seconds); answer in the background.
  const work = processInbound(db, payload);
  try { waitUntil(work); } catch { /* not on Vercel: the promise simply runs to completion */ }
  return res.status(200).json({ ok: true });
}
