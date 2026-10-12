/**
 * Lightweight first-party analytics.
 *
 * Loaded on every public page. Kept in public/ rather than bundled so it costs
 * nothing until it runs, and so it cannot pull the rest of the page bundle
 * with it.
 *
 * Privacy choices, deliberately:
 *   * No cookies, no cross-site identifiers.
 *   * No IP is ever sent from the browser. The server hashes the edge IP with a
 *     daily-rotating salt purely to count unique visitors, then discards it.
 *   * Referrers are sent as host only, never the full URL.
 *   * Honours Do Not Track and Global Privacy Control, plus an explicit opt-out.
 *
 * The session id lives in sessionStorage, so it clears when the tab closes. A
 * returning visitor is therefore counted as new, which slightly overstates
 * uniques.
 */

const SESSION_KEY = 'a2_sid';
const START_KEY = 'a2_t0';
const LAST_KEY = 'a2_last';
const PAGE_TOKEN_KEY = 'a2_ptok';
const CONSENT_KEY = 'a2_analytics';
// Set once the acquisition 'start' has been sent. Kept separate from LAST_KEY,
// which flush() clears on tab-hide — keying 'start' off LAST_KEY would re-send
// it after every tab switch and overwrite the session's entry page.
const STARTED_KEY = 'a2_started';

export function analyticsAllowed() {
  if (typeof window === 'undefined') return false;
  if (navigator.doNotTrack === '1') return false;
  if (navigator.globalPrivacyControl === true) return false;
  try {
    if (window.localStorage.getItem(CONSENT_KEY) === 'off') return false;
  } catch {
    /* storage blocked — treat as allowed, the beacon is harmless */
  }
  return true;
}

export function optOutOfAnalytics() {
  try {
    window.localStorage.setItem(CONSENT_KEY, 'off');
  } catch {
    /* ignore */
  }
}

/**
 * The current session id, or null when storage is blocked.
 *
 * Exported so a lead can be attributed to the visit that produced it.
 * Analytics being opted out must NOT suppress this: the id is a random UUID in
 * sessionStorage, used only to join the lead to its own sessions row.
 */
export function getSessionId() {
  if (typeof window === 'undefined') return null;
  try {
    let id = window.sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.sessionStorage.setItem(SESSION_KEY, id);
      window.sessionStorage.setItem(START_KEY, String(Date.now()));
    }
    return id;
  } catch {
    return null;
  }
}

function sessionId() {
  return getSessionId() ?? crypto.randomUUID();
}

function send(payload, useBeacon = false) {
  const body = JSON.stringify(payload);
  if (useBeacon && navigator.sendBeacon) {
    navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }));
    return;
  }
  void fetch('/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: useBeacon,
  }).catch(() => {
    /* analytics must never surface an error to the visitor */
  });
}

function classifyReferrer(host) {
  if (!host) return 'direct';
  const h = host.toLowerCase();
  if (/google|bing|duckduckgo|yahoo|baidu|yandex|ecosia|brave/.test(h)) return 'search';
  if (/facebook|instagram|twitter|x\.com|linkedin|tiktok|pinterest|reddit|youtube|threads|mastodon/.test(h)) return 'social';
  if (/mail|outlook|gmail|yahoo\.com/.test(h)) return 'email';
  return 'referral';
}

export function trackPageView(title) {
  if (!analyticsAllowed()) return;
  const sid = sessionId();
  const now = Date.now();

  // The first view of a session also captures the acquisition context.
  let isFirst = false;
  try { isFirst = !window.sessionStorage.getItem(STARTED_KEY); } catch { isFirst = true; }
  if (isFirst) {
    try { window.sessionStorage.setItem(STARTED_KEY, '1'); } catch { /* ignore */ }
    const params = new URLSearchParams(window.location.search);
    let referrerHost = null;
    try { referrerHost = document.referrer ? new URL(document.referrer).hostname : null; } catch { /* ignore */ }
    send({
      sid,
      type: 'start',
      path: window.location.pathname,
      referrerHost,
      referrerType: classifyReferrer(referrerHost),
      utm: {
        source: params.get('utm_source') ?? undefined,
        medium: params.get('utm_medium') ?? undefined,
        campaign: params.get('utm_campaign') ?? undefined,
        term: params.get('utm_term') ?? undefined,
        content: params.get('utm_content') ?? undefined,
      },
    });
  }

  // Charge the time spent on the previous page to that page. The token lets the
  // server update the existing row rather than adding another one.
  let last = null; let lastToken = null;
  try {
    last = window.sessionStorage.getItem(LAST_KEY);
    lastToken = window.sessionStorage.getItem(PAGE_TOKEN_KEY);
  } catch { /* ignore */ }
  if (last && lastToken) {
    const dwell = Math.min(Math.round((now - Number(last)) / 1000), 1800);
    if (dwell > 1) send({ sid, type: 'heartbeat', pageToken: lastToken, durationSeconds: dwell });
  }

  const pageToken = crypto.randomUUID();
  send({ sid, type: 'pageview', path: window.location.pathname, title: title ?? document.title, pageToken });
  try {
    window.sessionStorage.setItem(LAST_KEY, String(now));
    window.sessionStorage.setItem(PAGE_TOKEN_KEY, pageToken);
  } catch { /* ignore */ }
}

function flush() {
  if (!analyticsAllowed()) return;
  const sid = getSessionId();
  if (!sid) return;

  let last = null; let pageToken = null;
  try {
    last = window.sessionStorage.getItem(LAST_KEY);
    pageToken = window.sessionStorage.getItem(PAGE_TOKEN_KEY);
  } catch { /* ignore */ }

  const lastDwell = Math.min(Math.round((Date.now() - Number(last || Date.now())) / 1000), 1800);
  if (pageToken) {
    send({ sid, type: 'end', path: window.location.pathname, pageToken, durationSeconds: lastDwell }, true);
  }
  try {
    window.sessionStorage.removeItem(LAST_KEY);
    window.sessionStorage.removeItem(PAGE_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

let initialized = false;

export function initAnalytics() {
  if (initialized || !analyticsAllowed()) return;
  initialized = true;
  window.addEventListener('pagehide', flush);
  // Safari and Chrome sometimes skip pagehide; backstop on visibility change.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}
