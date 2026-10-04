// Build-time content checks (spec §08). Imported by the layout, so any failure stops `astro build`.
import { existsSync, readdirSync } from 'node:fs';
import { plans, communities, faq, offer, site } from './site';

const errors: string[] = [];
const need = (ok: unknown, msg: string) => { if (!ok) errors.push(msg); };
const unique = (xs: string[], what: string) => xs.forEach((x, i) => need(xs.indexOf(x) === i, `duplicate ${what}: ${x}`));

unique(plans.map((p) => p.slug), 'model slug');
for (const p of plans) {
  const id = `model ${p.slug}`;
  need(/^[a-z0-9-]+$/.test(p.slug), `${id}: bad slug`);
  need(p.name && p.summary && p.headline && p.tagline && p.status, `${id}: missing text field`);
  need(Number.isInteger(p.sqft) && p.sqft > 300 && p.sqft < 10000, `${id}: implausible sqft ${p.sqft}`);
  need(Number.isInteger(p.beds) && p.beds > 0, `${id}: bad beds`);
  need(p.baths > 0 && (p.baths * 2) % 1 === 0, `${id}: bad baths`);
  need(p.stories === 1 || p.stories === 2, `${id}: stories must be 1 or 2`);
  need(p.price === undefined || (Number.isInteger(p.price) && p.price > 0), `${id}: price must be a whole positive number or absent`);
  need(p.garage === null || p.garage.length > 0, `${id}: garage must be null or text`);
  need(p.specReviewedAt === null || !Number.isNaN(Date.parse(p.specReviewedAt)), `${id}: specReviewedAt must be an ISO date or null`);
  need(existsSync(`public/plans/${p.slug}.pdf`), `${id}: missing public/plans/${p.slug}.pdf`);
  const hasPhotos = existsSync(`src/assets/photos/${p.folder}`) && readdirSync(`src/assets/photos/${p.folder}`).length > 0;
  need(hasPhotos || existsSync(`src/assets/blueprints/${p.folder}.webp`), `${id}: no photos and no blueprint image`);
}
unique(communities.map((c) => c.area), 'area slug');
for (const c of communities) {
  const id = `area ${c.area}`;
  need(c.title && c.h1 && c.description && c.intro, `${id}: missing text field`);
  need(!c.published || c.faq.length > 0, `${id}: published areas need at least one FAQ`);
}
need(communities.some((c) => c.published), 'at least one published area is required');
faq.forEach(([q, a, href], i) => need(q && a && href?.startsWith('/'), `faq ${i + 1}: needs question, answer and an internal link`));
need(offer.release.length > 0 && offer.from > 0, 'offer: release status and starting price required');
need(/^[A-Z][a-z]+ \d{4}$/.test(site.verified), 'site.verified must look like "September 2026"');
need(site.url === 'https://aspen2homes.com', 'site.url must be the canonical apex origin (decision D2)');

if (errors.length) throw new Error(`Content validation failed:\n- ${errors.join('\n- ')}`);
export const contentValid = true;
