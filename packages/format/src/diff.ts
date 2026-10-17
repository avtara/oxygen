import { COMPONENT_BY_ID } from './components';

export interface DiffEntry {
	kind: 'added' | 'removed' | 'changed';
	/** where: "Billboard › size", "Event pop", "Curve v.rate" */
	where: string;
	path: string;
	before?: string;
	after?: string;
}

/** Molang-insensitive formatting for comparison: collapse whitespace, lowercase names stay as written */
function norm(v: unknown): string {
	if (v === undefined) return '';
	if (typeof v === 'string') return v.replace(/\s+/g, ' ').replace(/\s*([(),;*/+\-<>=!?:&|])\s*/g, '$1').trim();
	if (v && typeof v === 'object' && 'expression' in v) {
		const { expression, version } = v as { expression: unknown; version?: unknown };
		return `${norm(expression)}@${String(version ?? '')}`;
	}
	return JSON.stringify(v);
}

function show(v: unknown): string {
	if (v === undefined) return '';
	if (typeof v === 'string') return v;
	return JSON.stringify(v);
}

function walk(a: unknown, b: unknown, path: string[], where: string, out: DiffEntry[]) {
	const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
	if (isObj(a) && isObj(b) && !('expression' in a && 'expression' in b)) {
		for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], [...path, k], where ? `${where} › ${k}` : k, out);
		return;
	}
	if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x) => typeof x !== 'object' || x === null)) {
		a.forEach((x, i) => walk(x, b[i], [...path, String(i)], `${where} [${i}]`, out));
		return;
	}
	if (a === undefined && b !== undefined) out.push({ kind: 'added', where, path: path.join('/'), after: show(b) });
	else if (a !== undefined && b === undefined) out.push({ kind: 'removed', where, path: path.join('/'), before: show(a) });
	else if (norm(a) !== norm(b)) out.push({ kind: 'changed', where, path: path.join('/'), before: show(a), after: show(b) });
}

/**
 * What changed between two versions of a particle effect, in the editor's terms: components added or
 * removed, fields changed (Molang compared ignoring whitespace), events, curves, description.
 */
export function semanticDiff(before: unknown, after: unknown): DiffEntry[] {
	const out: DiffEntry[] = [];
	const pe = (x: unknown) => ((x as { particle_effect?: Record<string, unknown> })?.particle_effect ?? {}) as Record<string, unknown>;
	const A = pe(before);
	const B = pe(after);
	walk(A.description, B.description, ['particle_effect', 'description'], 'Description', out);
	const ca = (A.components ?? {}) as Record<string, unknown>;
	const cb = (B.components ?? {}) as Record<string, unknown>;
	for (const id of new Set([...Object.keys(ca), ...Object.keys(cb)])) {
		const label = COMPONENT_BY_ID.get(id)?.label ?? id.replace(/^minecraft:/, '');
		const path = ['particle_effect', 'components', id];
		if (!(id in ca)) out.push({ kind: 'added', where: label, path: path.join('/'), after: show(cb[id]) });
		else if (!(id in cb)) out.push({ kind: 'removed', where: label, path: path.join('/'), before: show(ca[id]) });
		else walk(ca[id], cb[id], path, label, out);
	}
	const named = (key: 'events' | 'curves', title: string) => {
		const a = (A[key] ?? {}) as Record<string, unknown>;
		const b = (B[key] ?? {}) as Record<string, unknown>;
		for (const n of new Set([...Object.keys(a), ...Object.keys(b)])) {
			const where = `${title} ${n.replace(/^variable\./, 'v.')}`;
			const path = ['particle_effect', key, n];
			if (!(n in a)) out.push({ kind: 'added', where, path: path.join('/'), after: show(b[n]) });
			else if (!(n in b)) out.push({ kind: 'removed', where, path: path.join('/'), before: show(a[n]) });
			else walk(a[n], b[n], path, where, out);
		}
	};
	named('curves', 'Curve');
	named('events', 'Event');
	if (show((before as { format_version?: unknown })?.format_version) !== show((after as { format_version?: unknown })?.format_version)) {
		out.push({ kind: 'changed', where: 'Format version', path: 'format_version', before: show((before as { format_version?: unknown })?.format_version), after: show((after as { format_version?: unknown })?.format_version) });
	}
	return out;
}

/** Plain-text report for a diff (VS Code virtual document, clipboard) */
export function formatDiff(entries: DiffEntry[], titleBefore: string, titleAfter: string): string {
	if (!entries.length) return `No changes that matter to the game between ${titleBefore} and ${titleAfter} (only formatting or comments differ).\n`;
	const lines = [`Changes from ${titleBefore} to ${titleAfter}`, ''];
	for (const e of entries) {
		if (e.kind === 'added') lines.push(`+ ${e.where}: ${e.after}`);
		else if (e.kind === 'removed') lines.push(`- ${e.where}: ${e.before}`);
		else lines.push(`~ ${e.where}`, `    was: ${e.before}`, `    now: ${e.after}`);
	}
	return `${lines.join('\n')}\n`;
}
