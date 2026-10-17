import { makeImage } from './png';

type RGBA = [number, number, number, number];

/** Test textures, keyed by texture path (without extension) inside the RP */
export function testTextures(): Record<string, Uint8Array> {
	const W: RGBA = [255, 255, 255, 255];
	const K: RGBA = [20, 20, 20, 255];
	const T: RGBA = [0, 0, 0, 0];
	return {
		// white square with a dark 1px border — shows size and orientation clearly
		'textures/particle/oxygen_probe': makeImage(16, 16, (x, y) => (x === 0 || y === 0 || x === 15 || y === 15 ? K : W)),
		// arrow / "F" glyph: orientation of direction-facing billboards
		'textures/particle/oxygen_arrow': makeImage(16, 16, (x, y) => {
			const stem = x >= 3 && x <= 5 && y >= 2 && y <= 13;
			const top = y >= 2 && y <= 4 && x >= 3 && x <= 12;
			const mid = y >= 7 && y <= 8 && x >= 3 && x <= 10;
			if (stem || top || mid) return [255, 60, 40, 255];
			return x === 0 || y === 0 || x === 15 || y === 15 ? [40, 120, 255, 255] : [230, 230, 230, 255];
		}),
		// cutout: checkerboard of opaque and fully transparent cells
		'textures/particle/oxygen_cutout': makeImage(16, 16, (x, y) => ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0 ? [255, 210, 40, 255] : T)),
		// semi-transparent fill for blend ordering tests
		'textures/particle/oxygen_glass': makeImage(16, 16, () => [255, 255, 255, 128]),
		// 8 vertical bands with alpha 16, 48, … 240 — alpha-test threshold
		'textures/particle/oxygen_alpha_steps': makeImage(16, 16, (x) => [255, 255, 255, 16 + Math.floor(x / 2) * 32]),
		// flipbook strips: 4 frames of 16 px, only frame k solid
		...Object.fromEntries(
			[0, 1, 2, 3].map((k) => [`textures/particle/oxygen_frames_${k}`, makeImage(64, 16, (x, y) => (Math.floor(x / 16) === k ? (x % 16 === 0 || y === 0 || x % 16 === 15 || y === 15 ? K : W) : T))]),
		),
		// flat fills for Vibrant Visuals calibration (t65); oxygen_grey_e has an emissive texture set
		'textures/particle/oxygen_grey': makeImage(16, 16, () => [128, 128, 128, 255]),
		'textures/particle/oxygen_grey_e': makeImage(16, 16, () => [128, 128, 128, 255]),
		'textures/particle/oxygen_dark': makeImage(16, 16, () => [64, 64, 64, 255]),
		'textures/particle/oxygen_white': makeImage(16, 16, () => [255, 255, 255, 255]),
		// colour atlas (4 columns) for UV tests: red, green, blue, yellow
		'textures/particle/oxygen_uv': makeImage(16, 16, (x) => {
			const cols: RGBA[] = [
				[230, 40, 40, 255],
				[40, 200, 60, 255],
				[40, 80, 230, 255],
				[240, 220, 40, 255],
			];
			return cols[Math.floor(x / 4)];
		}),
	};
}

/** Texture sets (Vibrant Visuals), keyed by texture path */
export function testTextureSets(): Record<string, object> {
	return {
		'textures/particle/oxygen_grey_e': { format_version: '1.16.100', 'minecraft:texture_set': { color: 'oxygen_grey_e', metalness_emissive_roughness: [0, 255, 255] } },
	};
}
