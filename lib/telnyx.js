// Telnyx helpers: verify an inbound webhook, read its raw body, and send a text.
// Facts confirmed against Telnyx's official SDK source (telnyx npm package, src/lib/webhooks.ts) and API docs:
//   * Headers: telnyx-signature-ed25519 (base64, 64 bytes) and telnyx-timestamp (unix seconds).
//   * Signed bytes: `${timestamp}|${exact raw request body}`, Ed25519.
//   * Public key: base64 of the raw 32-byte key (Mission Control > Account Settings > Keys & Credentials).
//   * Replay window: 300 seconds.
//   * Send: POST https://api.telnyx.com/v2/messages { from, to, text, type: 'SMS' } with Authorization: Bearer <API key>.
import { createPublicKey, verify } from 'node:crypto';

const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex'); // wraps a raw 32-byte key as an SPKI public key
const TOLERANCE_SECONDS = 300;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

const header = (headers, name) => {
  for (const [k, v] of Object.entries(headers || {})) if (k.toLowerCase() === name) return Array.isArray(v) ? v[0] : v;
  return undefined;
};

/** Returns { ok: true } or { ok: false, why }. Never throws. */
export function verifyTelnyxSignature({ rawBody, headers, publicKey, now = Date.now() }) {
  try {
    const signature = header(headers, 'telnyx-signature-ed25519');
    const timestamp = header(headers, 'telnyx-timestamp');
    if (!signature || !timestamp) return { ok: false, why: 'missing signature headers' };
    if (!/^\d+$/.test(timestamp)) return { ok: false, why: 'bad timestamp' };
    if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > TOLERANCE_SECONDS) return { ok: false, why: 'timestamp outside the 5-minute window' };
    if (!B64.test(signature) || !B64.test(publicKey || '')) return { ok: false, why: 'bad encoding' };
    const sig = Buffer.from(signature, 'base64');
    const raw = Buffer.from(publicKey, 'base64');
    if (sig.length !== 64) return { ok: false, why: 'bad signature length' };
    if (raw.length !== 32) return { ok: false, why: 'bad public key length' };
    const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, raw]), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(`${timestamp}|${rawBody}`), key, sig) ? { ok: true } : { ok: false, why: 'signature does not match' };
  } catch {
    return { ok: false, why: 'verification error' };
  }
}

/**
 * The request body exactly as sent, or null when it was already parsed into an object (the exact bytes are gone).
 * The stream must be read before anything touches req.body, because Vercel parses the body lazily on first access.
 */
export async function readRawBody(req) {
  if (typeof req.pipe === 'function' && req.readable) {
    const chunks = [];
    for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
    return Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  return null;
}

export async function sendTelnyxSms({ apiKey, from, to, text }) {
  const res = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from, to, text, type: 'SMS' }),
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw Object.assign(new Error('Telnyx send failed'), { code: `TELNYX_HTTP_${res.status}` });
}
