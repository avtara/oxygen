import { readMeta, writeMeta, type JsonDocument } from '@oxygen/format';
import type { EffectAnalysis } from './analysis';

export interface RenameResult {
	/** fields rewritten */
	fields: number;
	/** occurrences replaced */
	occurrences: number;
}

const NAME = /^[a-z_][a-z0-9_]*$/;

/** Validate a variable name the user typed (`speed`, `v.speed`, `variable.speed`) → canonical form, or an error */
export function canonicalVariable(input: string): { name: string } | { error: string } {
	let n = input.trim().toLowerCase();
	if (n.startsWith('v.')) n = n.slice(2);
	else if (n.startsWith('variable.')) n = n.slice(9);
	if (!NAME.test(n)) return { error: 'Use letters, digits and underscores, starting with a letter or underscore.' };
	return { name: `variable.${n}` };
}

/**
 * Rename a variable everywhere in the effect: every read and write in every Molang field (keeping the
 * namespace as written, `v.` or `variable.`, and each field's JSON representation), a curve that writes it,
 * and scenario values in the oxygen block. One undo step.
 */
export function renameVariable(doc: JsonDocument, analysis: EffectAnalysis, from: string, to: string): RenameResult {
	const fromPath = from.replace(/^variable\./, '');
	const toPath = to.replace(/^variable\./, '');
	let fields = 0;
	let occurrences = 0;
	doc.transact(`Rename ${from.replace(/^variable\./, 'v.')}`, () => {
		for (const f of analysis.fields) {
			const a = f.analysis;
			if (!a) continue;
			const uses = [...a.reads, ...a.writes].filter((u) => u.name === from).sort((x, y) => y.start - x.start);
			if (!uses.length) continue;
			let src = f.field.expr.source;
			const seen = new Set<number>();
			for (const u of uses) {
				if (seen.has(u.start)) continue;
				seen.add(u.start);
				const written = src.slice(u.start, u.end);
				const dot = written.indexOf('.');
				src = src.slice(0, u.start) + written.slice(0, dot + 1) + toPath + src.slice(u.end);
				occurrences++;
			}
			const path = f.path.replace(/#\d+$/, '');
			if (path !== f.path) continue; // hex color channels have no Molang text to edit
			doc.setMolang(path, src, 'Rename variable');
			fields++;
		}
		// a curve writing the variable
		const curves = doc.get('particle_effect/curves') as Record<string, unknown> | undefined;
		if (curves) {
			for (const key of Object.keys(curves)) {
				const canon = key.toLowerCase().replace(/^v\./, 'variable.');
				if (canon === from) {
					doc.renameKey(`particle_effect/curves/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, key.startsWith('v.') ? `v.${toPath}` : `variable.${toPath}`, 'Rename variable');
					fields++;
				}
			}
		}
		// scenario variable values
		const meta = readMeta(doc);
		const matches = (k: string) => k.toLowerCase().replace(/^v\./, '') === fromPath || k.toLowerCase() === from;
		if (meta.scenarios?.some((s) => Object.keys(s.variables ?? {}).some(matches) || s.pinned?.some(matches))) {
			writeMeta(
				doc,
				'scenarios',
				meta.scenarios.map((s) => ({
					...s,
					variables: s.variables ? Object.fromEntries(Object.entries(s.variables).map(([k, v]) => [matches(k) ? `v.${toPath}` : k, v])) : undefined,
					pinned: s.pinned?.map((k) => (matches(k) ? `v.${toPath}` : k)),
				})),
				'Rename variable',
			);
		}
	});
	return { fields, occurrences };
}
