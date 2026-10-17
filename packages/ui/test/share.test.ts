import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readShareHash, shareLink } from '../src/lib/share';

describe('share links', () => {
	it('carry the exact effect text in the hash', () => {
		const text = readFileSync('packages/ui/static/examples/rainbow.particle.json', 'utf8');
		const url = shareLink(text, 'https://oxygen.example/app?x=1#old');
		expect(url.startsWith('https://oxygen.example/app?x=1#fx=')).toBe(true);
		expect(url.length).toBeLessThan(text.length);
		expect(readShareHash(url.slice(url.indexOf('#')))).toBe(text);
		expect(readShareHash('#fx=not-valid')).toBeNull();
		expect(readShareHash('#other')).toBeNull();
	});
});
