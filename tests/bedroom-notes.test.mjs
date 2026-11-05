// Run after npm run build. Verify actual rendered bedroom displays.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PLANS, KNOWLEDGE } from '../lib/chat-knowledge.js';
const slugs = ['tranquil-oasis', 'sunset-retreat', 'the-tranquil-abode', 'sunrise-view-residence', 'enchanted-haven', 'the-grand-haven'];
const read = path => readFileSync(`dist/${path}`, 'utf8');
const findPlans = x => x && typeof x === 'object' ? [...(x['@type'] === 'FloorPlan' ? [x] : []), ...Object.values(x).flatMap(findPlans)] : [];
for (const [i, slug] of slugs.entries()) {
  const beds = i < 2 ? 3 : 4;
  const label = i === 1 ? '3 bedrooms with a 4-bedroom option' : `${beds} bedrooms`;
  const html = read(`floor-plans/${slug}/index.html`);
  const notes = [...html.matchAll(/<p\b[^>]*data-bedroom-note[^>]*>(.*?)<\/p>/g)];
  assert.equal(notes.length, i === 1 ? 1 : 0, slug);
  if (notes.length) assert.equal(notes[0][1], 'The illustrated layout shows the 3-bedroom base plan. Ask about the optional fourth bedroom.');
  assert.match(html, new RegExp(`Bedrooms</dt>\\s*<dd[^>]*>${label}</dd>`));
  assert.match(html, new RegExp(`name="description" content="[^"]*${label},`));
  assert.match(html, new RegExp(`${beds}-bedroom floor plan by`));
  assert.match(html, new RegExp(`<span[^>]*>${label}</span>`), `${slug} sticky bar`);
  const schemas = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(m => JSON.parse(m[1]));
  const floorPlans = schemas.flatMap(findPlans);
  assert.equal(floorPlans.length, 1, slug);
  assert.deepEqual(floorPlans[0].numberOfBedrooms, beds, slug);
  assert.equal(PLANS[i][2], beds, `${slug} chat model`);
}
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
let cards = 0;
for (const path of walk('dist').filter(p => p.endsWith('.html'))) {
  const html = readFileSync(path, 'utf8');
  for (const [, slug, ariaLabel, body] of html.matchAll(/<a\b[^>]*href="\/floor-plans\/([^/]+)\/"[^>]*data-3d-card[^>]*aria-label="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const label = slug === 'sunset-retreat' ? '3 bedrooms with a 4-bedroom option' : `${slug === 'tranquil-oasis' ? 3 : 4} bedrooms`;
    assert.match(ariaLabel, new RegExp(`, ${label},`), path);
    assert.match(body, new RegExp(`>${label}</span>`), path);
    cards++;
  }
}
assert.ok(cards >= 30, `checked shared cards across pages: ${cards}`);
const listing = read('floor-plans/index.html');
const tags = [...listing.matchAll(/data-tags="([^"]*)"/g)].map(m => m[1].split(' '));
assert.equal(tags.length, 6);
assert.equal(tags.filter(t => t.includes('beds-3')).length, 2);
assert.equal(tags.filter(t => t.includes('beds-4')).length, 5);
assert.ok(!tags[0].includes('beds-4'));
const rows = [...listing.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].slice(1);
assert.equal(rows.length, 6);
rows.forEach(([row], i) => assert.match(row, new RegExp(`<td[^>]*>${i === 1 ? '3 bedrooms with a 4-bedroom option' : `${i === 0 ? 3 : 4} bedrooms`}</td>`)));
for (const page of ['index.html', 'available-homes/index.html', 'gallery/index.html', 'guides/new-home-costs-tehachapi/index.html', 'areas/tehachapi/index.html']) {
  assert.match(read(page), /3 bedrooms with a 4-bedroom option/, page);
}
assert.match(read('index.html'), /3 bedrooms with a 4-bedroom option/);
assert.match(read('available-homes/index.html'), /3 bedrooms with a 4-bedroom option/);
const llms = read('llms.txt');
assert.equal((llms.match(/\| 4 \|/g) || []).length, 4);
assert.match(llms, /Tranquil Oasis \| 1,507 \| 3 \|/);
const knowledge = KNOWLEDGE.flatMap(([, lines]) => lines).join('\n');
assert.match(knowledge, /1,715 sq ft, 3 bedrooms with a 4-bedroom option/);
assert.doesNotMatch(knowledge, /3 or 4/);
assert.match(llms, /Sunset Retreat \| 1,715 \| 3 bedrooms with a 4-bedroom option \|/);
assert.match(listing, /Bedroom filters include available options/);
console.log(`Bedroom options: six models, ${cards} cards, filters, comparison, metadata, JSON-LD, availability and chat verified.`);
