import type { ImageMetadata } from 'astro';
import captions from './captions.json';

// Single source of truth. Facts come from aspen2homes.com and aspen2bakersfield.com (checked 2026-09-28).
export const site = {
  name: 'Aspen II Homes',
  tagline: "Kern County's Local Custom Home Builder",
  url: 'https://aspen2homes.com',
  phone: '(661) 238-3136',
  phoneHref: 'tel:+16612383136',
  sms: (body = 'HOMES') => `sms:+16612383136?body=${encodeURIComponent(body)}`,
  email: 'Aspen2homes@gmail.com',
  address: '785 Tucker Road G295, Tehachapi, CA 93561',
  followUp: 'within 30 minutes during business hours',
  license: '', // Not published on either site. Add the CSLB # here and it appears in the footer.
};

export const offer = {
  community: 'Sunset Retreat',
  city: 'Tehachapi, CA',
  from: 459000,
  sqft: 1715,
  moveIn: '~3 months',
  downPayment: '0%',
  earlyCredit: 15000,
  release: [
    ['Home 1', 'Reserving'],
    ['Home 2', 'Reserving'],
    ['Phase 2', 'Waitlist'],
  ],
};

export const financing = {
  programs: ['0% Down First-Time Buyer', 'FHA Low Down', 'VA Veterans', 'Conventional', '$15K Early-Buyer Credit'],
  perks: [
    ['0% Down Option', 'First-time buyer programs may let you get in with little to nothing down. Ask us to check your eligibility.'],
    ['Up to $15,000 Early-Buyer Savings', 'Reserve early and apply a credit of up to $15,000 directly toward your floor plan.'],
    ['2-1 Rate Buydown', 'Lower your interest rate by 2% in year one and 1% in year two, potentially hundreds a month in savings at the start.'],
    ['Closing-Cost Credit', 'Ask about credits that reduce your out-of-pocket at close, so getting into your new home costs less up front.'],
    ['1-Year Home Warranty', 'Peace of mind on all major systems and appliances for your first year of ownership.'],
    ['Lock Your Pricing Early', "Reserve during the first release to lock today's pricing before the next phase."],
  ],
  disclaimer: '0% down and savings programs are subject to eligibility, lender approval, and program terms, and may not be available to all buyers. Amounts, rates, and credits are estimates and are not a commitment to lend. This is not legal, tax, or financial advice.',
};

export const paths = [
  { n: '01', name: 'Reserve & Customize', title: 'Sunset Retreat', meta: '1,715 sq ft · Single-story · Tehachapi', price: 'From $459,000', badge: 'First 2 homes',
    text: 'The first two homes coming to Sunset Retreat. Lock your pricing and customize your finishes before they are built.', cta: ['Reserve now', '/contact-us/?interest=reserve'] },
  { n: '02', name: 'Semi-Custom', title: 'Choose Your Model', meta: 'Six layouts · Curated finishes', price: 'Call today',
    text: 'Pick from our proven model layouts and personalize the details that matter most. A guided path to a brand-new home.', cta: ['Compare models', '/#plans'] },
  { n: '03', name: 'Designed With You', title: 'Fully Custom', meta: 'Your vision · Premium lots', price: 'By design',
    text: 'Design your home from the ground up with our team: layout, materials and details tailored to how you live.', cta: ['Start a custom build', '/contact-us/?interest=custom'] },
];

// Photos live in src/assets/photos/<folder>/ and are picked up automatically, with captions from captions.json.
const all = import.meta.glob<{ default: ImageMetadata }>('../assets/photos/*/*.{jpg,jpeg,png,webp}', { eager: true });
const bps = import.meta.glob<{ default: ImageMetadata }>('../assets/blueprints/*.webp', { eager: true });
const caps = captions as Record<string, string>;
export type Photo = { src: ImageMetadata; caption: string };
export const photos = (folder: string): Photo[] =>
  Object.entries(all)
    .filter(([p]) => p.includes(`/photos/${folder}/`))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([p, m]) => ({ src: m.default, caption: caps[p.split('/photos/')[1]] ?? '' }));
export const blueprint = (folder: string) => bps[`../assets/blueprints/${folder}.webp`]?.default;

export type Plan = {
  slug: string;        // matches the live aspen2homes.com URL
  folder: string;      // photos + blueprint folder name
  name: string;
  sqft: number;
  beds: number;
  baths: number;
  stories: 1 | 2;
  price?: number;
  firstRelease?: boolean;
  rendering?: boolean;
  tagline: string;
  headline: string;
  summary: string;
  highlights: string[];
};

export const plans: Plan[] = [
  {
    slug: 'tranquil-oasis', folder: 'tranquil-oasis', name: 'Tranquil Oasis', sqft: 1507, beds: 3, baths: 2, stories: 1, tagline: 'Open-concept living',
    headline: 'Charming, efficient, easy to love.',
    summary: 'An open floor plan connects the living room, dining area and kitchen, with large windows pulling natural light through the whole home. The kitchen brings modern appliances, ample countertop space and sleek cabinetry.',
    highlights: ['Open living, dining & kitchen', 'Large windows throughout', 'Primary bedroom with private bath', 'Dedicated utility room'],
  },
  {
    slug: 'sunset-retreat', folder: 'sunset-retreat', name: 'Sunset Retreat', sqft: 1715, beds: 3, baths: 2, stories: 1, price: 459000, firstRelease: true, tagline: 'Everyday comfort',
    headline: 'Now selling in Tehachapi.',
    summary: 'A welcoming open-concept layout connects the great room, dining area and kitchen, with a breakfast nook opening to a covered patio. The primary suite is a quiet retreat with its own bath and wardrobe.',
    highlights: ['Great room with breakfast nook', 'Kitchen with pantry', 'Primary suite with private bath', 'Rear patio', '2-car garage'],
  },
  {
    slug: 'the-tranquil-abode', folder: 'tranquil-abode', name: 'The Tranquil Abode', sqft: 1736, beds: 3, baths: 2.5, stories: 2, tagline: 'Two-story living',
    headline: 'Two stories. All the calm.',
    summary: 'Living on the main floor, sleeping upstairs. The second-floor primary suite includes a walk-in closet, joined by two more bedrooms and a full bath, with a half bath downstairs for guests.',
    highlights: ['Second-floor primary suite', 'Walk-in closets', 'Main-floor guest half bath', 'Kitchen open to living'],
  },
  {
    slug: 'sunrise-view-residence', folder: 'sunrise-view', name: 'Sunrise View Residence', sqft: 1848, beds: 4, baths: 2, stories: 1, rendering: true, tagline: 'Room to grow',
    headline: 'Four bedrooms, room to grow.',
    summary: 'Connected living and dining spaces, a spacious kitchen with ample storage, and four bedrooms that flex as guest rooms, a home office or hobby space. The primary bath is designed for a spa-like start to the day.',
    highlights: ['Four bedrooms', 'Primary suite with private bath', 'Kitchen with ample storage', 'Adjacent dining area'],
  },
  {
    slug: 'enchanted-haven', folder: 'enchanted-haven', name: 'Enchanted Haven', sqft: 1910, beds: 3, baths: 2, stories: 1, tagline: 'Semi-custom living',
    headline: 'Made yours, down to the cabinetry.',
    summary: 'A light-filled living room, spacious kitchen and peaceful primary suite. Personalize flooring, paint colors and cabinetry, and shape the kitchen around how you actually cook.',
    highlights: ['Semi-custom finish selections', 'Customizable kitchen', 'Primary suite with private bath', 'Dedicated utility room'],
  },
  {
    slug: 'the-grand-haven', folder: 'grand-haven', name: 'The Grand Haven', sqft: 2348, beds: 4, baths: 2.5, stories: 1, tagline: 'Spacious semi-custom living',
    headline: 'Our largest plan. Built to host.',
    summary: 'An open-concept great room flows into a modern kitchen with a generous island, pantry and a bay-windowed dining room opening to the patio. Four bedrooms provide flexibility, with opportunities to personalize finishes.',
    highlights: ['Kitchen island & pantry', 'Bay-window dining room', 'Primary suite with walk-in closet', 'Four bedrooms', 'Covered patio'],
  },
];

export type Community = { slug: string; name: string; short: string; intro: string; points: string[] };

// Slugs match the live site so existing search rankings carry over.
export const communities: Community[] = [
  {
    slug: 'tehachapi-home-builders', name: 'Tehachapi', short: 'Home of Sunset Retreat, now selling from $459,000.',
    intro: 'Tehachapi is our home base and home to Sunset Retreat, where the first two homes are reserving now. Four real seasons, mountain air and a small-town downtown.',
    points: ['Sunset Retreat now selling', 'Office in town on Tucker Road', 'Build on your lot or ours'],
  },
  {
    slug: 'golden-hills-bear-valley-and-stallion-springs-home-builder', name: 'Golden Hills, Bear Valley & Stallion Springs', short: 'Foothill and gated communities around Tehachapi.',
    intro: 'The communities surrounding Tehachapi offer more land, oak-studded views and a quieter pace. We build across Golden Hills, Bear Valley Springs and Stallion Springs.',
    points: ['Larger parcels and view lots', 'Local building-regulation experience', 'Minutes from Tehachapi'],
  },
  {
    slug: 'california-city-ca-home-builders', name: 'California City', short: 'High-desert value near Edwards AFB.',
    intro: 'California City offers strong land value and an easy commute to Edwards Air Force Base, a natural fit for military families.',
    points: ['Strong land value', 'Near Edwards Air Force Base', 'Heroes of the Nation program'],
  },
  {
    slug: 'ridgecrest-home-builders', name: 'Ridgecrest', short: 'Indian Wells Valley, home of NAWS China Lake.',
    intro: 'Ridgecrest anchors the Indian Wells Valley and serves the Naval Air Weapons Station China Lake community. New construction here means modern, efficient systems.',
    points: ['Serving the China Lake community', 'Energy-efficient new construction', 'Heroes of the Nation program'],
  },
];

export const heroes = {
  price: 359000, beds: 4, baths: 2, sqft: 1705, cash: 14360,
  eligibility: [
    'Married or have dependents',
    'Navy & Air Force: E5 and above',
    'Army & USMC: E6 and above',
    'Barracks unavailable (CNA approval from Command)',
    'Officers of any rank qualify regardless of dependents',
  ],
  lender: {
    name: 'Alex Fischer', title: 'Loan Officer', nmls: '1937673',
    email: 'alexfischer@barretfinancial.com', phone: '(760) 793-7164', phoneHref: 'tel:+17607937164',
    company: 'Barrett Financial Group, L.L.C.',
  },
};

export const faq: [string, string][] = [
  ['Where does Aspen II Homes build?', 'Our current release is Sunset Retreat in Tehachapi. We also build in Golden Hills, Bear Valley Springs, Stallion Springs, California City and Ridgecrest. Contact us to confirm current lot availability and construction status.'],
  ['How much do the new homes cost?', 'The Sunset Retreat first release starts at $459,000. Pricing for other models depends on the home, lot, design, finishes and options. Ask us for a current quote.'],
  ['Which home models can I choose from?', 'Six: Tranquil Oasis, Sunset Retreat, The Tranquil Abode, Sunrise View Residence, Enchanted Haven and The Grand Haven, from 1,507 to 2,348 sq ft. Each model page has photos and a downloadable blueprint.'],
  ['Can I customize my new home?', 'Yes. Choose reserve-and-customize, semi-custom model selection, or a fully custom build. Available choices depend on the model and construction stage.'],
  ['Is 0% down financing available?', 'A 0% down option is available for eligible first-time buyers. Eligibility, lender approval and program terms apply. We also work with FHA, VA and conventional financing.'],
  ['How do early-buyer savings work?', 'Reserve early and apply up to $15,000 in early-buyer savings toward your floor plan. Availability, eligibility and program terms apply.'],
  ['How long until I can move in?', 'Sunset Retreat first-release homes are estimated at roughly three months to move-in.'],
  ['Do you have a program for military families?', 'Yes. Heroes of the Nation offers qualifying military and veteran families a 4-bed, 1,705 sq ft new home for $359,000 plus $14,360 in Hero Home Cash.'],
];

export const disclaimer = 'Renderings are artist concepts and may differ from completed construction. Pricing, availability, incentives, floor plans, and square footage are estimates subject to change and buyer verification.';

export const usd = (n: number) => '$' + n.toLocaleString('en-US');
export const sqftRange = () => {
  const s = plans.map((p) => p.sqft);
  return `${Math.min(...s).toLocaleString()}–${Math.max(...s).toLocaleString()}`;
};
