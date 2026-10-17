import { Molang, parse } from 'molangjs';

const evaluator = new Molang();
const ARITHMETIC = /^(?:[\d\s.+\-*/(),]|math\.[a-z_]+)+$/i;

/**
 * A number typed into a number field: plain numbers, or arithmetic like `1/3` and `math.pi/2`.
 * Returns null for empty text and undefined when the text isn't a number.
 */
export function parseNumberText(text: string): number | null | undefined {
	const s = text.trim();
	if (s === '') return null;
	const n = Number(s);
	if (Number.isFinite(n)) return n;
	if (!ARITHMETIC.test(s)) return undefined;
	if (parse(s).diagnostics.some((d) => d.severity === 'error')) return undefined;
	const v = evaluator.parse(s);
	return Number.isFinite(v) ? v : undefined;
}

/** Decimal places that make sense for a step size (0.1 → 2, 1 → 1, 0.01 → 3) */
export function decimalsFor(step: number): number {
	return Math.max(0, Math.min(6, 1 - Math.floor(Math.log10(Math.abs(step) || 1))));
}

/** A value for display: no float noise, no trailing zeros */
export function showNumber(n: number, decimals = 6): string {
	if (!Number.isFinite(n)) return String(n);
	const r = Number(n.toFixed(decimals));
	return Object.is(r, -0) ? '0' : String(r);
}
