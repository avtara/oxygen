import { describe, expect, it } from 'vitest';
import { parseColorInput, toBedrockHex } from '../src/lib/color';

describe('color input', () => {
	it('reads 8 hex digits the Bedrock way (alpha first), or CSS-style when asked', () => {
		const bedrock = parseColorInput('#B3FFB900')!;
		expect(toBedrockHex(bedrock.rgba)).toBe('#B3FFB900');
		expect(bedrock.ambiguous).toBe(true);
		// the same digits from a CSS tool: alpha last
		const css = parseColorInput('#FFB900B3', true)!;
		expect(toBedrockHex(css.rgba)).toBe('#B3FFB900');
		expect(css.reading).toMatch(/alpha last/);
	});

	it('keeps opaque colors short and reads other common forms', () => {
		expect(toBedrockHex(parseColorInput('ffb900')!.rgba)).toBe('#FFB900');
		expect(toBedrockHex(parseColorInput('#fb0')!.rgba)).toBe('#FFBB00');
		expect(toBedrockHex(parseColorInput('rgba(255, 185, 0, 0.7)')!.rgba)).toBe('#B3FFB900');
		expect(toBedrockHex(parseColorInput('[1, 0.5, 0, 1]')!.rgba)).toBe('#FF8000');
		expect(toBedrockHex(parseColorInput('255 128 0')!.rgba)).toBe('#FF8000');
		expect(parseColorInput('not a color')).toBeNull();
	});
});
