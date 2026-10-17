import { strFromU8, strToU8, unzlibSync, zlibSync } from 'fflate';

/** Share links carry the whole effect, compressed, in the URL hash (never sent to a server) */
const PREFIX = '#fx=';

function toBase64Url(bytes: Uint8Array): string {
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
	const b = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
	const out = new Uint8Array(b.length);
	for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
	return out;
}

export function shareLink(text: string, base: string): string {
	return `${base.split('#')[0]}${PREFIX}${toBase64Url(zlibSync(strToU8(text), { level: 9 }))}`;
}

/** The effect text in a share link hash, or null */
export function readShareHash(hash: string): string | null {
	if (!hash.startsWith(PREFIX)) return null;
	try {
		return strFromU8(unzlibSync(fromBase64Url(hash.slice(PREFIX.length))));
	} catch {
		return null;
	}
}
