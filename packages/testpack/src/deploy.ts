import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLevelDat, writeLevelDat, type NbtTag } from '../../scene/src/nbt';
import { PACK, generate } from './generate';

const BEDROCK = join(process.env.APPDATA ?? '', 'Minecraft Bedrock');
const SHARED = join(BEDROCK, 'Users', 'Shared', 'games', 'com.mojang');
export const WORLD_FOLDER = 'OxygenTestLab';

/** The per-account folder that holds minecraftWorlds (most recently used) */
export function userWorldsDir(): string {
	const users = join(BEDROCK, 'Users');
	let best: { dir: string; time: number } | null = null;
	for (const u of readdirSync(users)) {
		if (u === 'Shared') continue;
		const dir = join(users, u, 'games', 'com.mojang', 'minecraftWorlds');
		if (!existsSync(dir)) continue;
		const time = statSync(dir).mtimeMs;
		if (!best || time > best.time) best = { dir, time };
	}
	if (!best) throw new Error('No Minecraft Bedrock worlds folder found');
	return best.dir;
}

function templateLevelDat(worldsDir: string): Uint8Array {
	for (const w of readdirSync(worldsDir)) {
		const f = join(worldsDir, w, 'level.dat');
		if (w !== WORLD_FOLDER && existsSync(f)) return new Uint8Array(readFileSync(f));
	}
	throw new Error('Need at least one existing world to use as a level.dat template');
}

function set(root: Record<string, NbtTag>, key: string, tag: NbtTag) {
	root[key] = tag;
}

export function createTestWorld(worldsDir = userWorldsDir()): string {
	const dir = join(worldsDir, WORLD_FOLDER);
	const fresh = !existsSync(join(dir, 'level.dat'));
	mkdirSync(dir, { recursive: true });
	if (fresh) {
		const { version, root } = readLevelDat(templateLevelDat(worldsDir));
		const c = (root.tag as Extract<NbtTag, { type: 'compound' }>).value;
		set(c, 'LevelName', { type: 'string', value: 'Oxygen Test Lab' });
		set(c, 'GameType', { type: 'int', value: 1 });
		set(c, 'Generator', { type: 'int', value: 2 });
		set(c, 'FlatWorldLayers', {
			type: 'string',
			value: JSON.stringify({
				biome_id: 1,
				block_layers: [
					{ block_name: 'minecraft:bedrock', count: 1 },
					{ block_name: 'minecraft:stone', count: 2 },
					{ block_name: 'minecraft:smooth_stone', count: 1 },
				],
				encoding_version: 6,
				structure_options: null,
				world_version: 'version.post_1_18',
			}),
		});
		set(c, 'commandsEnabled', { type: 'byte', value: 1 });
		set(c, 'cheatsEnabled', { type: 'byte', value: 1 });
		set(c, 'hasBeenLoadedInCreative', { type: 'byte', value: 1 });
		set(c, 'Difficulty', { type: 'int', value: 0 });
		set(c, 'dodaylightcycle', { type: 'byte', value: 0 });
		set(c, 'doweathercycle', { type: 'byte', value: 0 });
		set(c, 'domobspawning', { type: 'byte', value: 0 });
		set(c, 'showcoordinates', { type: 'byte', value: 1 });
		set(c, 'SpawnX', { type: 'int', value: 0 });
		set(c, 'SpawnY', { type: 'int', value: 32767 });
		set(c, 'SpawnZ', { type: 'int', value: 0 });
		set(c, 'RandomSeed', { type: 'long', value: 4242n });
		set(c, 'LastPlayed', { type: 'long', value: BigInt(Math.floor(Date.now() / 1000)) });
		writeFileSync(join(dir, 'level.dat'), writeLevelDat(version, root));
		writeFileSync(join(dir, 'levelname.txt'), 'Oxygen Test Lab');
	}
	writeFileSync(join(dir, 'world_resource_packs.json'), JSON.stringify([{ pack_id: PACK.rpUuid, version: PACK.version }], null, '\t'));
	writeFileSync(join(dir, 'world_behavior_packs.json'), JSON.stringify([{ pack_id: PACK.bpUuid, version: PACK.version }], null, '\t'));
	return dir;
}

export function deployPacks(outDir: string) {
	const rpDest = join(SHARED, 'development_resource_packs', 'oxygen_testpack_rp');
	const bpDest = join(SHARED, 'development_behavior_packs', 'oxygen_testpack_bp');
	rmSync(rpDest, { recursive: true, force: true });
	rmSync(bpDest, { recursive: true, force: true });
	cpSync(join(outDir, 'oxygen_testpack_rp'), rpDest, { recursive: true });
	cpSync(join(outDir, 'oxygen_testpack_bp'), bpDest, { recursive: true });
	return { rpDest, bpDest };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'out');
	const g = generate(out);
	const d = deployPacks(out);
	const w = createTestWorld();
	console.log(`Generated ${g.tests} tests (${g.probes} probes)\nRP → ${d.rpDest}\nBP → ${d.bpDest}\nWorld → ${w}`);
}
