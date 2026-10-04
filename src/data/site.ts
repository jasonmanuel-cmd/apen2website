import type { ImageMetadata } from 'astro';
import captions from './captions.json';

// Single source of truth. Facts come from aspen2homes.com and aspen2bakersfield.com (checked 2026-09-28).
export const site = {
  name: 'Aspen II Homes',
  tagline: "Kern County's Local Custom Home Builder",
  url: 'https://www.aspen2homes.com', // apex 308-redirects here, so www is the canonical host
  phone: '(661) 238-3136',
  phoneHref: 'tel:+16612383136',
  sms: (body = 'HOMES') => `sms:+16612383136?body=${encodeURIComponent(body)}`,
  email: 'Aspen2homes@gmail.com',
  address: '785 Tucker Road G295, Tehachapi, CA 93561',
  followUp: 'within 30 minutes during business hours',
  license: '', // Not published on either site. Add the CSLB # here and it appears in the footer and trust bar.
  // Month the prices, availability and incentives below were last confirmed. Update it whenever you re-check them.
  verified: 'September 2026',
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
    ['New-Home Warranty', 'Every new home comes with warranty coverage. Ask us for the current warranty document and what it covers.'],
    ['Lock Your Pricing Early', "Reserve during the first release to lock today's pricing before the next phase."],
  ],
  disclaimer: '0% down and savings programs are subject to eligibility, lender approval, and program terms, and may not be available to all buyers. Amounts, rates, and credits are estimates and are not a commitment to lend. This is not legal, tax, or financial advice.',
};

export const paths = [
  { n: '01', name: 'Reserve & Customize', title: 'Sunset Retreat', meta: '1,715 sq ft · Single-story · Tehachapi', price: 'From $459,000', badge: 'First 2 homes',
    text: 'The first two homes coming to Sunset Retreat. Lock your pricing and customize your finishes before they are built.', cta: ['See availability', '/sunset-retreat-tehachapi/'] },
  { n: '02', name: 'Semi-Custom', title: 'Choose Your Model', meta: 'Six layouts · Curated finishes', price: 'Call today',
    text: 'Pick from our proven model layouts and personalize the details that matter most. A guided path to a brand-new home.', cta: ['Compare floor plans', '/floor-plans/'] },
  { n: '03', name: 'Designed With You', title: 'Fully Custom', meta: 'Your vision · Premium lots', price: 'By design',
    text: 'Design your home from the ground up with our team: layout, materials and details tailored to how you live.', cta: ['Build on your lot', '/contact-us/?interest=lot'] },
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
  status: string;      // shown on the model page; keep it current
  headline: string;
  summary: string;
  highlights: string[];
};

export const plans: Plan[] = [
  {
    slug: 'tranquil-oasis', folder: 'tranquil-oasis', name: 'Tranquil Oasis', sqft: 1507, beds: 3, baths: 2, stories: 1, tagline: 'Open-concept living',
    status: 'Available to build · request current pricing',
    headline: 'Charming, efficient, easy to love.',
    summary: 'An open floor plan connects the living room, dining area and kitchen, with large windows pulling natural light through the whole home. The kitchen brings modern appliances, ample countertop space and sleek cabinetry.',
    highlights: ['Open living, dining & kitchen', 'Large windows throughout', 'Primary bedroom with private bath', 'Dedicated utility room'],
  },
  {
    slug: 'sunset-retreat', folder: 'sunset-retreat', name: 'Sunset Retreat', sqft: 1715, beds: 3, baths: 2, stories: 1, price: 459000, firstRelease: true, tagline: 'Everyday comfort',
    status: 'Now reserving in the Sunset Retreat first release',
    headline: 'Now selling in Tehachapi.',
    summary: 'A welcoming open-concept layout connects the great room, dining area and kitchen, with a breakfast nook opening to a covered patio. The primary suite is a quiet retreat with its own bath and wardrobe.',
    highlights: ['Great room with breakfast nook', 'Kitchen with pantry', 'Primary suite with private bath', 'Rear patio', '2-car garage'],
  },
  {
    slug: 'the-tranquil-abode', folder: 'tranquil-abode', name: 'The Tranquil Abode', sqft: 1736, beds: 3, baths: 2.5, stories: 2, tagline: 'Two-story living',
    status: 'Available to build · request current pricing',
    headline: 'Two stories. All the calm.',
    summary: 'Living on the main floor, sleeping upstairs. The second-floor primary suite includes a walk-in closet, joined by two more bedrooms and a full bath, with a half bath downstairs for guests.',
    highlights: ['Second-floor primary suite', 'Walk-in closets', 'Main-floor guest half bath', 'Kitchen open to living'],
  },
  {
    slug: 'sunrise-view-residence', folder: 'sunrise-view', name: 'Sunrise View Residence', sqft: 1848, beds: 4, baths: 2, stories: 1, rendering: true, tagline: 'Room to grow',
    status: 'Available to build · request current pricing',
    headline: 'Four bedrooms, room to grow.',
    summary: 'Connected living and dining spaces, a spacious kitchen with ample storage, and four bedrooms that flex as guest rooms, a home office or hobby space. The primary bath is designed for a spa-like start to the day.',
    highlights: ['Four bedrooms', 'Primary suite with private bath', 'Kitchen with ample storage', 'Adjacent dining area'],
  },
  {
    slug: 'enchanted-haven', folder: 'enchanted-haven', name: 'Enchanted Haven', sqft: 1910, beds: 3, baths: 2, stories: 1, tagline: 'Semi-custom living',
    status: 'Available to build · request current pricing',
    headline: 'Made yours, down to the cabinetry.',
    summary: 'A light-filled living room, spacious kitchen and peaceful primary suite. Personalize flooring, paint colors and cabinetry, and shape the kitchen around how you actually cook.',
    highlights: ['Semi-custom finish selections', 'Customizable kitchen', 'Primary suite with private bath', 'Dedicated utility room'],
  },
  {
    slug: 'the-grand-haven', folder: 'grand-haven', name: 'The Grand Haven', sqft: 2348, beds: 4, baths: 2.5, stories: 1, tagline: 'Spacious semi-custom living',
    status: 'Available to build · request current pricing',
    headline: 'Our largest plan. Built to host.',
    summary: 'An open-concept great room flows into a modern kitchen with a generous island, pantry and a bay-windowed dining room opening to the patio. Four bedrooms provide flexibility, with opportunities to personalize finishes.',
    highlights: ['Kitchen island & pantry', 'Bay-window dining room', 'Primary suite with walk-in closet', 'Four bedrooms', 'Covered patio'],
  },
];

export type Community = {
  slug: string; name: string; short: string;
  title: string; h1: string; description: string; intro: string; points: string[];
  faq: [string, string][];
};

// Slugs match the live site so existing search rankings carry over. Only claims we can stand behind:
// Sunset Retreat is the current release in Tehachapi; elsewhere we confirm availability case by case.
const askAvailability = (place: string): [string, string] => [
  `Do you have homes or lots available in ${place} right now?`,
  `Availability changes, so we confirm it case by case. Call ${site.phone} or send the form and we'll tell you what's currently possible in ${place}, including building one of our six models or a custom home.`,
];
const ownLot = (place: string): [string, string] => [
  `Can I build on land I already own in ${place}?`,
  `Ask us. Tell us where your lot is and we'll walk you through what it takes to build there, which models fit, and the next steps.`,
];

export const communities: Community[] = [
  {
    slug: 'tehachapi-home-builders', name: 'Tehachapi', short: 'Home of Sunset Retreat, our current release, from $459,000.',
    title: 'New & Semi-Custom Homes in Tehachapi, CA | Aspen II Homes',
    h1: 'New Homes and Semi-Custom Builds in Tehachapi, CA',
    description: 'Aspen II Homes builds in Tehachapi, home of the Sunset Retreat first release from $459,000. Reserve a home, choose one of six models or ask about building on your lot.',
    intro: 'Tehachapi is where Aspen II Homes is based and where our current release, Sunset Retreat, is located. Reserve one of the first two Sunset Retreat homes, choose one of six models, or ask about building on your own lot.',
    points: ['Sunset Retreat first release reserving', 'Six models to choose from', 'Ask about building on your lot'],
    faq: [
      ['Are new homes available in Tehachapi now?', 'Yes. Sunset Retreat is our current release in Tehachapi. Home 1 and Home 2 are reserving, with Phase 2 on a waitlist. Plans start at $459,000; pricing and availability are subject to change.'],
      ['Which models can I build in Tehachapi?', 'The Sunset Retreat release uses the Sunset Retreat model (1,715 sq ft, 3 bed, 2 bath). Ask us about building any of our six models on another lot.'],
      ownLot('Tehachapi'),
    ],
  },
  {
    slug: 'golden-hills-bear-valley-and-stallion-springs-home-builder', name: 'Golden Hills, Bear Valley & Stallion Springs', short: 'The foothill communities around Tehachapi.',
    title: 'New & Semi-Custom Homes in Golden Hills, Bear Valley Springs & Stallion Springs | Aspen II Homes',
    h1: 'New and Semi-Custom Homes in Golden Hills, Bear Valley Springs and Stallion Springs',
    description: 'Aspen II Homes serves buyers in Golden Hills, Bear Valley Springs and Stallion Springs near Tehachapi. Six models or a custom build; contact us to confirm current availability.',
    intro: 'Aspen II Homes serves buyers in the communities around Tehachapi: Golden Hills, Bear Valley Springs and Stallion Springs. Choose one of our six models or ask about a custom build. Contact us to confirm current land, build and model availability in each community.',
    points: ['Three communities near Tehachapi', 'Six models or a custom build', 'We confirm availability case by case'],
    faq: [askAvailability('Golden Hills, Bear Valley Springs or Stallion Springs'), ownLot('these communities')],
  },
  {
    slug: 'california-city-ca-home-builders', name: 'California City', short: 'Serving California City buyers near Edwards AFB.',
    title: 'New & Semi-Custom Home Builder in California City, CA | Aspen II Homes',
    h1: 'New Homes and Custom-Build Options in California City, CA',
    description: 'Aspen II Homes serves California City buyers, including military families near Edwards Air Force Base. Six models, custom builds and the Heroes of the Nation program.',
    intro: 'Aspen II Homes serves California City buyers, including military families near Edwards Air Force Base, through select model and custom-build opportunities. Contact our team to confirm current land, build and model availability.',
    points: ['Near Edwards Air Force Base', 'Heroes of the Nation military program', 'We confirm availability case by case'],
    faq: [askAvailability('California City'), ownLot('California City')],
  },
  {
    slug: 'ridgecrest-home-builders', name: 'Ridgecrest', short: 'Serving Ridgecrest and Indian Wells Valley buyers.',
    title: 'New & Semi-Custom Homes Near Ridgecrest, CA | Aspen II Homes',
    h1: 'New Home Options for Ridgecrest-Area Buyers',
    description: 'Aspen II Homes serves Ridgecrest and Indian Wells Valley buyers, including NAWS China Lake families, through select semi-custom and custom-build opportunities.',
    intro: 'Aspen II Homes serves qualified buyers in the Ridgecrest and Indian Wells Valley area through select semi-custom and custom-build opportunities. Contact our team to confirm current land, build and model availability.',
    points: ['Serving the Indian Wells Valley', 'Near NAWS China Lake', 'Heroes of the Nation military program'],
    faq: [askAvailability('the Ridgecrest area'), ownLot('the Ridgecrest area')],
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

// [question, answer, page with the full answer]
export const faq: [string, string, string][] = [
  ['Where does Aspen II Homes build?', 'Our current release is Sunset Retreat in Tehachapi. We also serve buyers in Golden Hills, Bear Valley Springs, Stallion Springs, California City and Ridgecrest. Contact us to confirm current lot availability and construction status.', '/#communities'],
  ['How much do the new homes cost?', 'The Sunset Retreat first release starts at $459,000. Pricing for other models depends on the home, lot, design, finishes and options. Ask us for a current quote.', '/sunset-retreat-tehachapi/'],
  ['Which home models can I choose from?', 'Six: Tranquil Oasis, Sunset Retreat, The Tranquil Abode, Sunrise View Residence, Enchanted Haven and The Grand Haven, from 1,507 to 2,348 sq ft. Each model page has photos and a downloadable blueprint.', '/floor-plans/'],
  ['Can I customize my new home?', 'Yes. Choose reserve-and-customize, semi-custom model selection, or a fully custom build. Available choices depend on the model and construction stage.', '/how-it-works/'],
  ['Is 0% down financing available?', 'A 0% down option is available for eligible first-time buyers. Eligibility, lender approval and program terms apply. We also work with FHA, VA and conventional financing.', '/financing/'],
  ['How do early-buyer savings work?', 'Reserve early and apply up to $15,000 in early-buyer savings toward your floor plan. Availability, eligibility and program terms apply.', '/financing/'],
  ['How long until I can move in?', 'Sunset Retreat first-release homes are estimated at roughly three months to move-in.', '/sunset-retreat-tehachapi/'],
  ['Do you have a program for military families?', 'Yes. Heroes of the Nation offers qualifying military and veteran families a 4-bed, 1,705 sq ft new home for $359,000 plus $14,360 in Hero Home Cash.', '/heroes-of-the-nation/'],
];

export const disclaimer = 'Renderings are artist concepts and may differ from completed construction. Pricing, availability, incentives, floor plans, and square footage are estimates subject to change and buyer verification.';

export const usd = (n: number) => '$' + n.toLocaleString('en-US');
// "the Sunset Retreat" but "The Grand Haven", never "the The Grand Haven".
export const theName = (name: string) => (/^the /i.test(name) ? name : `the ${name}`);
export const sqftRange = () => {
  const s = plans.map((p) => p.sqft);
  return `${Math.min(...s).toLocaleString()}–${Math.max(...s).toLocaleString()}`;
};
