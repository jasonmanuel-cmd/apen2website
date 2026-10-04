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

## Still needed from the owner (2026-10-04 architecture brief)

Built pages say only what the data file can support. These items stay unpublished until confirmed in writing:

- **Legal/public name, CSLB license, staffed office or service-area only, business hours.** Then set `site.license` and align Google Business Profile, BBB, BuildZoom and social profiles to the same name, address and phone.
- **One reply-time promise.** The site uses `site.followUp` everywhere; the old WordPress copy said 1 to 2 business days.
- **Warranty.** The site said both "1-year" and "10-year"; both are now neutral ("ask for coverage details") until the real document is linked.
- **Incentive terms:** start/end dates, eligible homes/lots, who funds each credit, combinability; lender-approved wording. Update `site.verified` whenever re-checked.
- **Heroes of the Nation:** the "100% money-back guarantee" and "$100 for your time" claims on that page need written confirmation or removal.
- **Included features** list (exterior, HVAC, windows, appliances, etc.) for an `/included-features/` page.
- **Team, credentials, completed-project years and locations** for About and Gallery.
- **Separate Golden Hills / Bear Valley Springs / Stallion Springs pages:** only once each has real, distinct information.
- **aspen2bakersfield.com:** if owned, 301-redirect it here or give it a different purpose.
- **Buyer guides:** the 12 articles need real, reviewed facts; none were written.

## Hosting checklist

- Canonical host is `https://www.aspen2homes.com` (`site.url`, `astro.config.mjs`, `public/robots.txt`). Keep the apex domain as a single permanent redirect to www in Vercel > Domains.
- Set `RESEND_API_KEY`, `NOTIFICATION_EMAIL` and `RESEND_FROM` in Vercel. Without the key, the form now tells visitors to call instead of pretending it sent.
- Turn on Vercel > Analytics to start the cookieless page-view counts (the script is already in the layout).
- After deploying, submit `https://www.aspen2homes.com/sitemap.xml` in Google Search Console and request indexing of the main pages.
