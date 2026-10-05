import { site, plans, communities, planUrl, areaUrl } from '../data/site';

export function GET() {
  const paths = ['/', '/available-homes/', '/floor-plans/', '/semi-custom-homes/', '/our-process/', '/financing/', '/about/', '/gallery/', '/areas/', '/contact/', '/privacy/', '/accessibility/', '/guides/', '/guides/first-time-buyer-programs-kern-county/', '/guides/new-home-costs-tehachapi/', '/guides/tehachapi-weather-new-home/', ...plans.map(planUrl), ...communities.filter((c) => c.published).map(areaUrl)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `  <url><loc>${site.url}${p}</loc></url>`).join('\n')}
</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
}
