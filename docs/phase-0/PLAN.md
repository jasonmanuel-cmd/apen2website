# Implementation plan, dependencies and acceptance gates

Phases follow spec §19. "Blocked by" lists only what stops that item; everything else proceeds.

## Phase 1: Templates and content (no external services)
- Extract shared components from current markup: breadcrumbs, model card, CTA block, FAQ accordion, proof module, form fields, success/error panels.
- Content records with build-time validation (`content/models`, `content/areas`, `content/homes`, `content/guides`): unknown specs = `null`, required fields checked, missing assets fail the build.
- Routes: `/`, `/build-on-your-lot/`, `/semi-custom-homes/`, `/floor-plans/` (compare up to 3), six `/floor-plans/<slug>/`, `/available-homes/` (+ Sunset Retreat entry once inventory fields are approved), `/our-process/`, `/financing/`, `/about/`, `/contact/`, `/areas/`, `/areas/tehachapi/`, `/accessibility/`, `/privacy/`, `/thank-you/`, `/warranty/` (draft until verified).
- Self-host fonts; spec nav + persistent Check My Lot button + mobile action bar.
- **Gate:** brand parity vs baseline at 390/768/1440; content validation passes; one H1, unique title/description, self-canonical on every page.
- Blocked by: D1 (palette), D2 (canonical host), approved model specs for garage/dimensions (else shown as "confirm with us").

## Phase 2: Lead intake (needs D4)
- `db/migrations/`: all spec §12 tables with constraints, RLS on every table, roles sales/reviewer/admin.
- `POST /api/leads`: spec §11 contract, Idempotency-Key, 201/200/409/422/413/429/503, 32 KB cap, origin check, honeypot + timing + rate limit, one transaction writing lead/project_request/lot_request/consent/score/receipt/outbox.
- Scoring v1 exactly per spec §14 with breakdown and override.
- Check My Lot: five steps, owned/under-contract needs one locator, land shoppers none, unknown always valid, no data in URL/localStorage.
- Outbox worker on Vercel Cron with backoff + jitter, failure alert; staff inbox behind Supabase Auth.
- Private upload endpoint (PDF/JPEG/PNG, 10 MB, 5 files, signature check, quarantine). Malware scanning needs a provider decision.
- **Gate:** real staging persistence, anonymous denial proven, replay/409/503 tests, worker retry evidence.

## Phase 3: SEO and measurement
- Live crawl + Search Console export → `redirects.csv` final; Vercel redirects; sitemap from content records; schema per spec §16 from the same records.
- Analytics events (spec §15) through one PII-free helper; generate_lead deduped by receipt.
- Resource guides only with reviewed sources (owner/content reviewer).
- **Gate:** crawl clean (no chains/loops/404s), schema parity, one conversion per accepted lead.

## Phase 4: Release candidate
Accessibility (keyboard, screen reader, 200%/400% zoom), devices, Lighthouse median of 3, payload budgets, load test on `/api/leads`, failure QA, backup/restore test, runbooks. **Gate:** no critical blockers; preview URL reviewed.

## Phase 5: Launch (owner authorization required)
Deploy, verify host/domain/TLS/live HTML separately, labeled production test lead end to end.

## Rough effort (after Phase 0)
Phase 1: 2–3 sessions. Phase 2: 3–4 sessions after Supabase is provisioned. Phase 3: 1–2 sessions after crawl access. Phase 4: 1–2 sessions. Content review time is the owner's and not included.

## Acceptance tests to build (spec §20)
- Content: six model records match approved facts; unknowns held; PDFs open.
- Flows: APN-only, address-only, pin-only accepted; land shopper with no parcel accepted; all-unknown accepted; model/area context arrives; tour needs real inventory_id.
- API: missing contact 422; bad enum 422; >32 KB 413; burst 429; DB down 503 with no success event; replay → same receipt 200; same key new body 409; two inquiries same contact → two project_requests.
- Atomicity: score + outbox exist for every request; email outage leaves pending outbox row; retry doesn't double-send; final failure alerts staff.
- Access: anonymous select/update/delete denied on every table; sales can't change roles; reviewer limited to lot review; no service key in `dist/`.
- Privacy: unchecked marketing → no marketing sends; GA/analytics payloads contain no PII (automated scan); logs redacted.
- SEO: crawl 200/301 only; JSON-LD parses and matches visible text; sitemap = indexable canonical pages.
- Device: 320/390/768/1440, keyboard-only, reduced motion.
