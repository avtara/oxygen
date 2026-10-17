import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARKERS, TESTS, probeCurves, probeEvents, type Json, type TestCase } from './tests';
import { testTextureSets, testTextures } from './textures';

export const PACK = {
	name: 'Oxygen Test Pack',
	version: [0, 1, 0] as [number, number, number],
	rpUuid: '6f0a3b0e-1d1f-4c62-9a35-0b7e8f1a2c01',
	rpModule: '6f0a3b0e-1d1f-4c62-9a35-0b7e8f1a2c02',
	bpUuid: '6f0a3b0e-1d1f-4c62-9a35-0b7e8f1a2c03',
	bpData: '6f0a3b0e-1d1f-4c62-9a35-0b7e8f1a2c04',
	bpScript: '6f0a3b0e-1d1f-4c62-9a35-0b7e8f1a2c05',
	minEngine: [1, 26, 0] as [number, number, number],
	serverModule: '2.10.0',
};

/** Station layout in the flat test world */
export const LAYOUT = {
	floorY: -61,
	probeY: -58,
	rowSpacing: 40,
	probeSpacing: 2,
};

export function rowZ(index: number) {
	return (index + 1) * LAYOUT.rowSpacing;
}

export function cameraFor(test: TestCase, index: number, view: 'front' | 'behind' | 'above' | 'frontleft' | 'frontright' | 'away') {
	const n = test.probes.length;
	const spacing = test.spacing ?? LAYOUT.probeSpacing;
	const cx = ((n - 1) * spacing) / 2;
	const z = rowZ(index);
	const dist = Math.max(6, (n - 1) * spacing * 0.8 + 3);
	const eye = 1.62;
	const y = LAYOUT.probeY;
	const r = (v: number) => Math.round(v * 100) / 100;
	switch (view) {
		case 'behind':
			return `tp @s ${r(cx)} ${r(y - eye)} ${r(z + dist)} facing ${r(cx)} ${y} ${z}`;
		case 'above':
			return `tp @s ${r(cx)} ${r(y + dist - eye)} ${r(z - 0.01)} facing ${r(cx)} ${y} ${z}`;
		case 'frontleft': // camera on the +X side (screen-left when looking south)
			return `tp @s ${r(cx + dist * 0.6)} ${r(y - eye)} ${r(z - dist * 0.8)} facing ${r(cx)} ${y} ${z}`;
		case 'frontright':
			return `tp @s ${r(cx - dist * 0.6)} ${r(y - eye)} ${r(z - dist * 0.8)} facing ${r(cx)} ${y} ${z}`;
		case 'away': // where the front view stands, facing the other way
			return `tp @s ${r(cx)} ${r(y - eye)} ${r(z - dist)} facing ${r(cx)} ${y} ${r(z - dist - 10)}`;
		default:
			return `tp @s ${r(cx)} ${r(y - eye)} ${r(z - dist)} facing ${r(cx)} ${y} ${z}`;
	}
}

function writeJson(path: string, data: unknown) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(data, null, '\t'));
}

export function generate(outDir: string) {
	rmSync(outDir, { recursive: true, force: true });
	const rp = join(outDir, 'oxygen_testpack_rp');
	const bp = join(outDir, 'oxygen_testpack_bp');

	writeJson(join(rp, 'manifest.json'), {
		format_version: 2,
		header: { name: `${PACK.name} RP`, description: 'Oxygen in-game verification tests', uuid: PACK.rpUuid, version: PACK.version, min_engine_version: PACK.minEngine },
		modules: [{ type: 'resources', uuid: PACK.rpModule, version: PACK.version }],
		// lets Vibrant Visuals run with the pack active (and read its texture sets): t65
		capabilities: ['pbr'],
	});
	writeJson(join(bp, 'manifest.json'), {
		format_version: 2,
		header: { name: `${PACK.name} BP`, description: 'Oxygen in-game verification tests', uuid: PACK.bpUuid, version: PACK.version, min_engine_version: PACK.minEngine },
		modules: [
			{ type: 'data', uuid: PACK.bpData, version: PACK.version },
			{ type: 'script', language: 'javascript', uuid: PACK.bpScript, version: PACK.version, entry: 'scripts/main.js' },
		],
		dependencies: [
			{ uuid: PACK.rpUuid, version: PACK.version },
			{ module_name: '@minecraft/server', version: PACK.serverModule },
		],
	});

	for (const [path, png] of Object.entries(testTextures())) {
		const file = join(rp, path + '.png');
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, png);
	}
	for (const [path, set] of Object.entries(testTextureSets())) writeJson(join(rp, path + '.texture_set.json'), set);

	const setup: string[] = [
		'# Oxygen test lab setup',
		'gamerule dodaylightcycle false',
		'gamerule doweathercycle false',
		'gamerule domobspawning false',
		'gamerule showcoordinates true',
		'gamerule sendcommandfeedback false',
		'time set noon',
		'weather clear',
		'gamemode spectator @s',
		'hud @s hide all',
		'tickingarea remove oxygen_lab',
	];
	const all: string[] = [];
	const checklist: string[] = [
		'# Oxygen in-game test checklist',
		'',
		`Pack: ${PACK.name} ${PACK.version.join('.')} — RP + BP (scripts need @minecraft/server ${PACK.serverModule}).`,
		'Run `/function oxygen/setup` once, then `/function oxygen/<test>` and look at the probes left → right.',
		`Probe markers (wool under each probe, left → right): ${MARKERS.slice(0, 10).join(', ')}.`,
		'',
	];

	TESTS.forEach((test, index) => {
		const z = rowZ(index);
		// <id>_cam moves the camera first (so chunks load); <id> then places blocks and spawns
		const fn: string[] = [`# ${test.id}: ${test.title}`, cameraFor(test, index, 'front')];
		const cam = [cameraFor(test, index, 'front')];
		checklist.push(`## ${test.id} — ${test.title}`, '', `**Question:** ${test.question}`, '', `**Engine assumption:** ${test.assumption}`, '', ...(test.lookAway ? [`The function turns the camera away after ${test.lookAway.after}s for ${test.lookAway.seconds}s, then back (don't move).`, ''] : []), `Wait ${test.wait}s, then screenshot.`, '');
		test.probes.forEach((p, j) => {
			const x = j * (test.spacing ?? LAYOUT.probeSpacing);
			const id = `oxygen:${test.id}_${p.id}`;
			const json = structuredClone(p.effect) as Json;
			if (test.formatVersion) json.format_version = test.formatVersion;
			json.particle_effect.description.identifier = id;
			const events = p.events ?? probeEvents(test.id, p.id);
			if (events) json.particle_effect.events = events;
			const curves = p.curves ?? probeCurves(test.id, p.id);
			if (curves) json.particle_effect.curves = curves;
			writeJson(join(rp, 'particles', `${test.id}_${p.id}.json`), json);
			for (const [cid, child] of Object.entries(p.children ?? {})) {
				const c = structuredClone(child) as Json;
				c.particle_effect.description.identifier = `${id}_${cid}`;
				writeJson(join(rp, 'particles', `${test.id}_${p.id}_${cid}.json`), c);
			}
			fn.push(`setblock ${x} ${LAYOUT.floorY} ${z} ${MARKERS[j % MARKERS.length]}_wool`);
			for (const b of p.blocks ?? []) {
				fn.push(`setblock ${x + b.dx} ${LAYOUT.floorY + 1 + b.dy} ${z + b.dz} ${b.block}`);
			}
			const y = LAYOUT.probeY + (p.spawnDy ?? 0);
			if (p.script) {
				const msg = JSON.stringify({ effect: id, pos: [x, y, z], vars: p.script.vars });
				fn.push(`scriptevent oxygen:spawn ${msg}`);
			} else {
				fn.push(`particle ${id} ${x} ${y} ${z}`);
			}
			checklist.push(`- **${p.id}** (${MARKERS[j % MARKERS.length]}): ${p.reads}`);
		});
		if (test.lookAway) {
			const turn = { after: test.lookAway.after, seconds: test.lookAway.seconds, away: cameraFor(test, index, 'away'), back: cameraFor(test, index, 'front') };
			fn.push(`scriptevent oxygen:look_away ${JSON.stringify(turn)}`);
		}
		checklist.push('');
		mkdirSync(join(bp, 'functions', 'oxygen'), { recursive: true });
		writeFileSync(join(bp, 'functions', 'oxygen', `${test.id}.mcfunction`), fn.join('\n') + '\n');
		writeFileSync(join(bp, 'functions', 'oxygen', `${test.id}_cam.mcfunction`), cam.join('\n') + '\n');
		if (test.lookAway) writeFileSync(join(bp, 'functions', 'oxygen', `${test.id}_away.mcfunction`), cameraFor(test, index, 'away') + '\n');
		for (const view of test.views ?? []) {
			if (view === 'front') continue;
			writeFileSync(join(bp, 'functions', 'oxygen', `${test.id}_${view}.mcfunction`), cameraFor(test, index, view) + '\n');
		}
		all.push(`function oxygen/${test.id}`);
	});
	mkdirSync(join(bp, 'functions', 'oxygen'), { recursive: true });
	writeFileSync(join(bp, 'functions', 'oxygen', 'setup.mcfunction'), setup.join('\n') + '\n');
	writeFileSync(join(bp, 'functions', 'oxygen', 'all.mcfunction'), all.join('\n') + '\n');

	mkdirSync(join(bp, 'scripts'), { recursive: true });
	writeFileSync(
		join(bp, 'scripts', 'main.js'),
		`import { system, world, MolangVariableMap } from '@minecraft/server';

// /scriptevent oxygen:spawn {"effect":"ns:id","pos":[x,y,z],"vars":{"variable.size":0.3},"dimension":"overworld"}
system.afterEvents.scriptEventReceive.subscribe((event) => {
	if (event.id !== 'oxygen:spawn') return;
	try {
		const data = JSON.parse(event.message);
		const vars = new MolangVariableMap();
		for (const [name, value] of Object.entries(data.vars ?? {})) vars.setFloat(name, value);
		const [x, y, z] = data.pos;
		world.getDimension(data.dimension ?? 'overworld').spawnParticle(data.effect, { x, y, z }, vars);
	} catch (error) {
		console.warn('oxygen:spawn failed: ' + error);
	}
});

// /scriptevent oxygen:look_away {"after":1,"seconds":3,"away":"tp @s …","back":"tp @s …"}: turn the player who ran
// it away from the probes and back again on game ticks (emitter culling tests)
system.afterEvents.scriptEventReceive.subscribe((event) => {
	if (event.id !== 'oxygen:look_away' || !event.sourceEntity) return;
	try {
		const data = JSON.parse(event.message);
		const who = event.sourceEntity;
		system.runTimeout(() => who.runCommand(data.away), Math.round(data.after * 20));
		system.runTimeout(() => who.runCommand(data.back), Math.round((data.after + data.seconds) * 20));
	} catch (error) {
		console.warn('oxygen:look_away failed: ' + error);
	}
});
`,
	);
	writeFileSync(join(outDir, 'CHECKLIST.md'), checklist.join('\n'));
	return { rp, bp, tests: TESTS.length, probes: TESTS.reduce((s, t) => s + t.probes.length, 0) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'out');
	const r = generate(out);
	console.log(`Generated ${r.tests} tests / ${r.probes} probes → ${out}`);
}
