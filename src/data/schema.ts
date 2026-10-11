import { site } from './site';

// JSON-LD helpers. Keep every value identical to what the page shows.
const abs = (path: string) => new URL(path, site.url).href;

// Stable IDs so every page's markup points at one business and one website (defined in Layout.astro).
export const ORG_ID = `${site.url}/#organization`;
export const SITE_ID = `${site.url}/#website`;

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
  isPartOf: { '@id': SITE_ID },
  publisher: { '@id': ORG_ID },
  ...extra,
});

// A home model as a schema.org FloorPlan. Bathroom counts are integers: 2.5 baths = 2 full + 1 half.
export const floorPlan = (path: string, p: { name: string; summary: string; sqft: number; beds: number; baths: number }, image?: string, layoutImage?: string) => {
  const full = Math.floor(p.baths);
  const partial = p.baths % 1 ? 1 : 0;
  return {
    '@context': 'https://schema.org',
    '@type': 'FloorPlan',
    '@id': `${abs(path)}#floorplan`,
    url: abs(path),
    name: `${p.name} floor plan`,
    description: p.summary,
    ...(image && { image }),
    ...(layoutImage && { layoutImage }),
    floorSize: { '@type': 'QuantitativeValue', value: p.sqft, unitCode: 'FTK', unitText: 'sq ft' },
    numberOfBedrooms: p.beds,
    numberOfFullBathrooms: full,
    numberOfPartialBathrooms: partial,
    numberOfBathroomsTotal: full + partial,
  };
};
