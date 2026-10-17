#!/usr/bin/env node
// Checks the bundled examples in Minecraft: builds a resource pack from packages/ui/static/examples and a behavior
// pack of functions (a camera per example matching its saved view, and one that builds its scene and spawns it),
// and copies both into the "Oxygen Test Lab" world's own test packs (see packages/testpack).
//   node tools/examples-ingame.mjs                  build + deploy
//   node tools/examples-ingame.mjs --run [names]    in the loaded world: reload packs, run each example, screenshot it
// Screenshots go to test-results/ingame-examples/<name>.png. Screenshots use tools/bedrock-mcp.mjs; commands go through
// tools/game-bridge.ts when it's running and connected (/connect localhost:19131), else through chat.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const examplesDir = join(root, 'packages', 'ui', 'static', 'examples');
const outDir = join(root, 'test-results', 'examples-pack');
const shotsDir = join(root, 'test-results', 'ingame-examples');
const bedrock = join(process.env.APPDATA ?? '', 'Minecraft Bedrock');
const shared = join(bedrock, 'Users', 'Shared', 'games', 'com.mojang');
const PACK = {
	version: [0, 1, 0],
	rp: '0b9a4c1e-7d2f-4e6a-9f10-5a1c3d7e9b01',
	rpModule: '0b9a4c1e-7d2f-4e6a-9f10-5a1c3d7e9b02',
	bp: '0b9a4c1e-7d2f-4e6a-9f10-5a1c3d7e9b03',
	bpData: '0b9a4c1e-7d2f-4e6a-9f10-5a1c3d7e9b04',
};
/** the test lab is a flat world whose floor's top is at y = -60: an example's origin goes there */
const FLOOR = -60;
const EYE = 1.62;
/** seconds after spawning to take the screenshot (default 2.5) */
const WAIT = { lightning: 0.05, blade_slash: 0.08, shockwave: 0.35, finale_launcher: 2.6, smoke_column: 5, black_hole: 4, comet_trail: 3, storm_on_blocks: 3, heartbeat: 0.15 };

const examples = readdirSync(examplesDir)
	.filter((f) => f.endsWith('.particle.json'))
	.map((f) => {
		const json = JSON.parse(readFileSync(join(examplesDir, f), 'utf8'));
		return { name: f.replace('.particle.json', ''), file: f, json, id: json.particle_effect.description.identifier };
	})
	// the ones with a saved camera are meant to be looked at; the rest are child effects
	.filter((e, _, all) => e.json.oxygen?.cameras?.length || all.length === 0);
const children = readdirSync(examplesDir).filter((f) => f.endsWith('.particle.json'));

const station = (i) => ({ x: 0, z: -120 - i * 60 });
/** always with a decimal point: the game snaps a whole-number x or z to the block's centre (0 → 0.5) */
const r = (v) => v.toFixed(2);

function build() {
	rmSync(outDir, { recursive: true, force: true });
	const rp = join(outDir, 'oxygen_examples_rp');
	const bp = join(outDir, 'oxygen_examples_bp');
	mkdirSync(join(rp, 'particles'), { recursive: true });
	mkdirSync(join(bp, 'functions', 'ex'), { recursive: true });
	const manifest = (name, uuid, module, type) => ({
		format_version: 2,
		header: { name, description: 'Oxygen examples, for checking them in-game', uuid, version: PACK.version, min_engine_version: [1, 21, 0] },
		modules: [{ type, uuid: module, version: PACK.version }],
	});
	writeFileSync(join(rp, 'manifest.json'), JSON.stringify(manifest('Oxygen Examples', PACK.rp, PACK.rpModule, 'resources'), null, '\t'));
	writeFileSync(join(bp, 'manifest.json'), JSON.stringify(manifest('Oxygen Examples (functions)', PACK.bp, PACK.bpData, 'data'), null, '\t'));
	for (const f of children) cpSync(join(examplesDir, f), join(rp, 'particles', f));
	const setup = ['time set midnight', 'weather clear', 'gamerule dodaylightcycle false', 'gamerule doweathercycle false', 'gamemode spectator @s'];
	examples.forEach((e, i) => {
		const { x, z } = station(i);
		const cam = e.json.oxygen.cameras[0];
		const p = cam.position;
		const t = cam.target;
		// tp … facing aims from the feet, not the eyes: lower the target as much to keep the saved view's direction
		writeFileSync(
			join(bp, 'functions', 'ex', `${e.name}_cam.mcfunction`),
			`tp @s ${r(x + p[0])} ${r(FLOOR + p[1] - EYE)} ${r(z + p[2])} facing ${r(x + t[0])} ${r(FLOOR + t[1] - EYE)} ${r(z + t[2])}\n`,
		);
		const lines = [`fill ${x - 8} ${FLOOR} ${z - 8} ${x + 8} ${FLOOR + 12} ${z + 8} air`];
		const scene = e.json.oxygen.scene;
		if (scene?.blocks) {
			const { palette, blocks } = scene.blocks;
			for (let k = 0; k + 3 < blocks.length; k += 4) {
				const b = palette[blocks[k + 3]];
				lines.push(`setblock ${x + blocks[k]} ${FLOOR + blocks[k + 1]} ${z + blocks[k + 2]} ${b.name.replace(/^minecraft:/, '')}`);
			}
		}
		lines.push(`particle ${e.id} ${r(x)} ${r(FLOOR)} ${r(z)}`);
		writeFileSync(join(bp, 'functions', 'ex', `${e.name}.mcfunction`), lines.join('\n') + '\n');
	});
	writeFileSync(join(bp, 'functions', 'ex', 'setup.mcfunction'), setup.join('\n') + '\n');
	return { rp, bp };
}

/**
 * Copy the examples into the test pack's folders: the game only discovers development packs at launch, but re-reads
 * the files of the ones it knows (the test lab's own) whenever the world loads
 */
function deploy({ rp, bp }) {
	const rpDest = join(shared, 'development_resource_packs', 'oxygen_testpack_rp');
	const bpDest = join(shared, 'development_behavior_packs', 'oxygen_testpack_bp');
	if (!existsSync(rpDest) || !existsSync(bpDest)) throw new Error('Deploy the test pack first (pnpm testpack), then load the "Oxygen Test Lab" world once');
	rmSync(join(rpDest, 'particles', 'examples'), { recursive: true, force: true });
	rmSync(join(bpDest, 'functions', 'ex'), { recursive: true, force: true });
	cpSync(join(rp, 'particles'), join(rpDest, 'particles', 'examples'), { recursive: true });
	cpSync(join(bp, 'functions', 'ex'), join(bpDest, 'functions', 'ex'), { recursive: true });
	console.log(`Particles → ${join(rpDest, 'particles', 'examples')}
Functions → ${join(bpDest, 'functions', 'ex')}
In the "Oxygen Test Lab" world, run with --run (it reloads the packs first).`);
}

async function run(names) {
	const mcp = (...args) => execFileSync(process.execPath, [join(root, 'tools', 'bedrock-mcp.mjs'), ...args], { encoding: 'utf8' }).trim();
	const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
	mkdirSync(shotsDir, { recursive: true });
	// commands go through tools/game-bridge.ts when it's connected (typing in chat is fragile), else through chat
	const bridge = await fetch('http://127.0.0.1:19140/status').then((r) => r.json()).then((j) => j.connected).catch(() => false);
	const cmd = async (line) => {
		if (!bridge) return mcp('chat', `/${line}`);
		for (let attempt = 0; ; attempt++) {
			const res = await fetch(`http://127.0.0.1:19140/cmd?line=${encodeURIComponent(line)}`).then((r) => r.json());
			// for a few seconds after /reload, /function is an unknown command
			if (res.statusCode !== 0 && /Unknown command/.test(res.statusMessage ?? '') && attempt < 10) {
				await sleep(1000);
				continue;
			}
			if (res.statusCode !== 0) console.log(`  ${line}: ${res.statusMessage ?? res.error}`);
			return;
		}
	};
	await cmd('reload all'); // picks up a fresh deploy
	await cmd('function ex/setup');
	await sleep(1200);
	for (const e of examples.filter((x) => !names.length || names.includes(x.name))) {
		await cmd(`function ex/${e.name}_cam`);
		await sleep(2500); // chunks around the station load
		await cmd(`function ex/${e.name}`);
		await sleep((WAIT[e.name] ?? 2.5) * 1000);
		console.log(mcp('screenshot', join(shotsDir, `${e.name}.png`), '1920', '1080').split('\n')[0]);
	}
}

const args = process.argv.slice(2);
if (args.includes('--run')) await run(args.filter((a) => !a.startsWith('--')));
else deploy(build());
