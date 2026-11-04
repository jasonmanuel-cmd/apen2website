// Run after npm run build: node tests/bedroom-notes.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const models = { 'tranquil-oasis': 3, 'sunset-retreat': 3, 'the-tranquil-abode': 3, 'sunrise-view-residence': 4, 'enchanted-haven': 3, 'the-grand-haven': 4 };
let count = 0;
for (const [slug, beds] of Object.entries(models)) {
  const html = readFileSync(`dist/floor-plans/${slug}/index.html`, 'utf8');
  const notes = [...html.matchAll(/<p\b[^>]*data-bedroom-note[^>]*>(.*?)<\/p>/g)];
  assert.equal(notes.length, slug === 'tranquil-oasis' ? 0 : 1, slug);
  count += notes.length;
  if (notes.length) assert.equal(notes[0][1], beds === 4 ? 'Four bedrooms are shown in this plan. Ask about layout options.' : 'Ask about the optional four-bedroom layout.');
  assert.match(html, new RegExp(`Bedrooms</dt>\\s*<dd[^>]*>${beds}</dd>`));
  assert.match(html, new RegExp(`name="description" content="[^"]*${beds} bed,`));
  const schemas = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(m => JSON.parse(m[1]));
  const findPlans = x => x && typeof x === 'object' ? [ ...(x['@type'] === 'FloorPlan' ? [x] : []), ...Object.values(x).flatMap(findPlans)] : [];
  const floorPlans = schemas.flatMap(findPlans);
  assert.equal(floorPlans.length, 1, slug);
  assert.equal(floorPlans[0].numberOfBedrooms, beds, slug);
}
assert.equal(count, 5);
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
assert.equal(walk('dist').filter(p => p.endsWith('.html')).reduce((n, p) => n + (readFileSync(p, 'utf8').match(/data-bedroom-note/g) || []).length, 0), 5);
console.log('Bedroom notes: exactly five, Oasis excluded, original bedroom specs, metadata and schema verified.');
