import * as vscode from 'vscode';
import { parse as parseJsonc } from 'jsonc-parser';
import { parentInputsFor, spawnsOf, type EffectSpawns } from '@oxygen/effect';
import { Examples } from './examples';

/** vanilla texture paths → the sprites wintersky bundles (dist/vanilla) */
const VANILLA_TEXTURES: Record<string, string> = {
	'textures/particle/particles': 'particles.png',
	'textures/particle/campfire_smoke': 'campfire_smoke.png',
	'textures/particle/soul': 'soul.png',
	'textures/flame_atlas': 'flame_atlas.png',
};

/**
 * Knows the resource pack around a particle file: its root (manifest.json), min_engine_version, textures,
 * and other particle files by identifier. Indexes lazily and keeps up with file changes.
 */
export class PackIndex implements vscode.Disposable {
	/** the bundled examples; an example's child effects are other examples */
	readonly examples: Examples;
	private roots = new Map<string, Promise<vscode.Uri | null>>();
	private manifests = new Map<string, Promise<number[] | null>>();
	private identifiers = new Map<string, Map<string, vscode.Uri>>();
	private spawns = new Map<string, EffectSpawns[]>();
	private watcher: vscode.FileSystemWatcher;

	/** `vanilla`: the folder with the vanilla sprites bundled with the extension; `examples`: the bundled examples */
	constructor(
		private vanilla?: vscode.Uri,
		examples?: vscode.Uri,
	) {
		this.examples = new Examples(examples ?? vscode.Uri.file(''));
		this.watcher = vscode.workspace.createFileSystemWatcher('**/{manifest.json,particles/**/*.json}');
		const reset = (uri: vscode.Uri) => {
			if (uri.path.endsWith('manifest.json')) {
				this.roots.clear();
				this.manifests.clear();
			}
			this.identifiers.clear();
			this.spawns.clear();
		};
		this.watcher.onDidChange(reset);
		this.watcher.onDidCreate(reset);
		this.watcher.onDidDelete(reset);
	}

	dispose(): void {
		this.watcher.dispose();
	}

	/** Pack root: the nearest folder above the file with a manifest.json, else the folder holding `particles/` */
	root(file: vscode.Uri): Promise<vscode.Uri | null> {
		const key = file.toString();
		let p = this.roots.get(key);
		if (!p) {
			p = this.findRoot(file);
			this.roots.set(key, p);
		}
		return p;
	}

	private async findRoot(file: vscode.Uri): Promise<vscode.Uri | null> {
		// an untitled document (an opened example) isn't in any pack
		if (file.scheme === 'untitled') return null;
		let dir = vscode.Uri.joinPath(file, '..');
		let particlesParent: vscode.Uri | null = null;
		for (let i = 0; i < 12; i++) {
			if (dir.path.endsWith('/particles')) particlesParent ??= vscode.Uri.joinPath(dir, '..');
			try {
				await vscode.workspace.fs.stat(vscode.Uri.joinPath(dir, 'manifest.json'));
				return dir;
			} catch {
				// keep walking up
			}
			const parent = vscode.Uri.joinPath(dir, '..');
			if (parent.path === dir.path) break;
			dir = parent;
		}
		return particlesParent;
	}

	/** The pack's min_engine_version (selects Molang rules for plain-string expressions) */
	async engine(file: vscode.Uri): Promise<number[] | null> {
		const root = await this.root(file);
		if (!root) return null;
		const key = root.toString();
		let p = this.manifests.get(key);
		if (!p) {
			p = (async () => {
				try {
					const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, 'manifest.json')));
					const m = JSON.parse(text.replace(/^﻿/, ''));
					const v = m?.header?.min_engine_version;
					return Array.isArray(v) ? v.map(Number) : null;
				} catch {
					return null;
				}
			})();
			this.manifests.set(key, p);
		}
		return p;
	}

	/** File for a texture path from a particle (`textures/particle/foo` → png or tga) */
	async texture(file: vscode.Uri, texture: string): Promise<vscode.Uri | null> {
		if (!texture) return null;
		const root = await this.root(file);
		const base = texture.replace(/\.(png|tga)$/i, '');
		if (root) {
			for (const ext of ['.png', '.tga']) {
				const uri = vscode.Uri.joinPath(root, base + ext);
				try {
					await vscode.workspace.fs.stat(uri);
					return uri;
				} catch {
					// try the next extension
				}
			}
		}
		// textures the game itself has, where the pack doesn't override them
		const bundled = VANILLA_TEXTURES[base];
		return bundled && this.vanilla ? vscode.Uri.joinPath(this.vanilla, bundled) : null;
	}

	/** Particle file defining an identifier, in the same pack */
	async effect(file: vscode.Uri, identifier: string): Promise<vscode.Uri | null> {
		const root = await this.root(file);
		if (!root) return null;
		const key = root.toString();
		await this.index(root);
		return this.identifiers.get(key)?.get(identifier) ?? null;
	}

	/** Variables the pack's effects set, in their pre-effects, for an effect they spawn (variable → parents) */
	async parentInputs(file: vscode.Uri, identifier: string): Promise<Record<string, string>> {
		const root = await this.root(file);
		if (!root) return {};
		await this.index(root);
		return parentInputsFor(this.spawns.get(root.toString()) ?? [], identifier);
	}

	/** Read the pack's particle files once: identifiers and who spawns whom */
	private indexing = new Map<string, Promise<void>>();
	private index(root: vscode.Uri): Promise<void> {
		const key = root.toString();
		if (this.identifiers.has(key)) return this.indexing.get(key) ?? Promise.resolve();
		const ids = new Map<string, vscode.Uri>();
		const spawns: EffectSpawns[] = [];
		this.identifiers.set(key, ids);
		this.spawns.set(key, spawns);
		const p = (async () => {
			const files = await vscode.workspace.findFiles(new vscode.RelativePattern(root, 'particles/**/*.json'), undefined, 4000);
			await Promise.all(
				files.map(async (uri) => {
					try {
						const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
						const m = /"identifier"\s*:\s*"([^"]+)"/.exec(text);
						if (m) ids.set(m[1], uri);
						const s = spawnsOf(parseJsonc(text, [], { allowTrailingComma: true }));
						if (s?.spawns.length) spawns.push(s);
					} catch {
						// unreadable file: skip
					}
				}),
			);
		})();
		this.indexing.set(key, p);
		return p;
	}
}

export function isParticleDocument(doc: vscode.TextDocument): boolean {
	if (doc.languageId !== 'json' && doc.languageId !== 'jsonc') return false;
	const p = doc.uri.path;
	if (p.endsWith('.particle.json')) return true;
	if (/\/particles\//.test(p)) return true;
	return doc.getText(new vscode.Range(0, 0, 40, 0)).includes('"particle_effect"');
}
