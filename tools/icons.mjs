// Renders the app icon (apps/web/public/icon.svg) to the PNGs the packaged apps need.
//   node tools/icons.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

const svg = readFileSync('apps/web/public/icon.svg', 'utf8');
const targets = [
	// VS Code Marketplace: 128 × 128
	{ file: 'apps/vscode/media/icon.png', size: 128 },
	// electron-builder makes the Windows .ico and other sizes from one 512 × 512 PNG
	{ file: 'apps/desktop/build/icon.png', size: 512 },
];

const browser = await chromium.launch();
for (const t of targets) {
	const page = await browser.newPage({ viewport: { width: t.size, height: t.size }, deviceScaleFactor: 1 });
	await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${t.size}px;height:${t.size}px}</style>${svg}`);
	mkdirSync(dirname(t.file), { recursive: true });
	await page.screenshot({ path: t.file, omitBackground: true, clip: { x: 0, y: 0, width: t.size, height: t.size } });
	console.log(`${t.file} (${t.size} px)`);
	await page.close();
}
await browser.close();
