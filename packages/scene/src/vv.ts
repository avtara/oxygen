/**
 * Vibrant Visuals approximation: lighting (lighting/global.json) and color grading (color_grading/*.json)
 * read from the pack, with Mojang's documented example values as defaults. Calibrated against screenshots
 * where available; everything here is an approximation and the UI says so.
 */

export type RGB = [number, number, number];

/** Keyframes: a constant, or { "<time 0–1>": value } where 0 is noon (sun highest), 0.5 midnight */
export type Keyframes<T> = T | Record<string, T>;

export interface LightingModel {
	sunIlluminance: Keyframes<number>;
	sunColor: Keyframes<RGB>;
	moonIlluminance: Keyframes<number>;
	moonColor: Keyframes<RGB>;
	ambientIlluminance: Keyframes<number>;
	ambientColor: Keyframes<RGB>;
	orbitalOffsetDegrees: number;
	emissiveDesaturation: number;
}

export type ToneMapper = 'aces' | 'hable' | 'reinhard' | 'reinhard_luma' | 'reinhard_luminance' | 'generic';

export interface GradingModel {
	toneMapper: ToneMapper;
}

const WHITE: RGB = [1, 1, 1];

/** Mojang's example values from the lighting documentation */
export const DEFAULT_LIGHTING: LightingModel = {
	sunIlluminance: { '0.0': 109880, '0.25': 20000, '0.35': 400, '0.5': 1, '0.65': 400, '0.75': 20000, '1.0': 109880 },
	sunColor: WHITE,
	moonIlluminance: 0.27,
	moonColor: WHITE,
	// not in the example; a sky-fill level that keeps shadowed faces readable at noon
	ambientIlluminance: { '0.0': 12000, '0.25': 4000, '0.5': 0.6, '0.75': 4000, '1.0': 12000 },
	ambientColor: [0.78, 0.86, 1],
	orbitalOffsetDegrees: 3,
	emissiveDesaturation: 0.1,
};

export const DEFAULT_GRADING: GradingModel = { toneMapper: 'aces' };

function parseColor(v: unknown): RGB | null {
	if (typeof v === 'string') {
		const h = v.replace('#', '');
		if (/^[0-9a-f]{8}$/i.test(h)) return [parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255, parseInt(h.slice(6, 8), 16) / 255];
		if (/^[0-9a-f]{6}$/i.test(h)) return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
		return null;
	}
	if (Array.isArray(v) && v.length >= 3) {
		const n = v.map(Number);
		const scale = n.some((x) => x > 1) ? 1 / 255 : 1;
		return [n[0] * scale, n[1] * scale, n[2] * scale];
	}
	return null;
}

function keyframes<T>(raw: unknown, parse: (v: unknown) => T | null, fallback: Keyframes<T>): Keyframes<T> {
	if (raw === undefined || raw === null) return fallback;
	const direct = parse(raw);
	if (direct !== null) return direct;
	if (typeof raw === 'object' && !Array.isArray(raw)) {
		const out: Record<string, T> = {};
		for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
			const p = parse(v);
			if (p !== null && !Number.isNaN(parseFloat(k))) out[k] = p;
		}
		if (Object.keys(out).length) return out;
	}
	return fallback;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Read a lighting/global.json (any format_version that uses `minecraft:lighting_settings` or top-level keys) */
export function parseLighting(json: unknown): LightingModel {
	const root = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
	const s = ((root['minecraft:lighting_settings'] as Record<string, unknown>) ?? root) as Record<string, any>;
	const dl = s.directional_lights ?? {};
	const orb = dl.orbital ?? dl;
	const d = DEFAULT_LIGHTING;
	return {
		sunIlluminance: keyframes(orb.sun?.illuminance, num, d.sunIlluminance),
		sunColor: keyframes(orb.sun?.color, parseColor, d.sunColor),
		moonIlluminance: keyframes(orb.moon?.illuminance, num, d.moonIlluminance),
		moonColor: keyframes(orb.moon?.color, parseColor, d.moonColor),
		ambientIlluminance: keyframes(s.ambient?.illuminance, num, d.ambientIlluminance),
		ambientColor: keyframes(s.ambient?.color, parseColor, d.ambientColor),
		orbitalOffsetDegrees: num(orb.orbital_offset_degrees) ?? num(dl.orbital_offset_degrees) ?? d.orbitalOffsetDegrees,
		emissiveDesaturation: num(s.emissive?.desaturation) ?? d.emissiveDesaturation,
	};
}

export function parseGrading(json: unknown): GradingModel {
	const root = (json && typeof json === 'object' ? json : {}) as Record<string, any>;
	const s = root['minecraft:color_grading_settings'] ?? root;
	const op = s.tone_mapping?.operator;
	const known: ToneMapper[] = ['aces', 'hable', 'reinhard', 'reinhard_luma', 'reinhard_luminance', 'generic'];
	return { toneMapper: known.includes(op as ToneMapper) ? (op as ToneMapper) : DEFAULT_GRADING.toneMapper };
}

/** Evaluate keyframes at lighting time t (0 = noon) with linear interpolation, wrapping around */
export function sample<T extends number | RGB>(kf: Keyframes<T>, t: number): T {
	if (typeof kf === 'number' || Array.isArray(kf)) return kf as T;
	const keys = Object.keys(kf)
		.map((k) => ({ t: parseFloat(k), v: kf[k] }))
		.sort((a, b) => a.t - b.t);
	if (!keys.length) return 0 as T;
	const x = ((t % 1) + 1) % 1;
	let i = keys.findIndex((k) => k.t > x);
	if (i === -1) i = keys.length;
	const a = keys[(i - 1 + keys.length) % keys.length];
	const b = keys[i % keys.length];
	const span = ((b.t - a.t + 1) % 1) || 1;
	const f = (((x - a.t + 1) % 1) / span) || 0;
	const lerp = (p: number, q: number) => p + (q - p) * f;
	if (typeof a.v === 'number') return lerp(a.v, b.v as number) as T;
	const av = a.v as RGB, bv = b.v as RGB;
	return [lerp(av[0], bv[0]), lerp(av[1], bv[1]), lerp(av[2], bv[2])] as T;
}

export interface LightState {
	/** world-space direction towards the sun (or moon at night) */
	direction: RGB;
	/** directional light radiance contribution (lux) */
	directional: RGB;
	/** ambient (lux) */
	ambient: RGB;
	/** exposure that maps a white diffuse surface in this light to mid grey (auto exposure) */
	exposure: number;
}

/** Light at a query time of day (query.time_of_day: midnight 0, sunrise 0.25, noon 0.5) */
export function lightAt(m: LightingModel, timeOfDay: number): LightState {
	const t = timeOfDay - 0.5; // lighting keyframes count from noon
	const angle = t * Math.PI * 2;
	const sunUp: RGB = [Math.sin(angle), Math.cos(angle), Math.sin((m.orbitalOffsetDegrees * Math.PI) / 180)];
	const sunE = sample(m.sunIlluminance, t);
	const moonE = sample(m.moonIlluminance, t);
	const day = sunUp[1] > -0.05;
	const sc = day ? sample(m.sunColor, t) : sample(m.moonColor, t);
	const e = day ? sunE : moonE;
	const dir: RGB = day ? sunUp : [-sunUp[0], -sunUp[1], -sunUp[2]];
	const len = Math.hypot(...dir) || 1;
	const ac = sample(m.ambientColor, t);
	const ae = sample(m.ambientIlluminance, t);
	const total = e * Math.max(0, dir[1] / len) + ae;
	// white diffuse radiance L = E / π; aim it at ~0.5 before tone mapping
	const exposure = 0.5 / Math.max(1e-4, total / Math.PI);
	return {
		direction: [dir[0] / len, dir[1] / len, dir[2] / len],
		directional: [sc[0] * e, sc[1] * e, sc[2] * e],
		ambient: [ac[0] * ae, ac[1] * ae, ac[2] * ae],
		exposure,
	};
}

// ---- particle light measured in-game (Oxygen test pack t65, 1.26.52, vanilla lighting, 'Performance' preset)

/**
 * What Vibrant Visuals does to a particle, fitted to screenshots of flat grey probes (64, 128, 255) and an
 * emissive one, for Oxygen's pipeline: hdr = albedo × light + haze (+ albedo × MERS emissive × emissive), then
 * ACES and sRGB. Lit and unlit particles look the same. `sky` is the background near the horizon (HDR, so it
 * tone maps to what the game showed). Fits are within 2 to 7 levels of 255.
 */
export interface ParticleLight {
	light: RGB;
	haze: RGB;
	emissive: number;
	sky: RGB;
}

/** Additive particles in-game are lit this much brighter than others of the same colour (all four times fit) */
export const MEASURED_ADDITIVE_GAIN = 2.85;

/** by query.time_of_day: midnight 0, sunrise 0.25, noon 0.5, sunset 0.75 */
export const MEASURED_PARTICLE_LIGHT: Record<string, ParticleLight> = {
	'0': { light: [0.0594, 0.0704, 0.1024], haze: [0.0225, 0.0252, 0.0304], emissive: 24.096, sky: [0.0446, 0.0433, 0.0458] },
	'0.25': { light: [0.1024, 0.142, 0.2492], haze: [0.0373, 0.0392, 0.0476], emissive: 7.433, sky: [0.0693, 0.0812, 0.1182] },
	'0.5': { light: [0.1047, 0.2311, 0.9419], haze: [0.1179, 0.1305, 0.1343], emissive: 4.618, sky: [0.3132, 0.4187, 0.9567] },
	'0.75': { light: [0.194, 0.1978, 0.3216], haze: [0.0521, 0.0508, 0.0566], emissive: 4.144, sky: [0.2001, 0.1596, 0.2033] },
};

/** The measured particle light at a time of day, interpolated between the measured times (wrapping) */
export function measuredParticleLight(timeOfDay: number): ParticleLight {
	const at = <K extends keyof ParticleLight>(k: K) => Object.fromEntries(Object.entries(MEASURED_PARTICLE_LIGHT).map(([t, v]) => [t, v[k]])) as Record<string, ParticleLight[K]>;
	return {
		light: sample(at('light'), timeOfDay),
		haze: sample(at('haze'), timeOfDay),
		emissive: sample(at('emissive'), timeOfDay),
		sky: sample(at('sky'), timeOfDay),
	};
}

/**
 * Particle light for a pack: the measured vanilla values, scaled per channel by how the pack's own
 * lighting/global.json differs from the default at that time (so a warmer or dimmer pack reads warmer or dimmer).
 */
export function particleLight(lighting: LightingModel, timeOfDay: number, fromPack: boolean): ParticleLight {
	const m = measuredParticleLight(timeOfDay);
	if (!fromPack) return m;
	const total = (l: LightState): RGB => {
		const f = 0.35 + 0.65 * Math.max(0, l.direction[1]);
		return [0, 1, 2].map((i) => (l.directional[i] * f + l.ambient[i]) * (l.exposure / Math.PI)) as RGB;
	};
	const a = total(lightAt(lighting, timeOfDay));
	const b = total(lightAt(DEFAULT_LIGHTING, timeOfDay));
	const r = [0, 1, 2].map((i) => (b[i] > 1e-6 ? a[i] / b[i] : 1)) as RGB;
	const mul = (v: RGB): RGB => [v[0] * r[0], v[1] * r[1], v[2] * r[2]];
	return { light: mul(m.light), haze: mul(m.haze), emissive: m.emissive, sky: m.sky };
}

// ---- texture sets (textures/particle/foo.texture_set.json)

export interface TextureSet {
	color: string | number[] | null;
	/** metalness_emissive_roughness or metalness_emissive_roughness_subsurface: texture name or uniform values */
	mers: string | number[] | null;
	normal: string | null;
	heightmap: string | null;
	formatVersion: string;
}

export function parseTextureSet(json: unknown): TextureSet | null {
	const root = (json && typeof json === 'object' ? json : null) as Record<string, any> | null;
	const s = root?.['minecraft:texture_set'];
	if (!s) return null;
	const val = (v: unknown) => (typeof v === 'string' || Array.isArray(v) ? (v as string | number[]) : null);
	return {
		color: val(s.color),
		mers: val(s.metalness_emissive_roughness_subsurface ?? s.metalness_emissive_roughness),
		normal: typeof s.normal === 'string' ? s.normal : null,
		heightmap: typeof s.heightmap === 'string' ? s.heightmap : null,
		formatVersion: String(root?.format_version ?? '1.21.30'),
	};
}

export function writeTextureSet(set: TextureSet): object {
	const s: Record<string, unknown> = {};
	if (set.color !== null) s.color = set.color;
	if (set.mers !== null) {
		const key = (Array.isArray(set.mers) ? set.mers.length === 4 : true) ? 'metalness_emissive_roughness_subsurface' : 'metalness_emissive_roughness';
		s[key] = set.mers;
	}
	if (set.normal) s.normal = set.normal;
	else if (set.heightmap) s.heightmap = set.heightmap;
	return { format_version: set.formatVersion, 'minecraft:texture_set': s };
}

/**
 * Generate MERS pixels from a color texture: metalness 0, emissive from brightness above a threshold,
 * constant roughness, no subsurface. Alpha follows the color texture.
 */
export function generateMers(rgba: ArrayLike<number>, opts: { threshold: number; strength: number; roughness: number }): Uint8ClampedArray<ArrayBuffer> {
	const out = new Uint8ClampedArray(new ArrayBuffer(rgba.length));
	for (let i = 0; i < rgba.length; i += 4) {
		const l = (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) / 255;
		const e = l <= opts.threshold ? 0 : Math.min(1, ((l - opts.threshold) / Math.max(1e-3, 1 - opts.threshold)) * opts.strength);
		out[i] = 0;
		out[i + 1] = Math.round(e * 255);
		out[i + 2] = Math.round(opts.roughness * 255);
		out[i + 3] = rgba[i + 3];
	}
	return out;
}
