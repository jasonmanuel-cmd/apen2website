// Spam scoring for the public intake form (api/lead.js).
//
// What the real spam looks like (checked against the leads table, Oct 2026): sales pitches typed or
// pasted into the notes box (SEO, hosting, "feature your site in Google"), the same message sent
// several times, foreign-language filler, and gibberish names. Plain bot traps (the hidden honeypot
// field) miss these, because they arrive through a normal browser, so each signal below adds points
// and a submission at or above THRESHOLD is filed as spam instead of emailed.
//
// Spam is stored, never silently dropped: it lands in the leads table with status "spam" and the reasons
// in raw.spam, so a real buyer who trips a rule is one click away in /hq/. The sender always sees a
// normal "thank you", so nobody learns which rule to dodge.
export const THRESHOLD = 3;

// Vendors pitching their own services. One match is weak (a buyer can say "per month"); two or more is a pitch.
const PITCH = [
  /\bseo\b/i, /search engines?\b/i, /search index/i, /search results/i, /web ?traffic/i, /\btraffic\b.*\b(website|site)\b/i,
  /back-?links?/i, /link ?building/i, /guest post/i, /domain authority/i, /first page of google/i, /google'?s? (first )?page/i,
  /web(site)? (re)?design/i, /web(site)? development/i, /digital marketing/i, /marketing (services|agency|campaign)/i,
  /lead generation/i, /\b(rank|ranking)\b.*\b(higher|#?1|top)\b/i, /\bhosting\b/i, /\bper month\b.*\bhosting\b/i, /\$\s?\d+\s?(\/|per)\s?(mo|month)\b/i,
  /\bcrypto(currency)?\b/i, /bitcoin/i, /\bforex\b/i, /casino/i, /viagra|cialis/i, /business loans?\b/i,
  /virtual assistants?/i, /outsourc/i, /affiliate/i, /free (quote|audit|trial|consultation) (for|of) your (site|website)/i,
  /dear (sir|madam|sir\/madam|owner|webmaster)/i, /\bi (can )?help (websites|businesses|companies)/i,
  /we (offer|provide|specialize in) .*\b(services|solutions)\b/i, /\bcheap(est)? price/i, /whatsapp|telegram/i,
  // Added Oct 28 2026 from pitches that still reached the inbox (architect/engineering, SEO follow-up, print shop).
  /\brankings?\b/i, /cost-?effective (package|plan|solution|service)/i, /unsubscribe|reply stop\b/i,
  // One pattern, so a buyer's own follow-up ("I emailed you last week and didn't hear back") counts once, not twice.
  /i (emailed|e-mailed|wrote to|reached out to|contacted) you (earlier|before|previously|last week)|didn['’]?t hear back/i,
  /we['’]?re here to (support|help)|we are here to (support|help)/i,
  /\bour (architectural|engineering|drafting|design|printing|print|marketing|seo|web|staffing|bookkeeping)\b.{0,30}\b(professionals|team|services|experts)\b/i,
  /samples? of our (previous |past )?work/i, /\b(marketing|sales|business development) (executive|manager|representative|specialist)\b/i,
  /who (handles|manages|is in charge of) (the |your )?(print|printing|marketing|website|seo|advertising|purchasing|ordering)/i,
  /business cards|banners (and|&) signs|every order ships/i, /send me what you need and i['’]?ll quote/i,
];

const EMAIL_IN_TEXT = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
// A link or a bare web address. Email addresses are removed first so "reach me at bob@gmail.com" is not a link.
const LINK = /(https?:\/\/|www\.)\S+|(?<![@\w.-])[a-z0-9][a-z0-9-]*\.(com|net|org|io|co|biz|info|site|online|xyz|top|shop|app|dev|agency|marketing|click|link)\b(\/\S*)?/gi;

const letters = (s) => s.match(/\p{L}/gu) || [];
const nonLatin = (s) => letters(s).filter((c) => !/\p{Script=Latin}/u.test(c)).length;

export const normalizeText = (s = '') => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Score one submission. Pure: no network, no clock. `elapsedMs` is how long the form was open in the
 * visitor's browser (absent for a plain HTML post, which is never penalised for it).
 * Returns { score, reasons, spam }.
 */
export function assessLead({ name = '', notes = '', elapsedMs, duplicate = false } = {}) {
  const reasons = [];
  const add = (points, why) => reasons.push([points, why]);
  const text = `${name}\n${notes}`.replace(EMAIL_IN_TEXT, ' ');

  // One link can be a buyer pointing at a listing; two or more is advertising.
  const links = (text.match(LINK) || []).length;
  if (links >= 2) add(3, `${links} links in the message`);
  else if (links === 1) add(2, 'link in the message');

  const hits = PITCH.filter((re) => re.test(text)).length;
  if (hits >= 2) add(3, `sales-pitch wording (${hits} phrases)`);
  else if (hits === 1) add(1, 'sales-pitch wording');

  const single = name.trim();
  if (single && !/\s/.test(single) && single.length >= 16) add(3, 'name is one long string');
  if (/[a-z][A-Z].*[a-z][A-Z]/.test(single) && !/\s/.test(single)) add(2, 'name has random capitals');

  const all = letters(notes).length;
  if (all >= 20 && nonLatin(notes) / all > 0.3) add(3, 'message is mostly non-Latin text');

  if (typeof elapsedMs === 'number' && Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs < 2000) add(3, 'form submitted in under 2 seconds');

  if (duplicate) add(5, 'same message already received today');

  const score = reasons.reduce((n, [p]) => n + p, 0);
  return { score, reasons: reasons.map(([, why]) => why), spam: score >= THRESHOLD };
}
