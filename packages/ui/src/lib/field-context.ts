import type { FieldRef, Problem } from '@oxygen/effect';
import type { FieldInfo } from '@oxygen/format';
import type { LangDiagnostic, MolangContext } from '@oxygen/lang';
import type { EffectSession } from '../state/session.svelte';

/** Problems attached to a path or anything inside it */
export function problemsAt(session: EffectSession, path: string, exact = false): Problem[] {
	return session.problems.filter((p) => (exact ? p.path === path : p.path === path || p.path.startsWith(`${path}/`) || p.path.startsWith(`${path}#`)));
}

/** First-frame evaluation step of a field (1-based), or null when it never runs */
export function orderOf(session: EffectSession, path: string): number | null {
	const fields = session.analysis?.fields ?? [];
	let n = 0;
	for (const f of fields) {
		if (f.rank === Infinity) continue;
		n++;
		if (f.path === path) return n;
	}
	return null;
}

export function fieldRef(session: EffectSession, path: string): FieldRef | undefined {
	return session.analysis?.byPath.get(path);
}

/** Editor context for one Molang field: phase, fallback, effect variables and effect-wide diagnostics */
export function molangContextFor(session: EffectSession, path: string, info?: FieldInfo, fallback?: number | null): MolangContext {
	const ref = fieldRef(session, path);
	const analysis = session.analysis;
	return {
		phase: ref?.phase ?? info?.phase,
		// event expressions and pre-effects only run statements (a pre-effect runs in the child, outside this analysis)
		expectsValue: info ? info.kind.type !== 'statements' : (ref?.expectsValue ?? !path.includes('/events/')),
		fallback: fallback !== undefined ? fallback : (ref?.fallback ?? null),
		variables: () => analysis?.variables ?? [],
		temps: () => analysis?.temps ?? [],
		onRename: (name) => (session.renameRequest = name),
		onDefinition: (name) => {
			const v = analysis?.variables.find((x) => x.name === name);
			// the write that runs first; a variable nobody sets is shown with its references instead
			const first = v?.writes
				.map((w) => ({ path: w.path, rank: analysis?.byPath.get(w.path)?.rank ?? Infinity }))
				.sort((a, b) => a.rank - b.rank)[0];
			if (first) session.selected = first.path;
			else session.referencesRequest = { name, at: Date.now() };
		},
		onReferences: (name) => (session.referencesRequest = { name, at: Date.now() }),
		extraDiagnostics: () =>
			(analysis?.problems ?? [])
				.filter((p) => p.path === path && p.source === 'effect' && p.from !== undefined)
				.map((p): LangDiagnostic => ({ from: p.from!, to: Math.max(p.to ?? p.from! + 1, p.from! + 1), severity: p.severity, message: p.message, code: p.code })),
	};
}
