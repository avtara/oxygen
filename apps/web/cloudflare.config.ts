import { defineConfig } from 'cf/config';

// The web app on Cloudflare: a static site (no Worker code) served at oxygen.hydrogen.exposed.
// Deploy with `pnpm --filter @oxygen/web run deploy`.
export default defineConfig({
	worker: {
		name: 'oxygen',
		compatibilityDate: '2026-10-06',
		domains: ['oxygen.hydrogen.exposed'],
		workersDev: false,
		previewUrls: false,
	},
});
