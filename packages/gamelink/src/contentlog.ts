/**
 * Bedrock content log lines look like
 *   00:02:20[Molang][error]-particles/fx.json | ParticleEffect::_extractComponents | minecraft:particle_appearance_billboard | ... | size | 0.3 +* 1 | Error: …
 * The first segment is the pack-relative file, the last is the message, and the one before it is usually the
 * expression. Pure string handling: usable in the browser too.
 */
export interface ContentLogEntry {
	time: string;
	category: string;
	level: 'error' | 'warning' | 'info' | string;
	/** pack-relative path, e.g. `particles/fx.json` (may be empty) */
	file: string;
	/** context segments between the file and the expression (component, field, …) */
	context: string[];
	expression: string | null;
	message: string;
	raw: string;
}

const LINE = /^(\d{2}:\d{2}:\d{2})\[([^\]]+)\]\[([^\]]+)\]-(.*)$/;

export function parseContentLog(text: string): ContentLogEntry[] {
	const out: ContentLogEntry[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const m = LINE.exec(raw);
		if (!m) {
			// continuation of a multi-line message
			if (raw.trim() && out.length) out[out.length - 1].message += `\n${raw.trim()}`;
			continue;
		}
		const [, time, category, level, rest] = m;
		const parts = rest.split(' | ').map((p) => p.trim());
		const looksLikeFile = /\.json$/i.test(parts[0] ?? '');
		const file = looksLikeFile ? parts.shift()! : '';
		const message = parts.pop() ?? '';
		const expression = parts.length ? parts.pop()! : null;
		out.push({ time, category, level: level.toLowerCase(), file, context: parts, expression, message, raw });
	}
	return out;
}

/** Entries about a particle file (matched by its pack-relative path or file name) */
export function entriesFor(entries: ContentLogEntry[], fileName: string): ContentLogEntry[] {
	const name = fileName.replace(/\\/g, '/').split('/').pop()!.toLowerCase();
	return entries.filter((e) => e.file && e.file.replace(/\\/g, '/').toLowerCase().endsWith(name));
}

/** Best-effort JSON path of the field an entry is about (component id + field key) */
export function entryPath(e: ContentLogEntry): string | null {
	const comp = e.context.find((c) => c.startsWith('minecraft:'));
	if (!comp) {
		if (e.context[0] === 'events' && e.context[1]) return `particle_effect/events/${e.context[1]}`;
		if (e.context[0] === 'curves' && e.context[1]) return `particle_effect/curves/${e.context[1]}`;
		return null;
	}
	const after = e.context.slice(e.context.indexOf(comp) + 1).filter((c) => !/Component$|::/.test(c));
	return `particle_effect/components/${comp}${after.length ? `/${after[after.length - 1]}` : ''}`;
}
