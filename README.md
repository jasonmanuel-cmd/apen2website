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
| Pages | `src/pages/` (plans & communities share `[slug].astro`) |
| Lead email handler | `api/lead.js` |

URLs match the old aspen2homes.com WordPress site so search rankings carry over.

## Lead emails (Resend)

Set these in Vercel > Project > Settings > Environment Variables (see `.env.example`):

- `RESEND_API_KEY`: from resend.com
- `NOTIFICATION_EMAIL`: who receives leads. Before the domain is verified in Resend, this must be your Resend account email.
- `RESEND_FROM`: keep `onboarding@resend.dev` until the domain is verified, then e.g. `Aspen II Homes <leads@aspen2homes.com>`.

Without `RESEND_API_KEY`, leads are accepted and only written to the Vercel function logs.

## Before launch

- Add the CSLB license number to `site.license` in `src/data/site.ts` (required on CA builder ads).

## Waiting on the owner (from the 2026-10-02 audit)

Code changes can't settle these; each needs a written answer from the owner or lender before the copy changes.

- **Callback promise:** the site says "within 30 minutes during business hours" (`site.followUp`). Confirm the real response time and business hours.
- **Warranty:** one place says 10-year builder warranty, another 1-year systems/appliances. Confirm coverage, provider and exclusions.
- **Offer terms:** Sunset Retreat price, "first two homes", move-in estimate, 0% down eligibility, $15,000 credit, 2-1 buydown.
- **Heroes of the Nation:** $359,000, 1,705 sq ft, $14,360 Hero Home Cash, eligibility, home location.
- **Lender:** officer name, NMLS number, company spelling.
- **Business facts:** legal name, whether the Tucker Road address is a staffed office, CSLB license (`site.license`).
- **Privacy notice** (`src/pages/privacy.astro`): written from what the site does today. Owner to approve the wording, data retention and SMS consent.

## Hosting checklist

- Canonical host is `https://www.aspen2homes.com` (`site.url`, `astro.config.mjs`, `public/robots.txt`). Keep the apex domain as a single permanent redirect to www in Vercel > Domains.
- Set `RESEND_API_KEY`, `NOTIFICATION_EMAIL` and `RESEND_FROM` in Vercel. Without the key, the form now tells visitors to call instead of pretending it sent.
- Turn on Vercel > Analytics to start the cookieless page-view counts (the script is already in the layout).
- After deploying, submit `https://www.aspen2homes.com/sitemap.xml` in Google Search Console and request indexing of the main pages.
