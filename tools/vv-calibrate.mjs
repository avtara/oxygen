// Renders the t65 calibration probes in Oxygen's Vibrant Visuals approximation and prints the centre colour of
// each, next to what the game showed (fixtures). Needs the dev server (pnpm --filter @oxygen/web dev, port 5178)
// and the generated test pack (packages/testpack/out).
//   node tools/vv-calibrate.mjs [--url http://localhost:5178/] [--shots]
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const url = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://localhost:5178/';
const pack = resolve('packages/testpack/out/oxygen_testpack_rp').replace(/\\/g, '/');
const out = join('test-results', 'vv');
mkdirSync(out, { recursive: true });

const fixture = JSON.parse(readFileSync('packages/testpack/fixtures/ingame-1.26.52.json', 'utf8'));
const byTime = fixture.results.t65?.vvByTime ?? {};
const times = ['0', '0.25', '0.5', '0.75'];
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const emissiveScale = args.includes('--emissive-scale') ? Number(args[args.indexOf('--emissive-scale') + 1]) : null;
const probes = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8'].filter((p) => !only || only.includes(p));

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
// a pack folder handle that reads the generated test pack through the dev server
await page.addInitScript((root) => {
	const dir = (path) => ({
		kind: 'directory',
		name: path.split('/').pop(),
		async getDirectoryHandle(n) {
			return dir(`${path}/${n}`);
		},
		async getFileHandle(n) {
			const res = await fetch(`/@fs/${path}/${n}`);
			// the dev server answers unknown paths with its index page
			if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) throw new DOMException('missing', 'NotFoundError');
			const blob = await res.blob();
			return { kind: 'file', name: n, getFile: async () => new File([blob], n) };
		},
		async *values() {},
	});
	window.showDirectoryPicker = async () => dir(root);
}, pack);
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.oxygen && !!window.__oxScene);
await page.evaluate(() => window.oxygen.host.openPack());

const rows = [];
for (const id of probes) for (const time of times) {
	const text = readFileSync(`${pack}/particles/t65_${id}.json`, 'utf8');
	await page.evaluate(([t, time, scale]) => {
		const ws = window.oxygen;
		for (const s of [...ws.sessions]) ws.close(s.id);
		ws.open({ file: { name: 'probe.particle.json', id: null }, text: t });
		ws.renderMode = 'vv';
		// try another emissive strength without rebuilding (scales what the pipeline computes)
		if (scale !== null) {
			const P = window.__oxScene.particles;
			P._orig ??= P.syncEmitters.bind(P);
			P.syncEmitters = (e, c) => {
				if (P.vibrant) P.vibrant = { ...P.vibrant, emissive: P.vibrant.emissive * scale };
				return P._orig(e, c);
			};
		}
		ws.active.timeOfDay = Number(time);
		ws.active.scene = { ...ws.active.scene, ground: 'none' };
	}, [text, time, emissiveScale]);
	await page.waitForTimeout(1500);
	await page.evaluate(() => {
		const sc = window.__oxScene;
		window.oxygen.active.playing = false;
		// 3 blocks north of the probe, looking south (+z) like the in-game capture
		// overlays would sit on the probe (the emitter marker is drawn at its centre)
		sc.showMarker = false;
		sc.showGrid = false;
		sc.showKillPlane = false;
		sc.controls.target.set(0, 0, 0);
		sc.camera.position.set(0, 0, -3);
		sc.controls.update();
	});
	await page.waitForTimeout(800);
	const box = await page.evaluate(() => {
		const r = window.__oxScene.canvas.getBoundingClientRect();
		return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
	});
	const file = join(out, `oxygen_${id}_${time}.png`);
	await page.screenshot({ path: file, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
	const sample = (x, y) => execFileSync(process.execPath, ['tools/png-sample.mjs', file, `${x},${y}`, '--box', '9'], { encoding: 'utf8' }).trim().split(' ').slice(1).map(Number);
	const centre = sample(Math.round(box.w / 2), Math.round(box.h / 2));
	const beside = sample(Math.round(box.w * 0.12), Math.round(box.h / 2));
	rows.push({ id, time, oxygen: centre, background: beside, game: byTime[time]?.[id] ?? null, gameSky: byTime[time]?.sky ?? null });
}
await browser.close();
writeFileSync(join(out, 'calibration.json'), JSON.stringify(rows, null, '\t'));
let sum = 0;
let n = 0;
for (const r of rows) {
	const d = r.game ? Math.sqrt(r.oxygen.reduce((s, v, i) => s + (v - r.game[i]) ** 2, 0) / 3) : null;
	if (d !== null) {
		sum += d * d;
		n++;
	}
	console.log(`t ${r.time.padEnd(4)} ${r.id}  oxygen ${r.oxygen.join(' ').padEnd(12)} game ${r.game ? r.game.join(' ').padEnd(12) : '-'.padEnd(12)} off ${d === null ? '-' : d.toFixed(1)}   sky ${r.background.join(' ')} / ${r.gameSky ? r.gameSky.join(' ') : '-'}`);
}
console.log(`rms over ${n} probes: ${Math.sqrt(sum / Math.max(1, n)).toFixed(1)} levels of 255`);
