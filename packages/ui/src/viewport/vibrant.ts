import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { MEASURED_ADDITIVE_GAIN, measuredParticleLight, particleLight, type GradingModel, type LightingModel } from '@oxygen/scene';

/** the emissive strengths were fitted without bloom; with the bloom pass on top, this scale matches the game (t65) */
const EMISSIVE_BLOOM_COMP = 0.78;
import type { VibrantSettings } from 'wintersky/render';

const TONE: Record<GradingModel['toneMapper'], THREE.ToneMapping> = {
	aces: THREE.ACESFilmicToneMapping,
	hable: THREE.CineonToneMapping,
	reinhard: THREE.ReinhardToneMapping,
	reinhard_luma: THREE.ReinhardToneMapping,
	reinhard_luminance: THREE.ReinhardToneMapping,
	generic: THREE.NeutralToneMapping,
};

type Vec3 = [number, number, number];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const mul = (m: number[], v: Vec3): Vec3 => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
// three.js's tone mappers (tonemapping_pars_fragment), exposure 1; the matrices are column-major like the GLSL
const ACES_IN = [0.59719, 0.076, 0.0284, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777];
const ACES_OUT = [1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602];
const TONE_JS: Record<GradingModel['toneMapper'], (c: Vec3) => Vec3> = {
	aces: (c) => {
		const v = mul(ACES_IN, c.map((x) => x / 0.6) as Vec3).map((x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081)) as Vec3;
		return mul(ACES_OUT, v).map(clamp01) as Vec3;
	},
	hable: (c) => c.map((x) => ((y) => Math.pow((y * (6.2 * y + 0.5)) / (y * (6.2 * y + 1.7) + 0.06), 2.2))(Math.max(0, x - 0.004))) as Vec3,
	reinhard: (c) => c.map((x) => clamp01(x / (1 + x))) as Vec3,
	reinhard_luma: (c) => c.map((x) => clamp01(x / (1 + x))) as Vec3,
	reinhard_luminance: (c) => c.map((x) => clamp01(x / (1 + x))) as Vec3,
	generic: (c) => {
		// Khronos neutral below its compression knee (a backdrop never reaches it)
		const x = Math.min(...c);
		const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
		return c.map((v) => v - offset) as Vec3;
	},
};

/**
 * Vibrant Visuals approximation: HDR render, bloom, the pack's tone mapper. Particles are pre-exposed in
 * their shader (lit by the pack's sun/ambient, unlit and MERS-emissive ones glowing), so exposure here is 1.
 */
export class VibrantPipeline {
	private composer: EffectComposer;
	private renderPass: RenderPass;
	private bloom: UnrealBloomPass;
	private size = new THREE.Vector2();

	constructor(
		private renderer: THREE.WebGLRenderer,
		scene: THREE.Scene,
		camera: THREE.Camera,
	) {
		this.composer = new EffectComposer(renderer);
		this.renderPass = new RenderPass(scene, camera);
		// only HDR values (emissive, bright lit particles) bloom
		this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0.35, 1.0);
		this.composer.addPass(this.renderPass);
		this.composer.addPass(this.bloom);
		this.composer.addPass(new OutputPass());
	}

	/** Particle shading inputs for the time of day: measured in-game, scaled by the pack's own lighting if it has one */
	static settings(lighting: LightingModel, timeOfDay: number, fromPack = false): VibrantSettings {
		const p = particleLight(lighting, timeOfDay, fromPack);
		return { light: p.light, haze: p.haze, additive: MEASURED_ADDITIVE_GAIN, emissive: p.emissive * EMISSIVE_BLOOM_COMP, desaturation: lighting.emissiveDesaturation };
	}

	/** The sky behind particles, linear HDR (tone maps to what the game shows near the horizon) */
	static sky(timeOfDay: number): THREE.Color {
		const s = measuredParticleLight(timeOfDay).sky;
		return new THREE.Color().setRGB(s[0], s[1], s[2], THREE.LinearSRGBColorSpace);
	}

	private static matched = new Map<string, THREE.Color>();

	/**
	 * The linear color that comes out of the tone mapper as `hex` does in the classic view, so Vibrant Visuals can
	 * keep the classic backdrop and only the particles differ (Gauss-Newton on the tone curve, cached)
	 */
	static backdrop(toneMapper: GradingModel['toneMapper'], hex: number): THREE.Color {
		const key = `${toneMapper}|${hex}`;
		const hit = VibrantPipeline.matched.get(key);
		if (hit) return hit;
		const target = new THREE.Color(hex);
		const want: Vec3 = [target.r, target.g, target.b];
		const tone = TONE_JS[toneMapper] ?? TONE_JS.aces;
		let c: Vec3 = [...want];
		for (let it = 0; it < 40; it++) {
			const out = tone(c);
			const err = out.map((o, i) => want[i] - o) as Vec3;
			if (Math.max(...err.map(Math.abs)) < 1e-6) break;
			// numeric Jacobian, columns per input channel
			const h = 1e-5;
			const J = [0, 1, 2].map((k) => {
				const d = [...c] as Vec3;
				d[k] += h;
				return tone(d).map((o, i) => (o - out[i]) / h);
			});
			const m = new THREE.Matrix3().set(J[0][0], J[1][0], J[2][0], J[0][1], J[1][1], J[2][1], J[0][2], J[1][2], J[2][2]);
			if (Math.abs(m.determinant()) < 1e-12) break;
			const step = new THREE.Vector3(...err).applyMatrix3(m.invert());
			c = [Math.max(0, c[0] + step.x), Math.max(0, c[1] + step.y), Math.max(0, c[2] + step.z)];
		}
		const color = new THREE.Color().setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace);
		VibrantPipeline.matched.set(key, color);
		return color;
	}

	render(grading: GradingModel, viewport?: { x: number; y: number; w: number; h: number }): void {
		const r = this.renderer;
		r.getDrawingBufferSize(this.size);
		const w = viewport ? viewport.w : this.size.x / r.getPixelRatio();
		const h = viewport ? viewport.h : this.size.y / r.getPixelRatio();
		this.composer.setSize(w, h);
		r.toneMapping = TONE[grading.toneMapper];
		r.toneMappingExposure = 1;
		if (viewport) {
			r.setScissorTest(true);
			r.setScissor(viewport.x, viewport.y, viewport.w, viewport.h);
			r.setViewport(viewport.x, viewport.y, viewport.w, viewport.h);
		}
		this.composer.render();
		r.toneMapping = THREE.NoToneMapping;
		if (viewport) {
			r.setScissorTest(false);
			r.setViewport(0, 0, this.size.x / r.getPixelRatio(), this.size.y / r.getPixelRatio());
		}
	}

	dispose(): void {
		this.composer.dispose();
	}
}
