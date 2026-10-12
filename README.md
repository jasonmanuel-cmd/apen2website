# Aspen II Homes website

Astro static site with one serverless function (`api/lead.js`) that emails form leads through Resend.

## Run it

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # outputs dist/
npm test         # lead form handler tests (Resend mocked)
```

## Where things live

| What | Where |
|---|---|
| Prices, plans, offers, FAQ, communities, contact info | `src/data/site.ts` (edit here, every page updates) |
| Plan photos | `src/assets/photos/<plan>/` (captions in `src/data/captions.json`) |
| Blueprint images / PDFs | `src/assets/blueprints/`, `public/plans/` |
| Pages | `src/pages/` (models: `floor-plans/[slug].astro`; areas: `areas/[area].astro`, published only when `published: true`) |
| Lead email handler | `api/lead.js` |

URLs match the old aspen2homes.com WordPress site so search rankings carry over.

## Lead storage (Supabase) and emails (Resend)

Set these in Vercel > Project > Settings > Environment Variables (see `.env.example`):

- `RESEND_API_KEY`: from resend.com
- `NOTIFICATION_EMAIL`: who receives leads. Before the domain is verified in Resend, this must be your Resend account email.
- `RESEND_FROM`: `Aspen II Homes <leads@aspen2homes.com>` (aspen2homes.com is verified in Resend). Without it the code falls back to `onboarding@resend.dev`, which only delivers to the Resend account owner.

- `SUPABASE_URL`: the API URL of Supabase project `aspen2-leads` (Dashboard > Project Settings > API).
- `SUPABASE_SERVICE_ROLE_KEY`: the secret / service_role key from the same page. It bypasses row level security, so it is server-side only: Vercel env vars, never committed, never sent to the browser. Schema: `supabase/migrations/20261006000000_create_leads.sql` (RLS is on with no policies, so the public keys can read and write nothing).

How `api/lead.js` handles a submission:

1. Bots (honeypot) and invalid posts are rejected before anything is stored or sent.
2. The lead is stored in `public.leads` first.
3. The email goes out, and the result is written back to the row (`email_sent`, `email_error`).
4. The visitor sees an error only if the lead could be neither stored nor emailed. A stored lead whose email failed still counts as received; find those with `select * from public.leads where not email_sent;`.

Without the two Supabase variables the form still emails leads but stores nothing. Without `RESEND_API_KEY` leads are stored but not emailed; with neither, the form tells visitors to call.

## Supabase keep-alive

The leads database runs on Supabase's free plan, and free projects can be paused after a stretch with no activity. A paused project would keep emailing leads but silently stop storing them.

- `api/keepalive.js` reads one row from `public.leads` and returns only `{ "ok": true }`. Vercel Cron calls it once a day (`crons` in `vercel.json`, 14:17 UTC, production only).
- It uses the same `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as the lead form. Optionally set `CRON_SECRET` in Vercel so only the cron job can call it (Vercel sends it automatically).
- A failing run (database unreachable, keys missing) shows as a non-200 in Vercel > the project > Settings > Cron Jobs, and in the function logs. That is the early warning that leads are not being stored.
- Upgrading the Supabase plan removes the need for this, but the check is still a cheap health signal.

## HQ: leads and traffic in one place

`/hq/` is the staff dashboard. It has two tabs and opens with the same password as `/staff/`:

- **Leads** — the full lead inbox: statuses, assignment, follow-up dates, notes, search, and the email-not-sent filter. It reads the existing `/api/staff/leads` endpoint, so the old `/staff/` page keeps working unchanged.
- **Traffic** — sessions, unique visitors, page views, pages per session, engaged time, where visits came from, top and entry pages, devices, browsers, operating systems, busiest hours, and country/region/city.

Neither page is linked from the site, both send `noindex`, and both are in `robots.txt` and the `vercel.json` headers.

### What has to happen before traffic appears

Run `supabase/analytics-schema.sql` once in the Supabase SQL editor, in the **same** project that already holds `leads`. It adds `sessions`, `visits` and a `bump_session` function next to the existing table and does not touch `leads`. Without it the page loads but the Traffic tab shows its empty state; nothing else breaks.

### What is collected, and what is not

- **No IP is ever stored.** The server derives a salted hash of the edge IP to count unique visitors and then discards the IP. The salt includes the date, so the hash changes every day and one visitor cannot be tracked across days.
- **No cookies and no cross-site identifiers.** The session id is a random UUID in `sessionStorage`, so it clears when the tab closes.
- **Referrers are stored as host only** (`google.com`), never the full URL, which would carry the search terms someone typed.
- **Geography is edge-provided** country/state/city. Nothing more precise is available or collected.
- **Bots are excluded** from every figure (`device_type = 'bot'` is filtered at query time).
- **Do Not Track and Global Privacy Control are honoured**, and there is an explicit opt-out in `localStorage`.
- The browser sends no IP to `/api/track` at all — hashing happens server-side.

### Files

- `public/analytics.js` — the tracker, loaded on public pages only.
- `api/track.js` — ingest. Best effort: a database failure returns 202 and the visitor sees nothing.
- `api/hq/analytics.js` — the Traffic tab data, behind `STAFF_TOKEN`.
- `supabase/analytics-schema.sql` — run once by hand.

### Environment variables

- `STAFF_TOKEN` (required, 20+ characters) opens both `/staff/` and `/hq/`.
- `ANALYTICS_SALT` (optional) salts the visitor hash. Set it once and leave it. Without it a fixed default is used, which still rotates daily but means two sites sharing the default could be correlated. Changing it invalidates old hashes, so unique counts dip for a day.

### Tests

`npm test` runs six suites, all with Supabase mocked so nothing is contacted: the existing lead, keepalive and staff suites, plus `track`, `hq-analytics` and `hq-ui`. `hq-ui` drives the built `/hq` bundle through a DOM shim, so the render path, empty state and error path are exercised rather than only syntax-checked. Run `npm run build` before `npm test`, since `hq-ui` reads `dist/`.

## Waiting on the owner (from the 2026-10-02 audit)

Code changes can't settle these; each needs a written answer from the owner or lender before the copy changes.

- **Callback promise:** the site says "within 30 minutes during business hours" (`site.followUp`). Confirm the real response time and business hours.
- **Warranty:** one place says 10-year builder warranty, another 1-year systems/appliances. Confirm coverage, provider and exclusions.
- **Offer terms:** Sunset Retreat price, "first two homes", move-in estimate, 0% down eligibility, $15,000 credit, 2-1 buydown.
- **Lender:** officer name, NMLS number, company spelling.
- **Business facts:** legal name, whether the Tucker Road address is a staffed office.
- **Privacy notice** (`src/pages/privacy.astro`): written from what the site does today. Owner to approve the wording, data retention and SMS consent.

## Still needed from the owner (2026-10-04 architecture brief)

Built pages say only what the data file can support. These items stay unpublished until confirmed in writing:

- **Legal/public name, staffed office or service-area only, business hours.** Then align Google Business Profile, BBB, BuildZoom and social profiles to the same name, address and phone.
- **One reply-time promise.** The site uses `site.followUp` everywhere; the old WordPress copy said 1 to 2 business days.
- **Warranty.** The site said both "1-year" and "10-year"; both are now neutral ("ask for coverage details") until the real document is linked.
- **Incentive terms:** start/end dates, eligible homes/lots, who funds each credit, combinability; lender-approved wording. Update `site.verified` whenever re-checked.
- **Included features** list (exterior, HVAC, windows, appliances, etc.) for an `/included-features/` page.
- **Team, credentials, completed-project years and locations** for About and Gallery.
- **Separate Golden Hills / Bear Valley Springs / Stallion Springs pages:** only once each has real, distinct information.
- **aspen2bakersfield.com:** if owned, 301-redirect it here or give it a different purpose.
- **Buyer guides:** the 12 articles need real, reviewed facts; none were written.

## Hosting checklist

- Canonical host is `https://aspen2homes.com` (owner decision D2). Vercel > Domains serves the apex and 308-redirects `www` to it; `site.url`, `astro.config.mjs` and `public/robots.txt` must match.
- Set `RESEND_API_KEY`, `NOTIFICATION_EMAIL` and `RESEND_FROM` in Vercel. Without the key, the form now tells visitors to call instead of pretending it sent.
- Turn on Vercel > Analytics to start the cookieless page-view counts (the script is already in the layout).
- After deploying, submit the sitemap for whichever host is canonical in Google Search Console and request indexing of the main pages.

## Chat assistant and appointments

- Widget: `src/components/ChatWidget.astro` (loaded by `Layout.astro`). Talks to `api/chat.js`.
- Brain: `lib/chat-brain.js` (Anthropic Messages API, four tools: `save_contact`, `request_callback`, `request_appointment`, `handoff`). Chats are capped at 7 visitor messages (`MAX_VISITOR_MESSAGES` in `lib/chat-knowledge.js`); the bot is told which message it is on and steers toward a callback or tour request as the cap nears. Rules and facts the bot may state live in `lib/chat-knowledge.js`; `tests/chat.test.mjs` fails if those facts drift from `src/data/site.ts`.
- Storage: `supabase/chat-schema.sql` (conversations, messages, appointments; RLS on, no policies). Run it once in the Supabase SQL editor. Chat leads land in `public.leads` with source `Website chat` and are emailed to staff.
- Staff: `/hq/` has Chats, Callbacks and Appointments tabs (`api/hq/chat.js`, same STAFF_TOKEN). Appointments are requests until staff confirm them.
- Env: `ANTHROPIC_API_KEY` (required), `CHAT_MODEL` (optional). Without the key the widget tells visitors to call the office.
- Google Voice: it has no API, so it cannot be automated. Staff emails and the Callbacks tab carry tap-to-call and tap-to-text links; on a phone where Google Voice is the default calling/texting app they open there. Real two-way texting needs the number moved to Twilio.
- Texting (Twilio) is not built yet; `lib/chat-brain.js` is written so an SMS webhook can reuse it.
