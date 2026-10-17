import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface GameInstall {
	name: string;
	/** the com.mojang folder holding development_*_packs */
	comMojang: string;
	logs: string | null;
}

/** Minecraft Bedrock installs on this machine: GDK (Microsoft Store/launcher), Preview, and the older UWP layout */
export function findInstalls(env: NodeJS.ProcessEnv = process.env): GameInstall[] {
	const out: GameInstall[] = [];
	const appData = env.APPDATA ?? '';
	const local = env.LOCALAPPDATA ?? '';
	const candidates: [string, string, string | null][] = [
		['Minecraft', join(appData, 'Minecraft Bedrock', 'Users', 'Shared', 'games', 'com.mojang'), join(appData, 'Minecraft Bedrock', 'logs')],
		['Minecraft Preview', join(appData, 'Minecraft Bedrock Preview', 'Users', 'Shared', 'games', 'com.mojang'), join(appData, 'Minecraft Bedrock Preview', 'logs')],
		['Minecraft (UWP)', join(local, 'Packages', 'Microsoft.MinecraftUWP_8wekyb3d8bbwe', 'LocalState', 'games', 'com.mojang'), join(local, 'Packages', 'Microsoft.MinecraftUWP_8wekyb3d8bbwe', 'LocalState', 'logs')],
		['Minecraft Preview (UWP)', join(local, 'Packages', 'Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe', 'LocalState', 'games', 'com.mojang'), null],
	];
	for (const [name, comMojang, logs] of candidates) if (existsSync(comMojang)) out.push({ name, comMojang, logs: logs && existsSync(logs) ? logs : null });
	return out;
}

export interface PackInfo {
	root: string;
	kind: 'resource' | 'behavior';
	name: string;
	uuid: string | null;
}

/** Read a pack's manifest to learn whether it's a resource or behavior pack */
export function readPack(root: string): PackInfo {
	const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8').replace(/^﻿/, ''));
	const kind = (manifest.modules ?? []).some((m: { type?: string }) => m.type === 'resources') ? 'resource' : 'behavior';
	return { root, kind, name: String(manifest.header?.name ?? basename(root)), uuid: manifest.header?.uuid ?? null };
}

const SKIP = new Set(['.git', 'node_modules', '.vscode', '.oxygen']);

/**
 * Copy a pack into the game's development folder (development_resource_packs / development_behavior_packs),
 * replacing the previous copy. The game picks up changed files on /reload all or when re-entering a world.
 */
export function deployPack(pack: PackInfo, install: GameInstall): string {
	return deployPackDetailed(pack, install).target;
}

/**
 * Deploy, and say whether the copy was given the `pbr` capability. A resource pack without it turns Vibrant
 * Visuals off in-game while it's active (t65), so the copy in the development folder gets it, to keep Vibrant
 * Visuals available for testing; the pack itself is left as it is.
 */
export function deployPackDetailed(pack: PackInfo, install: GameInstall): { target: string; addedPbr: boolean } {
	const folder = join(install.comMojang, pack.kind === 'resource' ? 'development_resource_packs' : 'development_behavior_packs');
	const target = join(folder, `${basename(pack.root)}`);
	mkdirSync(folder, { recursive: true });
	if (existsSync(target)) rmSync(target, { recursive: true, force: true });
	cpSync(pack.root, target, { recursive: true, filter: (src) => !SKIP.has(basename(src)) });
	let addedPbr = false;
	if (pack.kind === 'resource') {
		try {
			const path = join(target, 'manifest.json');
			const manifest = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
			const caps: unknown[] = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
			if (!caps.includes('pbr')) {
				manifest.capabilities = [...caps, 'pbr'];
				writeFileSync(path, `${JSON.stringify(manifest, null, '\t')}\n`);
				addedPbr = true;
			}
		} catch {
			// a manifest JSON.parse can't read (comments): deployed as it is
		}
	}
	return { target, addedPbr };
}

/** The newest content log file of an install */
export function latestContentLog(install: GameInstall): string | null {
	if (!install.logs) return null;
	let best: { path: string; time: number } | null = null;
	for (const f of readdirSync(install.logs)) {
		if (!f.startsWith('ContentLog')) continue;
		const p = join(install.logs, f);
		const t = statSync(p).mtimeMs;
		if (!best || t > best.time) best = { path: p, time: t };
	}
	return best?.path ?? null;
}
