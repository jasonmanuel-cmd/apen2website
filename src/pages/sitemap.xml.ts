import { site, plans, communities } from '../data/site';

export function GET() {
  const paths = ['/', '/sunset-retreat-tehachapi/', '/floor-plans/', '/how-it-works/', '/about/', '/gallery/', '/contact-us/', '/heroes-of-the-nation/', '/financing/', '/privacy/', ...plans.map((p) => `/${p.slug}/`), ...communities.map((c) => `/${c.slug}/`)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `  <url><loc>${site.url}${p}</loc></url>`).join('\n')}
</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
}
