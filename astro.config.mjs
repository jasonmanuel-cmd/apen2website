// @ts-check
import { defineConfig } from 'astro/config';

// cssTarget keeps the build from stripping -webkit- prefixes that iPhones on iOS 15 to 17 still need (for example backdrop-filter on the sticky header).
export default defineConfig({ site: 'https://aspen2homes.com', trailingSlash: 'always', vite: { build: { cssTarget: ['safari15', 'chrome90', 'firefox90'] } } });
