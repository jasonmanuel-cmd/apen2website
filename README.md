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
