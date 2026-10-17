import * as THREE from 'three';
import type { TextureProvider } from 'wintersky/render';
import type { Host } from '../host';
import type { EffectSession } from '../state/session.svelte';

/**
 * Loads particle textures through the host, cached per file. Returns null while loading or when missing,
 * so the renderer shows the magenta-black missing texture, like the game.
 */
export function createTextureProvider(host: Host, getSession: () => EffectSession | null, packVersion: () => number = () => 0): TextureProvider {
	const cache = new Map<string, THREE.Texture | null | 'loading'>();
	/** last loaded texture per file+path, shown while a newer version (a painted override) loads */
	const last = new Map<string, THREE.Texture>();
	const loader = new THREE.TextureLoader();
	return (path) => {
		const s = getSession();
		if (!s || !path) return null;
		const override = s.textureOverride?.path === path ? s.textureOverride.url : null;
		// a newly opened pack can resolve the same path to another image
		const base = `${packVersion()}|${s.file.id ?? s.file.name}|${path}`;
		const key = `${base}|${override ?? ''}`;
		const hit = cache.get(key);
		if (hit === 'loading') return last.get(base) ?? null;
		if (hit !== undefined) return hit;
		cache.set(key, 'loading');
		(override ? Promise.resolve(override) : host.resolveTexture(path, s.file))
			.then((url) => {
				if (!url) {
					cache.set(key, null);
					return;
				}
				loader.load(
					url,
					(tex) => {
						tex.magFilter = THREE.NearestFilter;
						tex.minFilter = THREE.NearestFilter;
						tex.generateMipmaps = false;
						// UVs count from the top row like Bedrock; colors pass through untouched (no linear workflow)
						tex.flipY = false;
						tex.colorSpace = THREE.NoColorSpace;
						tex.needsUpdate = true;
						cache.set(key, tex);
						last.set(base, tex);
					},
					undefined,
					() => cache.set(key, null),
				);
			})
			.catch(() => cache.set(key, null));
		return last.get(base) ?? null;
	};
}

/**
 * MERS (metalness, emissive, roughness, subsurface) textures from the effect's texture set, for the Vibrant
 * Visuals approximation. Uniform texture-set values become 1×1 textures.
 */
export function createMersProvider(host: Host, getSession: () => EffectSession | null, packVersion: () => number = () => 0): TextureProvider {
	const cache = new Map<string, THREE.Texture | null | 'loading'>();
	/** a reloaded texture set (after generating a map) gets a new cache generation */
	const loads = new WeakMap<object, number>();
	let loadCount = 0;
	const loader = new THREE.TextureLoader();
	return (path) => {
		const s = getSession();
		const mers = s?.textureSet?.mers;
		if (!s || !path || mers === null || mers === undefined) return null;
		if (Array.isArray(mers)) {
			const key = `uniform|${mers.join(',')}`;
			let t = cache.get(key);
			if (!t || t === 'loading') {
				const v = mers.map((n) => (n > 1 ? n : Math.round(n * 255)));
				const tex = new THREE.DataTexture(new Uint8Array([v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, 255]), 1, 1, THREE.RGBAFormat);
				tex.needsUpdate = true;
				cache.set(key, tex);
				t = tex;
			}
			return t;
		}
		const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
		const file = `${dir}${mers}`;
		// a glow map being made in the Vibrant Visuals panel shows before it's saved
		const draft = s.glowDraft && s.glowDraft.name === mers ? s.glowDraft.url : null;
		const key = draft ? `draft|${draft}` : `${packVersion()}|${s.file.id ?? s.file.name}|${file}|${loads.get(s.textureSet!) ?? (loads.set(s.textureSet!, ++loadCount), loadCount)}`;
		const hit = cache.get(key);
		if (hit === 'loading') return null;
		if (hit !== undefined) return hit;
		cache.set(key, 'loading');
		(draft ? Promise.resolve(draft) : host.resolveTexture(file, s.file))
			.then((url) => {
				if (!url) return cache.set(key, null);
				loader.load(
					url,
					(tex) => {
						tex.magFilter = THREE.NearestFilter;
						tex.minFilter = THREE.NearestFilter;
						tex.generateMipmaps = false;
						tex.flipY = false;
						tex.colorSpace = THREE.NoColorSpace;
						cache.set(key, tex);
					},
					undefined,
					() => cache.set(key, null),
				);
			})
			.catch(() => cache.set(key, null));
		return null;
	};
}
