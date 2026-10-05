// Tells IndexNow (Bing, Yandex, Seznam, Naver; Bing feeds ChatGPT search and DuckDuckGo)
// that the site's pages changed. Run after a production deploy.
//   node scripts/indexnow.mjs            submit every URL in the live sitemap
//   DRY_RUN=1 SITEMAP=dist/sitemap.xml node scripts/indexnow.mjs   print the payload only
// The key is public by design: search engines fetch https://<host>/<key>.txt to confirm ownership.
import { readdirSync, readFileSync } from 'node:fs';

const HOST = 'aspen2homes.com';
const key = readdirSync(new URL('../public/', import.meta.url)).find((f) => /^[0-9a-f]{32}\.txt$/.test(f))?.slice(0, -4);
if (!key) throw new Error('IndexNow key file (public/<32 hex>.txt) not found.');

const sitemap = process.env.SITEMAP
  ? readFileSync(process.env.SITEMAP, 'utf8')
  : await (await fetch(`https://${HOST}/sitemap.xml`)).text();
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim())
  .filter((u) => new URL(u).host === HOST);
if (!urlList.length) throw new Error('No URLs found in sitemap.');

const payload = { host: HOST, key, keyLocation: `https://${HOST}/${key}.txt`, urlList };
if (process.env.DRY_RUN) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });
  // 200/202 = accepted. 403 = key file not reachable yet. 422 = URL/host mismatch. 429 = too many submissions.
  console.log(`IndexNow: HTTP ${res.status} for ${urlList.length} URLs`);
  if (res.status !== 200 && res.status !== 202) process.exit(1);
}
