// Vercel Serverless Function: /api/hq/analytics.js
// Site analytics for the /hq dashboard: sessions, unique visitors, traffic
// sources, top pages, devices and geography.
//
// Privacy posture, matching the ingest side:
//   * No IP addresses are stored, so nothing to leak here. Unique-visitor counts
//     come from the daily-rotating hash already in the sessions table.
//   * Referrers are host only, because that is all that was ever collected.
//   * Coarse geography is region-level from the edge (city/state/country). No
//     precise location, ever.
//
// Access: Authorization: Bearer <STAFF_TOKEN>, the same password the staff lead
// inbox uses. With no (or a short) STAFF_TOKEN the endpoint stays closed.
// Same-origin only, never cached, and errors never echo database messages.
import { createHash, timingSafeEqual } from 'node:crypto';
import { supabaseConfig, supabase } from '../../lib/supabase-rest.js';

const MIN_TOKEN = 20;
const MAX_DAYS = 365;
const str = (v, max = 200) => (v == null ? '' : String(v)).trim().slice(0, max);
const errTag = (err) => String((err && (err.code || err.name)) || 'error');
const sha = (s) => createHash('sha256').update(s).digest();

const authorized = (req) => {
  const given = str(req.headers && req.headers.authorization, 600).replace(/^Bearer\s+/i, '');
  return given.length > 0 && timingSafeEqual(sha(given), sha(process.env.STAFF_TOKEN));
};

const tally = (values) => {
  const counts = new Map();
  for (const v of values) {
    const key = v || 'unknown';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key, value]) => ({ key, value }));
};

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
};

const tallyTop = (values, n) => tally(values).slice(0, n);

const get = async (db, path) => {
  const res = await supabase(db, path, {}, 8000);
  return res.json();
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }
  if (str(process.env.STAFF_TOKEN, 600).length < MIN_TOKEN) {
    console.error(`HQ analytics: STAFF_TOKEN missing or shorter than ${MIN_TOKEN} characters; endpoint is closed.`);
    return res.status(503).json({ ok: false, error: 'The dashboard is not set up yet.' });
  }
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'Wrong or missing password.' });

  const db = supabaseConfig();
  if (!db) {
    console.error('HQ analytics: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.');
    return res.status(503).json({ ok: false, error: 'The analytics database is not connected.' });
  }

  const days = Math.min(Math.max(parseInt((req.query || {}).days, 10) || 30, 1), MAX_DAYS);
  const since = new Date(Date.now() - days * 864e5).toISOString();
  // Bots would swamp the numbers, so they are recorded but never reported.
  const filter = `device_type=neq.bot&created_at=gte.${encodeURIComponent(since)}`;

  try {
    const [sessions, visits, leadCount] = await Promise.all([
      get(db, `sessions?select=session_id,created_at,visitor_hash,referrer_host,referrer_type,utm_source,utm_campaign,entry_path,exit_path,page_views,device_type,browser,os,country,region,city,duration_seconds&${filter}&order=created_at.desc&limit=20000`),
      get(db, `visits?select=path,duration_seconds&${filter.replace(/^device_type=neq\.bot&/, '')}&order=created_at.desc&limit=100000`),
      supabase(db, 'leads?select=id&created_at=gte.' + encodeURIComponent(since), {
        headers: { Prefer: 'count=exact' }
      }).then((r) => {
        const n = Number(String(r.headers.get('content-range') || '').split('/')[1]);
        return Number.isFinite(n) ? n : null;
      }).catch(() => null),
    ]);

    const durations = sessions.map((s) => s.duration_seconds ?? 0).filter((d) => d > 0);
    const totalDuration = durations.reduce((a, b) => a + b, 0);
    const pageViews = sessions.reduce((a, s) => a + (s.page_views ?? 0), 0);
    const uniqueVisitors = new Set(sessions.map((s) => s.visitor_hash).filter(Boolean)).size;

    // Daily series, oldest first, one bucket per calendar day in the window.
    const daily = new Map();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
      daily.set(d, { day: d, sessions: 0, pageViews: 0, duration: 0 });
    }
    for (const s of sessions) {
      const bucket = daily.get(String(s.created_at).slice(0, 10));
      if (!bucket) continue;
      bucket.sessions += 1;
      bucket.pageViews += s.page_views ?? 0;
      bucket.duration += s.duration_seconds ?? 0;
    }

    // Dwell time in buckets is the sum across all visitors that day.
    const totalDwellByPage = new Map();
    for (const v of visits) totalDwellByPage.set(v.path, (totalDwellByPage.get(v.path) ?? 0) + (v.duration_seconds ?? 0));

    // The visitor's own clock is not available, so buckets are UTC and the UI
    // labels them as such.
    const hourly = new Array(24).fill(0);
    for (const s of sessions) hourly[new Date(s.created_at).getUTCHours()] += 1;

    return res.status(200).json({
      ok: true,
      days,
      totals: {
        sessions: sessions.length,
        uniqueVisitors,
        pageViews,
        totalDurationSeconds: totalDuration,
        avgDurationSeconds: sessions.length ? Math.round(totalDuration / sessions.length) : 0,
        medianDurationSeconds: median(durations),
        pagesPerSession: sessions.length ? Number((pageViews / sessions.length).toFixed(2)) : 0,
        leadsInWindow: leadCount,
      },
      daily: [...daily.values()],
      referrers: tally(sessions.map((s) => s.referrer_type)),
      referrerHosts: tallyTop(sessions.map((s) => s.referrer_host), 10),
      campaigns: tallyTop(sessions.map((s) => s.utm_campaign), 10),
      sources: tallyTop(sessions.map((s) => s.utm_source), 10),
      devices: tally(sessions.map((s) => s.device_type)),
      browsers: tally(sessions.map((s) => s.browser)),
      operatingSystems: tally(sessions.map((s) => s.os)),
      countries: tallyTop(sessions.map((s) => s.country), 15),
      regions: tallyTop(sessions.map((s) => s.region), 15),
      cities: tallyTop(sessions.map((s) => s.city), 20),
      entryPages: tallyTop(sessions.map((s) => s.entry_path), 10),
      exitPages: tallyTop(sessions.map((s) => s.exit_path), 10),
      topPages: tallyTop(visits.map((v) => v.path), 15)
        .map((p) => ({ ...p, duration: totalDwellByPage.get(p.key) ?? 0 })),
      hourlyUtc: hourly.map((value, hour) => ({ hour, value })),
    });
  } catch (err) {
    console.error('HQ analytics database error:', errTag(err));
    return res.status(502).json({ ok: false, error: 'Could not reach the analytics database.' });
  }
}
