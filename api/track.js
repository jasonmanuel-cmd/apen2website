// Vercel Serverless Function: /api/track.js
// First-party analytics ingest, written by public/analytics.js.
//
// Privacy choices, deliberately:
//   * No cookies and no cross-site identifiers.
//   * No raw IP is ever sent by the browser or stored. The server derives a
//     daily-rotating salted hash from the edge IP only to count unique visitors,
//     then discards the IP.
//   * Referrers are stored as host only ("google.com"), never the full URL,
//     which would otherwise carry the search terms someone typed.
//   * No age or other personal characteristics are collected or inferred.
//   * The session id lives in sessionStorage, so it clears when the tab closes.
//
// Analytics is best effort: a failure here must never surface to a visitor, so
// errors return 202 and the page carries on regardless.
import { createHash } from 'node:crypto';
import { supabaseConfig, supabase } from '../lib/supabase-rest.js';

const DB_TIMEOUT_MS = 4000;
// A real visit sends a handful of beacons per page. This only stops floods.
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;
// Dwell time above this is a backgrounded tab, not attention. Clamped so a
// forgotten tab cannot inflate average engagement.
const MAX_DWELL_SECONDS = 1800;

const str = (v, max = 200) => (v == null ? '' : String(v)).trim().slice(0, max);
const errTag = (err) => String((err && (err.code || err.name)) || 'error');
// In-memory only, so it resets on redeploy. Good enough to stop a runaway script.
const hits = new Map();
const rateOk = (key) => {
  const now = Date.now();
  const rec = hits.get(key);
  if (!rec || rec.resetAt <= now) { hits.set(key, { n: 1, resetAt: now + RATE_WINDOW_MS }); return true; }
  rec.n += 1;
  return rec.n <= RATE_LIMIT;
};
const sweep = () => {
  const now = Date.now();
  for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
};
const cleaner = setInterval(sweep, RATE_WINDOW_MS);
if (cleaner.unref) cleaner.unref();

// Same trusted address the staff API uses, so the visitor hash cannot be forged
// from a spoofed header.
const clientIp = (req) =>
  str(req.headers['x-forwarded-for'], 200).split(',')[0].trim() ||
  str(req.headers['x-real-ip'], 60) ||
  '0.0.0.0';

const UA_BROWSERS = [
  [/edg\//i, 'Edge'],
  [/opr\/|opera/i, 'Opera'],
  [/samsungbrowser/i, 'Samsung Internet'],
  [/chrome|crios/i, 'Chrome'],
  [/firefox|fxios/i, 'Firefox'],
  [/safari/i, 'Safari'],
];

function parseUa(ua) {
  let device = 'other';
  if (/bot|crawler|spider|bingpreview|slurp|headlesschrome/i.test(ua)) device = 'bot';
  else if (/ipad|tablet|playbook|silk/i.test(ua)) device = 'tablet';
  else if (/mobi|iphone|android.*mobile|windows phone/i.test(ua)) device = 'mobile';
  else if (/windows|macintosh|x11|linux/i.test(ua)) device = 'desktop';

  let browser = 'Other';
  for (const [re, name] of UA_BROWSERS) if (re.test(ua)) { browser = name; break; }

  let os = 'Other';
  if (/windows/i.test(ua)) os = 'Windows';
  else if (/iphone|ipad|ios/i.test(ua)) os = 'iOS';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/mac os x|macintosh/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';

  return { device, browser, os };
}

const geo = (req) => {
  const decode = (v) => {
    if (!v) return null;
    try { return decodeURIComponent(v); } catch { return str(v, 80); }
  };
  return {
    country: decode(req.headers['x-vercel-ip-country']),
    region: decode(req.headers['x-vercel-ip-country-region']),
    city: decode(req.headers['x-vercel-ip-city']),
  };
};

/** Unique per day and irreversible. Rotates daily, so it cannot be tracked over time. */
const visitorHash = (ip) => {
  const day = new Date().toISOString().slice(0, 10);
  const salt = str(process.env.ANALYTICS_SALT, 200) || 'aspen-2-homes';
  return createHash('sha256').update(`${salt}:${day}:${ip}`).digest('hex').slice(0, 32);
};

const asStr = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
const orNull = (v) => (v === '' || v == null ? null : v);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }
  if (!rateOk(clientIp(req))) return res.status(429).json({ ok: false });

  const db = supabaseConfig();
  // Not configured, or deliberately not collected: acknowledge and stop. The
  // visitor never sees an error either way.
  if (!db) return res.status(202).json({ ok: true, stored: false });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ ok: false });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ ok: false });

  const sid = str(body.sid, 64);
  const type = str(body.type, 20);
  if (!sid || !type) return res.status(400).json({ ok: false });

  const path = str(body.path, 300) || '/';
  const pageToken = asStr(body.pageToken, 64);
  const now = new Date().toISOString();

  try {
    if (type === 'start') {
      const ua = str(req.headers['user-agent'], 400);
      const { device, browser, os } = parseUa(ua);
      const utm = body.utm && typeof body.utm === 'object' ? body.utm : {};
      await supabase(db, 'sessions?on_conflict=session_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
          session_id: sid,
          created_at: now,
          last_seen_at: now,
          visitor_hash: visitorHash(clientIp(req)),
          referrer_host: asStr(body.referrerHost, 120) ?? null,
          referrer_type: ['direct', 'search', 'social', 'referral', 'email', 'other'].includes(body.referrerType)
            ? body.referrerType : 'other',
          utm_source: asStr(utm.source, 100) ?? null,
          utm_medium: asStr(utm.medium, 100) ?? null,
          utm_campaign: asStr(utm.campaign, 100) ?? null,
          utm_term: asStr(utm.term, 100) ?? null,
          utm_content: asStr(utm.content, 100) ?? null,
          entry_path: path,
          device_type: device,
          browser,
          os,
          ...geo(req),
        })
      }, DB_TIMEOUT_MS);
    } else if (type === 'pageview') {
      // pageToken is what lets the later dwell flush update this same row.
      await supabase(db, 'visits', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ session_id: sid, path, title: asStr(body.title, 200) ?? null, page_token: pageToken ?? null })
      }, DB_TIMEOUT_MS);
      await supabase(db, 'rpc/bump_session', {
        method: 'POST',
        body: JSON.stringify({ p_session_id: sid, p_page_views: 1, p_duration_seconds: 0, p_exit_path: path })
      }, DB_TIMEOUT_MS);
    } else if (type === 'heartbeat' || type === 'end') {
      // Both attribute the time just spent to the page view that just finished.
      // Every earlier page sent its own heartbeat as the visitor navigated away,
      // so the client total is ignored here — adding it would double-count.
      const dwell = Math.min(Math.max(Number(body.durationSeconds) || 0, 0), MAX_DWELL_SECONDS);
      if (dwell > 0 && pageToken) {
        await supabase(db, `visits?page_token=eq.${encodeURIComponent(pageToken)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ duration_seconds: dwell })
        }, DB_TIMEOUT_MS);
      }
      if (dwell > 0) {
        await supabase(db, 'rpc/bump_session', {
          method: 'POST',
          body: JSON.stringify({ p_session_id: sid, p_page_views: 0, p_duration_seconds: dwell, p_exit_path: path })
        }, DB_TIMEOUT_MS);
      }
    } else {
      return res.status(400).json({ ok: false });
    }
    return res.status(200).json({ ok: true, stored: true });
  } catch (err) {
    // Analytics must never surface an error to the visitor, and the message can
    // contain a session id, so log only a short tag.
    console.error('Analytics ingest failed:', errTag(err));
    return res.status(202).json({ ok: true, stored: false });
  }
}
