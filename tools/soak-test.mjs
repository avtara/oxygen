// Long-running check of the VS Code webview: switches between files, edits them from "VS Code" and hides
// and shows the editor on a loop, sampling JS heap and frame rate. Fails when either drifts.
// node tools/soak-test.mjs [--minutes 5]   (the plan's full soak is 30)
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const minutes = Number(args[args.indexOf('--minutes') + 1] || 5) || 5;

const root = resolve('apps/vscode/dist/webview');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = createServer((req, res) => {
	let path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
	if (/[\\/]$/.test(path) || path === root) path = join(root, 'index.html');
	try {
		const body = readFileSync(path);
		res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(body);
	} catch {
		res.writeHead(404).end();
	}
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const dir = 'packages/ui/static/examples';
const files = readdirSync(dir)
	.filter((f) => f.endsWith('.json'))
	.map((f) => ({ name: f, text: readFileSync(join(dir, f), 'utf8') }));

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => {
	window.__posted = [];
	window.acquireVsCodeApi = () => ({ postMessage: (m) => window.__posted.push(m), getState: () => null, setState: () => {} });
	window.__deliver = (m) => window.dispatchEvent(new MessageEvent('message', { data: m }));
	// answer requests like the extension does (null = not found)
	setInterval(() => {
		const reqs = window.__posted.filter((m) => m.type === 'request' || m.type === 'writeText' || m.type === 'writeTexture');
		window.__posted = window.__posted.filter((m) => !reqs.includes(m));
		for (const r of reqs) window.__deliver({ type: 'reply', id: r.id, value: null });
	}, 50);
});
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => window.__posted.some((m) => m.type === 'ready'));
await page.evaluate((f) => window.__deliver({ type: 'init', text: f.text, version: 1, name: f.name, uri: `file:///${f.name}`, mode: 'full', settings: {} }), files[0]);
await page.waitForTimeout(2000);

const cdp = await page.context().newCDPSession(page);
async function sample() {
	await page.evaluate(() => (globalThis.gc ? globalThis.gc() : undefined));
	const { usedSize } = await cdp.send('Runtime.getHeapUsage');
	const fps = await page.evaluate(() => Number(document.querySelector('[data-fps]')?.getAttribute('data-fps') ?? 0));
	return { heap: usedSize / 1048576, fps };
}

const samples = [];
const start = Date.now();
let version = 2;
let step = 0;
while (Date.now() - start < minutes * 60000) {
	const f = files[step % files.length];
	// switch files like the preview following the active editor
	await page.evaluate((x) => window.__deliver({ type: 'open', text: x.f.text, version: x.v, name: x.f.name, uri: `file:///${x.f.name}` }), { f, v: version++ });
	await page.waitForTimeout(1500);
	// an outside edit (typing in the text editor)
	const edited = f.text.replace(/"max_lifetime":\s*([\d.]+)/, (_m, n) => `"max_lifetime": ${Number(n) + 0.01 * (step % 5)}`);
	await page.evaluate((x) => window.__deliver({ type: 'external', text: x.t, version: x.v }), { t: edited, v: version++ });
	await page.waitForTimeout(1500);
	// a background tab now and then
	if (step % 4 === 3) {
		await page.evaluate(() => window.__deliver({ type: 'visibility', visible: false }));
		await page.waitForTimeout(800);
		await page.evaluate(() => window.__deliver({ type: 'visibility', visible: true }));
	}
	if (step % 5 === 0) {
		const s = await sample();
		samples.push({ t: (Date.now() - start) / 1000, ...s });
		console.log(`${samples.at(-1).t.toFixed(0).padStart(5)} s  heap ${s.heap.toFixed(1)} MB  ${s.fps.toFixed(0)} fps`);
	}
	step++;
}

const warm = samples.slice(0, Math.max(1, Math.floor(samples.length / 4)));
const late = samples.slice(-Math.max(1, Math.floor(samples.length / 4)));
const avg = (xs, k) => xs.reduce((a, s) => a + s[k], 0) / xs.length;
const heapGrowth = avg(late, 'heap') / avg(warm, 'heap');
const fpsRatio = avg(late, 'fps') / Math.max(1, avg(warm, 'fps'));
let failures = 0;
const check = (ok, what) => {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
	if (!ok) failures++;
};
check(heapGrowth < 1.3, `heap stays flat over ${minutes} min (${(heapGrowth * 100 - 100).toFixed(0)}% from the first quarter to the last)`);
check(fpsRatio > 0.8, `frame rate holds (${(fpsRatio * 100).toFixed(0)}% of the first quarter's)`);
check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
server.close();
process.exit(failures ? 1 : 0);
