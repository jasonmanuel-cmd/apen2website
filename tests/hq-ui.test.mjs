// Drives the built /hq dashboard bundle against a DOM shim and a stubbed API,
// so the render path is exercised for real rather than only syntax-checked.
// Run: node tests/hq-ui.test.mjs   (after npm run build)
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';

const DIST = new URL('../dist/', import.meta.url).pathname.replace(/^\//, '');
const html = fs.readFileSync(`${DIST}hq/index.html`, 'utf8');
const bundleName = html.match(/_astro\/index\.astro_astro_type_script[^"]+\.js/)[0];
const code = fs.readFileSync(`${DIST}${bundleName}`, 'utf8');

const day = (n) => new Date(Date.now() - n * 864e5).toISOString();
const tally = (v) => {
  const m = new Map();
  for (const x of v) { const k = x || 'unknown'; m.set(k, (m.get(k) || 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1]).map(([key, value]) => ({ key, value }));
};
const sessions = [
  { session_id: 's1', created_at: day(0), visitor_hash: 'h1', referrer_host: 'google.com', referrer_type: 'search', utm_source: 'google', utm_campaign: 'spring', entry_path: '/', exit_path: '/floor-plans/', page_views: 4, device_type: 'mobile', browser: 'Safari', os: 'iOS', country: 'US', region: 'CA', city: 'Bakersfield', duration_seconds: 140 },
  { session_id: 's2', created_at: day(1), visitor_hash: 'h2', referrer_host: null, referrer_type: 'direct', utm_source: null, utm_campaign: null, entry_path: '/floor-plans/', exit_path: '/floor-plans/', page_views: 2, device_type: 'desktop', browser: 'Chrome', os: 'Windows', country: 'US', region: 'NV', city: 'Reno', duration_seconds: 25 },
];
const visits = [{ path: '/', duration_seconds: 80 }, { path: '/floor-plans/', duration_seconds: 220 }, { path: '/', duration_seconds: 12 }];

const makePayload = (days = 30) => {
  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    daily.push({ day: d, sessions: 0, pageViews: 0, duration: 0 });
  }
  for (const s of sessions) {
    const b = daily.find((x) => x.day === s.created_at.slice(0, 10));
    if (b) { b.sessions++; b.pageViews += s.page_views; b.duration += s.duration_seconds; }
  }
  const dw = new Map();
  for (const v of visits) dw.set(v.path, (dw.get(v.path) || 0) + v.duration_seconds);
  return {
    ok: true, days,
    totals: { sessions: 2, uniqueVisitors: 2, pageViews: 6, totalDurationSeconds: 165, avgDurationSeconds: 83, medianDurationSeconds: 83, pagesPerSession: 3, leadsInWindow: 11 },
    daily,
    referrers: tally(sessions.map((s) => s.referrer_type)),
    referrerHosts: tally(sessions.map((s) => s.referrer_host)).slice(0, 10),
    campaigns: tally(sessions.map((s) => s.utm_campaign)).slice(0, 10),
    sources: tally(sessions.map((s) => s.utm_source)).slice(0, 10),
    devices: tally(sessions.map((s) => s.device_type)),
    browsers: tally(sessions.map((s) => s.browser)),
    operatingSystems: tally(sessions.map((s) => s.os)),
    countries: tally(sessions.map((s) => s.country)).slice(0, 15),
    regions: tally(sessions.map((s) => s.region)).slice(0, 15),
    cities: tally(sessions.map((s) => s.city)).slice(0, 20),
    entryPages: tally(sessions.map((s) => s.entry_path)).slice(0, 10),
    exitPages: tally(sessions.map((s) => s.exit_path)).slice(0, 10),
    topPages: tally(visits.map((v) => v.path)).slice(0, 15).map((p) => ({ ...p, duration: dw.get(p.key) || 0 })),
    hourlyUtc: Array.from({ length: 24 }, (_, h) => ({ hour: h, value: h > 18 && h < 23 ? 3 : 0 })),
  };
};

// --- DOM shim ---------------------------------------------------------------
class El {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.attrs = {}; this.style = '';
    this.textContent = ''; this.className = ''; this.hidden = false;
    this.tabIndex = 0; this.listeners = {}; this.value = ''; this.checked = false;
  }
  append(...k) { this.children.push(...k.flat().filter(Boolean)); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  removeEventListener() {}
  dispatch(ev, arg = {}) { for (const fn of this.listeners[ev] || []) fn({ preventDefault() {}, target: this, ...arg }); }
  focus() {}
  replaceChildren(...k) { this.children = k.flat().filter(Boolean); }
  get childElementCount() { return this.children.length; }
  querySelector(sel) { return walk(this).find((e) => matches(e, sel)) || null; }
  querySelectorAll(sel) { return walk(this).filter((e) => matches(e, sel)); }
}
const walk = (root, out = []) => { for (const c of root.children) { out.push(c); walk(c, out); } return out; };
const matches = (el, sel) => sel.split(',').some((s) => {
  s = s.trim();
  if (s.startsWith('.')) return String(el.className).split(/\s+/).includes(s.slice(1));
  if (s.startsWith('[')) { const [, k, , v] = s.match(/\[([^=\]]+)(?:="([^"]*)")?\]/) || []; return v == null ? k in el.attrs : el.attrs[k] === v; }
  return el.tagName === s;
});

const ids = new Map();
const getEl = (id) => { if (!ids.has(id)) ids.set(id, new El('div')); return ids.get(id); };
// The tab buttons live in the document, not the shimmed getElementById map.
const tabLeads = new El('button'); tabLeads.id = 'tab-leads'; tabLeads.setAttribute('id', 'tab-leads'); tabLeads.setAttribute('aria-controls', 'view-leads'); tabLeads.setAttribute('role', 'tab'); tabLeads.setAttribute('aria-selected', 'true');
const tabAnalytics = new El('button'); tabAnalytics.id = 'tab-analytics'; tabAnalytics.setAttribute('id', 'tab-analytics'); tabAnalytics.setAttribute('aria-controls', 'view-analytics'); tabAnalytics.setAttribute('role', 'tab'); tabAnalytics.setAttribute('aria-selected', 'false');

const requests = [];
let nextPayload = makePayload();
const sandbox = {
  console,
  document: {
    title: 'HQ',
    documentElement: new El('html'),
    createElement: (t) => new El(t),
    getElementById: getEl,
    addEventListener() {},
    querySelectorAll: (sel) => (sel.includes('role') ? [tabLeads, tabAnalytics] : []),
  },
  window: { addEventListener() {}, location: { search: '' }, innerHeight: 800 },
  navigator: { doNotTrack: null, globalPrivacyControl: false },
  location: { search: '', pathname: '/hq/' },
  sessionStorage: (() => { const s = {}; return { getItem: (k) => s[k] ?? null, setItem: (k, v) => { s[k] = v; }, removeItem: (k) => { delete s[k]; } }; })(),
  localStorage: { getItem: () => null, setItem() {} },
  crypto: { randomUUID: () => 'uuid-' + Math.random().toString(16).slice(2) },
  matchMedia: () => ({ matches: false }),
  requestAnimationFrame: (f) => f(),
  setTimeout, clearTimeout,
  IntersectionObserver: function () { this.observe = () => {}; this.unobserve = () => {}; },
  URLSearchParams, URL, Date, JSON, Math, String, Number, Object, Array, RegExp, Error, Map, Set, Promise,
  fetch: async (url) => {
    requests.push(String(url));
    const path = String(url).split('?')[0];
    if (path === '/api/hq/analytics') return { ok: true, status: 200, json: async () => nextPayload };
    if (path === '/api/staff/leads') return { ok: true, status: 200, json: async () => ({ ok: true, leads: [], total: 0, newCount: 0, unsentCount: 0, limit: 50, offset: 0 }) };
    return { ok: false, status: 404, json: async () => ({}) };
  },
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'hq-bundle.js' });

// --- assertions -------------------------------------------------------------
const sleep = () => new Promise((r) => setTimeout(r, 0));

await sleep();
assert.ok(!getEl('login-msg').textContent.includes('error'), 'signs in without error when the API is healthy');

tabAnalytics.dispatch('click');
await sleep();
await sleep();

const body = getEl('an-body');
const rendered = getEl('an-body');
assert.ok(rendered.children.length > 0, 'the traffic view rendered');
const text = JSON.stringify(rendered);
for (const label of ['Sessions', 'Unique visitors', 'Page views', 'Pages / session', 'Avg engaged']) {
  assert.ok(text.includes(label), `missing stat: ${label}`);
}
assert.ok(text.includes('google.com'), 'referring site shown');
assert.ok(text.includes('Safari') && text.includes('Chrome'), 'browsers shown');
assert.ok(text.includes('Bakersfield'), 'cities shown');
assert.ok(text.includes('No IP addresses are stored'), 'privacy footnote shown');
assert.ok(text.includes('Direct'), 'direct traffic is labelled, not hidden');
assert.ok(text.includes('Direct / unknown'), 'visits with no referrer are labelled, not shown as a raw bucket key');
assert.ok(requests.some((u) => u.includes('/api/hq/analytics')), 'the traffic tab fetched analytics');
assert.ok(requests.some((u) => u.includes('days=30')), 'the default range is 30 days');

// Changing the range refetches.
const rangeButtons = getEl('range').children;
assert.equal(rangeButtons.length, 3, 'three range buttons');
rangeButtons.find((b) => b.textContent === '7 days').dispatch('click');
await sleep(); await sleep();
assert.ok(requests.some((u) => u.includes('days=7')), 'choosing 7 days refetches');

// The chart has one column per day, oldest first, and never a negative height.
const cols = getEl('an-body').querySelectorAll('.col');
assert.equal(cols.length, 30, 'one chart column per day');
for (const c of cols) {
  const h = Number(String(c.children[0].style).match(/height:([\d.]+)%/)?.[1] ?? 0);
  assert.ok(h >= 0 && h <= 100, `bar height out of range: ${h}`);
}

// A brand new install with no traffic must render an empty state, not zeros as
// if they were real figures, and not throw.
nextPayload = { ...makePayload(7), totals: { sessions: 0, uniqueVisitors: 0, pageViews: 0, totalDurationSeconds: 0, avgDurationSeconds: 0, medianDurationSeconds: 0, pagesPerSession: 0, leadsInWindow: null }, daily: makePayload(7).daily.map((d) => ({ ...d, sessions: 0, pageViews: 0 })), referrers: [], referrerHosts: [], campaigns: [], sources: [], devices: [], browsers: [], operatingSystems: [], countries: [], regions: [], cities: [], entryPages: [], exitPages: [], topPages: [], hourlyUtc: Array.from({ length: 24 }, (_, h) => ({ hour: h, value: 0 })) };
rangeButtons.find((b) => b.textContent === '7 days').dispatch('click');
await sleep(); await sleep();
const emptyText = JSON.stringify(getEl('an-body'));
assert.ok(emptyText.includes('No data yet'), 'empty state shown when there is no traffic');
assert.ok(emptyText.includes('—'), 'an unknown lead count shows a dash, not a fake 0');

// A failed request must show a message and must not wipe the signed-in shell.
nextPayload = null;
sandbox.fetch = async () => ({ ok: false, status: 502, json: async () => ({ error: 'Could not reach the analytics database.' }) });
rangeButtons.find((b) => b.textContent === '90 days').dispatch('click');
await sleep(); await sleep();
assert.equal(getEl('an-msg').textContent, 'Could not reach the analytics database.');
assert.equal(getEl('panel').hidden, false, 'a traffic error must not sign the user out');

console.log('hq ui: ok');
