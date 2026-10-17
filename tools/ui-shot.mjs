// Headless UI check: open the dev server, run optional steps, save a screenshot and print console problems.
// node tools/ui-shot.mjs <name> [steps.json|inline-json] [--url http://localhost:5178] [--size 1600x1000]
//   steps: [{ "click": "role=button[name='Save']" }, { "type": ["css", "text"] }, { "press": "Control+z" },
//           { "select": ["css", "value"] }, { "scroll": ["css", 400] }, { "wait": 500 }, { "eval": "js" }, { "shot": "name" }]
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const name = args[0] ?? 'ui';
const opt = (k, d) => {
	const i = args.indexOf(k);
	return i >= 0 ? args[i + 1] : d;
};
const url = opt('--url', 'http://localhost:5178/');
const [w, h] = opt('--size', '1600x1000').split('x').map(Number);
const stepsArg = args[1] && !args[1].startsWith('--') ? args[1] : null;
const steps = stepsArg ? JSON.parse(existsSync(stepsArg) ? readFileSync(stepsArg, 'utf8') : stepsArg) : [];

const out = join(process.cwd(), 'test-results', 'ui');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const problems = [];
page.on('console', (m) => {
	if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}\n${e.stack ?? ''}`));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
for (const s of steps) {
	if (s.click) await page.locator(s.click).first().click();
	if (s.dblclick) await page.locator(s.dblclick).first().dblclick();
	if (s.type) await page.locator(s.type[0]).first().fill(s.type[1]);
	if (s.select) await page.locator(s.select[0]).first().selectOption(s.select[1]);
	if (s.scroll) await page.locator(s.scroll[0]).first().evaluate((el, y) => (el.scrollTop = y), s.scroll[1]);
	if (s.keys) await page.keyboard.type(s.keys, { delay: 20 });
	if (s.press) await page.keyboard.press(s.press);
	if (s.wait) await page.waitForTimeout(s.wait);
	if (s.eval) console.log('eval:', JSON.stringify(await page.evaluate(s.eval)));
	if (s.shot) await page.screenshot({ path: join(out, `${s.shot}.png`) });
}
await page.screenshot({ path: join(out, `${name}.png`) });
console.log(`saved test-results/ui/${name}.png`);
if (problems.length) console.log(`console:\n${problems.slice(0, 30).join('\n')}`);
await browser.close();
