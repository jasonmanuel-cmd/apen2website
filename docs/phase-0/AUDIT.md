# Phase 0 baseline audit

Date: 2026-10-04. Auditor: Claude Code (cloud session). Spec: *Aspen II Claude Code Master Build Specification* v1.0 (2026-10-03).

## 1. Which source is the "existing site"

| Candidate | What it is | Evidence |
|---|---|---|
| `C:/Users/blunts/Desktop/Aspen II` (named in the spec) | Not reachable from this cloud session. | — |
| GitHub `jasonmanuel-cmd/aspen2`, `main` | The **old** static HTML/CSS/JS site (charcoal + gold, Inter/Fraunces, opening film, Harbison CRM endpoint in `main.js`). | Every token in spec §02 matches its `styles.css` exactly: `--bg #0B0D0F`, `--bg-2 #0E1113`, `--surface #14181B`, `--surface-2 #1A1F23`, `--ink #F4F2EC`, `--muted #9AA3A9`, `--gold #C9A75C`, `--gold-2 #E1C88C`, `--maxw 1240px`, `--ease cubic-bezier(0.16,1,0.3,1)`. The spec's "local CRM guide referencing Harbison" also matches this repo. So the Desktop folder is almost certainly a copy of this site. |
| GitHub `jasonmanuel-cmd/apen2website`, `main` (this repo) | The **live** site at www.aspen2homes.com: Astro 7, green/sand/gold palette, Gloock / Source Serif 4 / IBM Plex Mono. | Vercel project `aspen2-astro-preview` serves `aspen2homes.com` and `www.aspen2homes.com` from this repo. The owner chose this look on 2026-10-02 ("can we make it look like this") and called the charcoal site "an old version". |

**Conclusion:** the spec's visual baseline describes the site the owner retired. See Decision D1.

## 2. Hosting and runtime (this repo)

- Vercel project `aspen2-astro-preview` (team jasons-projects-1d845fc4), Git-connected to this repo.
- **Production deploys from branch `claude/aspen-2-homes-design-card-wk2tq5`** (the repo's default branch), not `main`. Both currently hold identical commits (`67c8d84`). Any push to that branch goes live; for this reason Phase 0 is committed locally and **not pushed** (spec item 16).
- Domains: `www.aspen2homes.com` (canonical today); apex `aspen2homes.com` 308-redirects to www (per the 2026-10-02 public audit). Spec wants the apex canonical; see Decision D2.
- Serverless: one function, `api/lead.js` (Node). No database, no cron, no auth, no object storage.
- Env vars present (names only): `RESEND_API_KEY` (production), `NOTIFICATION_EMAIL` (production + preview). `RESEND_FROM` not set (defaults to Resend's test sender).
- Analytics: Vercel Web Analytics script (cookieless). No GA4, no consent banner, no Search Console access in this session.
- Security headers: nosniff, Referrer-Policy, X-Frame-Options SAMEORIGIN, Permissions-Policy. No CSP.

## 3. Routes today (20 public + thank-you)

`/`, `/sunset-retreat-tehachapi/`, `/floor-plans/`, six models at `/<slug>/` (tranquil-oasis, sunset-retreat, the-tranquil-abode, sunrise-view-residence, enchanted-haven, the-grand-haven), four area pages (`/tehachapi-home-builders/`, `/golden-hills-bear-valley-and-stallion-springs-home-builder/`, `/california-city-ca-home-builders/`, `/ridgecrest-home-builders/`), `/how-it-works/`, `/financing/`, `/about/`, `/gallery/`, `/contact-us/`, `/privacy/`, `/thank-you/` (noindex), 404. Redirect: `/heroes-of-the-nation/` → `/financing/` (301).

Model and area slugs match the pre-2026 WordPress site, so they likely carry existing search equity. **A live crawl and Search Console landing-page export were not possible** from this session (egress to aspen2homes.com is blocked; no Search Console access). Required before redirects are configured.

## 4. Content facts available (src/data/site.ts)

- Six models with sqft / beds / baths / stories, summaries, highlights, photos (68 images across 5 models; The Grand Haven has blueprint only), six blueprint PDFs (`public/plans/`). Source for specs: prior live site; **no approved spec document on file** (spec §05 requires one).
- Garage descriptions, dimensions, customization limits: **not on file** (only Sunset Retreat lists a 2-car garage).
- Sunset Retreat release: from $459,000, Home 1 and Home 2 "Reserving", Phase 2 "Waitlist", ~3 months move-in; last confirmed September 2026. No approved public address, listing rights or price-approval date (spec inventory record needs these).
- Business identity: name, phone (661) 241-0306, Gmail address, 785 Tucker Road G295 Tehachapi (staffed vs mailing unknown). License, legal entity, hours: unknown.
- Financing: program list and disclaimers; no lender-approved terms or dates.

## 5. Forms and lead handling today

- One form component (`LeadForm.astro`) on home, contact, model, area and Sunset Retreat pages. Posts JSON (JS) or form-encoded (no JS) to `/api/lead`.
- `api/lead.js`: validation, length caps, honeypot, HTML escaping, per-recipient Resend email, routing tags, 503 when no email key, 303 redirect for no-JS posts. Tests: 17 passing.
- **Gap vs spec (critical):** leads are **not stored anywhere**. Delivery is the email itself. No idempotency, receipt, consent record, score, outbox, retries, staff inbox, rate limit or origin check. If Resend accepts but the email is lost, the lead is lost.

## 6. Performance snapshot (local build, gzip)

Home HTML 10.5 KB; per-page CSS 1–2.5 KB; own JS minimal (inline modules). Fonts load from Google Fonts (3 families), not self-hosted; spec asks self-hosted. Images: responsive WebP via Astro. No Lighthouse runs yet (Chromium available; to run in Phase 4).

## 7. Visual baseline captured

21 full-page screenshots of the current live build (commit `67c8d84`): home, floor-plans, model, Sunset Retreat community, Tehachapi area, contact, financing at 390 / 768 / 1440 px. Delivered to the owner as `baseline-67c8d84.zip`; not committed (keeps the repo lean).
