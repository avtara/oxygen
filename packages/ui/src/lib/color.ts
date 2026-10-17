/**
 * Bedrock colors: "#RRGGBB" or "#AARRGGBB" (alpha FIRST), or [r, g, b(, a)] floats 0–1 that may be Molang.
 */

export type RGBA = [number, number, number, number];

export interface ParsedColor {
	rgba: RGBA;
	/** How the input was read, stated back to the user */
	reading: string;
	/** 8 hex digits are ambiguous: CSS tools write alpha last */
	ambiguous?: boolean;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Interpret pasted text as a color and say how it was read. `alphaLast` reads 8 hex digits CSS-style. */
export function parseColorInput(text: string, alphaLast = false): ParsedColor | null {
	const t = text.trim();
	let m = /^#?([0-9a-f]{8})$/i.exec(t);
	if (m) {
		const h = m[1];
		const ch = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
		if (alphaLast) return { rgba: [ch(0), ch(2), ch(4), ch(6)], reading: 'Read as CSS #RRGGBBAA (alpha last) and saved the Bedrock way, alpha first', ambiguous: true };
		return { rgba: [ch(2), ch(4), ch(6), ch(0)], reading: 'Read as #AARRGGBB (Bedrock puts alpha first)', ambiguous: true };
	}
	m = /^#?([0-9a-f]{6})$/i.exec(t);
	if (m) {
		const h = m[1];
		return { rgba: [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255, 1], reading: 'Read as #RRGGBB' };
	}
	m = /^#?([0-9a-f]{3})$/i.exec(t);
	if (m) {
		const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16) / 255);
		return { rgba: [r, g, b, 1], reading: 'Read as CSS #RGB' };
	}
	m = /^rgba?\(([^)]*)\)$/i.exec(t);
	if (m) {
		const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
		if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
			const a = parts[3] ?? 1;
			return { rgba: [parts[0] / 255, parts[1] / 255, parts[2] / 255, a > 1 ? a / 255 : a], reading: 'Read as CSS rgb() with 0–255 channels' };
		}
	}
	const nums = t.replace(/[[\]()]/g, '').split(/[\s,]+/).filter(Boolean).map(Number);
	if ((nums.length === 3 || nums.length === 4) && nums.every((n) => Number.isFinite(n))) {
		const ints = nums.some((n) => n > 1);
		const f = ints ? 1 / 255 : 1;
		const rgba = [nums[0] * f, nums[1] * f, nums[2] * f, nums.length === 4 ? nums[3] * (ints && nums[3] > 1 ? f : 1) : 1] as RGBA;
		return { rgba, reading: ints ? 'Read as 0–255 channels' : 'Read as 0–1 channels' };
	}
	return null;
}

const hex2 = (n: number) =>
	Math.round(clamp01(n) * 255)
		.toString(16)
		.padStart(2, '0')
		.toUpperCase();

/** Bedrock hex: #RRGGBB when opaque, #AARRGGBB otherwise */
export function toBedrockHex(c: RGBA): string {
	const rgb = hex2(c[0]) + hex2(c[1]) + hex2(c[2]);
	return c[3] >= 0.999 ? `#${rgb}` : `#${hex2(c[3])}${rgb}`;
}

export function toCss(c: RGBA): string {
	return `rgba(${Math.round(clamp01(c[0]) * 255)}, ${Math.round(clamp01(c[1]) * 255)}, ${Math.round(clamp01(c[2]) * 255)}, ${clamp01(c[3]).toFixed(3)})`;
}

/** Round to 3 decimals for writing channel floats */
export function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

/** [h 0–360, s 0–1, v 0–1] from 0–1 channels */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
	const max = Math.max(r, g, b);
	const d = max - Math.min(r, g, b);
	let h = 0;
	if (d > 0) {
		if (max === r) h = ((g - b) / d) % 6;
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	return [h, max === 0 ? 0 : d / max, max];
}

/** 0–1 channels from [h 0–360, s 0–1, v 0–1] */
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
	const f = (n: number) => {
		const k = (n + h / 60) % 6;
		return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
	};
	return [f(5), f(3), f(1)];
}
