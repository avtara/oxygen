// Drives the built VS Code webview (apps/vscode/dist/webview) with a mocked VS Code API and checks the
// document sync contract: Oxygen's edits go out as minimal edits that reproduce its text, outside changes
// come in without disturbing an editor being typed in, and undo is handed to VS Code.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const root = resolve('apps/vscode/dist/webview');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = createServer((req, res) => {
	let path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
	if (/[\\/]$/.test(path) || path === root) path = join(root, 'index.html');
	let body;
	try {
		body = readFileSync(path);
	} catch {
		res.writeHead(404).end();
		return;
	}
	res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
	res.end(body);
});
// any free port: fixed ones can fall in Windows' reserved ranges
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const sample = readFileSync('packages/ui/static/examples/fire.particle.json', 'utf8');
let failures = 0;
const check = (ok, what) => {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
	if (!ok) failures++;
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => {
	window.__posted = [];
	window.acquireVsCodeApi = () => ({ postMessage: (m) => window.__posted.push(m), getState: () => null, setState: () => {} });
	window.__deliver = (m) => window.dispatchEvent(new MessageEvent('message', { data: m }));
});
await page.goto(base);
await page.waitForFunction(() => window.__posted.some((m) => m.type === 'ready'));
check(true, 'webview announces ready');

await page.evaluate((text) => window.__deliver({ type: 'init', text, version: 1, name: 'fire.particle.json', uri: 'file:///fire.particle.json', mode: 'full', settings: {} }), sample);
await page.waitForSelector('section[aria-label="Steady rate"] [aria-label="Steady rate › Rate"]');
check(true, 'editor opens the document');

// 1. a local edit produces minimal edits that reproduce the webview's text
let mirror = sample;
const applyPosted = async () => {
	const edits = await page.evaluate(() => {
		const out = window.__posted.filter((m) => m.type === 'edit');
		window.__posted = window.__posted.filter((m) => m.type !== 'edit');
		return out;
	});
	for (const m of edits) for (const e of m.edits) mirror = mirror.slice(0, e.offset) + e.content + mirror.slice(e.offset + e.length);
	return edits.length;
};
await page.click('section[aria-label="Steady rate"] [aria-label="Steady rate › Rate"]');
await page.keyboard.press('Control+a');
await page.keyboard.type('35', { delay: 15 });
await page.waitForTimeout(500);
const sent = await applyPosted();
check(sent > 0, `typing sends edits to VS Code (${sent})`);
check(mirror.includes('"spawn_rate": 35'), 'the edit lands on spawn_rate only');
check(mirror === (await page.evaluate(() => window.oxygen.active.doc.text)), "applying the sent edits reproduces Oxygen's text exactly");

// 2. an outside change arrives while another field is being typed in
await page.click('section[aria-label="Steady rate"] [aria-label="Steady rate › Rate"]');
await page.keyboard.press('End');
await page.keyboard.type('0', { delay: 15 });
const external = mirror.replace('"max_particles": 1000', '"max_particles": 900');
await page.evaluate((text) => window.__deliver({ type: 'external', text, version: 5 }), external);
await page.keyboard.type('1', { delay: 15 });
await page.waitForTimeout(600);
mirror = external;
await applyPosted();
check(mirror === (await page.evaluate(() => window.oxygen.active.doc.text)), 'VS Code and Oxygen hold the same text after concurrent changes');
const rateText = await page.locator('section[aria-label="Steady rate"] [aria-label="Steady rate › Rate"]').innerText();
check(rateText.trim() === '3501', `the field being typed in keeps its text and cursor (${rateText.trim()})`);
check(mirror.includes('"max_particles": 900') && mirror.includes('"spawn_rate": 3501'), 'both the outside change and the typing survive');
const maxShown = await page.locator('section[aria-label="Steady rate"] [aria-label="Steady rate › Max particles"]').innerText();
check(maxShown.trim() === '900', `other fields show the outside change (${maxShown.trim()})`);

// 3. undo goes to VS Code
await page.click('canvas');
await page.keyboard.press('Control+z');
const undo = await page.evaluate(() => window.__posted.some((m) => m.type === 'undo'));
check(undo, 'Ctrl+Z is handed to VS Code');

// 4. a background tab stops simulating, and picks up where it was when shown again
const timeAt = () => page.evaluate(() => window.oxygen.active.world.time);
await page.evaluate(() => window.__deliver({ type: 'visibility', visible: false }));
const hiddenAt = await timeAt();
await page.waitForTimeout(600);
check((await timeAt()) === hiddenAt, 'a hidden editor stops simulating');
const shownAt = await page.evaluate(() => (window.__deliver({ type: 'visibility', visible: true }), performance.now()));
await page.waitForTimeout(600);
// measured on the page's clock: a busy page answers late, so the test's own 600 ms says little
const [simNow, pageNow] = await page.evaluate(() => [window.oxygen.active.world.time, performance.now()]);
const resumed = simNow - hiddenAt;
const wall = (pageNow - shownAt) / 1000;
check(resumed > 0 && resumed <= wall + 0.1, `it resumes without jumping ahead (${resumed.toFixed(2)} s simulated in ${wall.toFixed(2)} s)`);

// the Examples menu lists the extension's examples, and one opens through the extension (in an editor of its own)
await page.getByRole('menuitem', { name: 'Examples', exact: true }).click();
const listRequest = await (await page.waitForFunction(() => window.__posted.find((m) => m.type === 'request' && m.kind === 'examples'))).jsonValue();
await page.evaluate((id) => window.__deliver({ type: 'reply', id, value: ['aurora', 'finale_launcher'] }), listRequest.id);
await page.getByRole('menuitem', { name: 'finale launcher' }).click();
const opened = await (await page.waitForFunction(() => window.__posted.find((m) => m.type === 'openExample'))).jsonValue();
check(opened.name === 'finale_launcher', `the Examples menu opens an example through VS Code (${opened.name})`);

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
server.close();
process.exit(failures ? 1 : 0);
