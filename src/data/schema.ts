import { site } from './site';

// JSON-LD helpers. Keep every value identical to what the page shows.
const abs = (path: string) => new URL(path, site.url).href;

export const breadcrumb = (items: [string, string][]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: abs(path) })),
});

export const faqPage = (qa: [string, string, ...string[]][]) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: qa.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
});

export const webPage = (path: string, name: string, description: string, extra: object = {}) => ({
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  url: abs(path),
  name,
  description,
  isPartOf: { '@type': 'WebSite', name: site.name, url: site.url },
  ...extra,
});
