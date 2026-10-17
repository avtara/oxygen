import { COMPONENT_BY_ID, type FieldInfo } from '@oxygen/format';
import type { FieldPhase, FieldRef } from '@oxygen/effect';
import type { EffectSession } from '../state/session.svelte';
import { joinPath } from './molang-text';

/** One Molang value of a field: an existing expression, a plain number, or a value that isn't in the file yet */
export interface TargetAxis {
	path: string;
	label: string;
	phase: FieldPhase;
	/** what the game uses when the field is absent or fails */
	fallback: number | null;
	expectsValue: boolean;
	/** the compiled field, when the file has one at this path */
	ref: FieldRef | null;
}

/** What the Expression and Graph panels show for the current selection */
export interface FieldTarget {
	kind: 'single' | 'vector';
	/** the field's own path (a vector's array) */
	base: string;
	axes: TargetAxis[];
	info: FieldInfo | null;
	/** the field isn't in the file yet */
	missing: boolean;
}

const COMPONENTS = 'particle_effect/components/';

/** The catalog entry for a component field path (`particle_effect/components/<id>/<key>`) */
export function fieldInfoAt(path: string): FieldInfo | null {
	if (!path.startsWith(COMPONENTS)) return null;
	const rest = path.slice(COMPONENTS.length);
	const slash = rest.indexOf('/');
	const component = COMPONENT_BY_ID.get(slash < 0 ? rest : rest.slice(0, slash));
	if (!component) return null;
	// components whose value is the field itself (initial speed)
	if (slash < 0) return component.valueShape === 'molang-or-vec' ? (component.fields[0] ?? null) : null;
	const key = rest.slice(slash + 1);
	return component.fields.find((f) => f.key === key) ?? null;
}

function axis(s: EffectSession, path: string, info: FieldInfo | null, index: number | null): TargetAxis {
	const ref = s.analysis.byPath.get(path) ?? null;
	const kind = info?.kind;
	const label = ref?.label ?? (info ? (index !== null && kind?.type === 'vec' ? `${info.label} ${kind.labels[index] ?? index}` : info.label) : path.split('/').pop()!);
	const fallback = ref ? ref.fallback : kind?.type === 'molang' ? (kind.default ?? null) : kind?.type === 'vec' && index !== null ? (kind.default?.[index] ?? null) : null;
	return {
		path,
		label,
		phase: ref?.phase ?? ((info?.phase ?? 'particle') as FieldPhase),
		fallback,
		expectsValue: ref?.expectsValue ?? kind?.type !== 'statements',
		ref,
	};
}

/**
 * The Molang field a selection points at. An axis, or a vector's own path, gives the whole vector; any field the
 * catalog says takes Molang counts, even when it holds a plain number or isn't in the file yet.
 */
export function fieldTarget(s: EffectSession, selected: string | null | undefined): FieldTarget | null {
	if (!selected || !s.analysis) return null;
	const byPath = s.analysis.byPath;
	const asVector = (base: string): FieldTarget | null => {
		const info = fieldInfoAt(base);
		const value = s.doc.get(base);
		let size = 0;
		if (info?.kind.type === 'vec') size = info.kind.size;
		else if (Array.isArray(value) && value.length >= 2 && value.length <= 4 && value.every((_, i) => byPath.has(joinPath(base, i)))) size = value.length;
		if (!size) return null;
		return { kind: 'vector', base, axes: Array.from({ length: size }, (_, i) => axis(s, joinPath(base, i), info, i)), info, missing: value === undefined };
	};
	const m = /^(.*)\/(\d)$/.exec(selected);
	if (m) {
		const v = asVector(m[1]);
		if (v) return v;
	}
	if (byPath.has(selected)) {
		const info = fieldInfoAt(selected);
		return { kind: 'single', base: selected, axes: [axis(s, selected, info, null)], info, missing: false };
	}
	const v = asVector(selected);
	if (v) return v;
	const info = fieldInfoAt(selected);
	if (info && (info.kind.type === 'molang' || info.kind.type === 'statements')) {
		return { kind: 'single', base: selected, axes: [axis(s, selected, info, null)], info, missing: s.doc.get(selected) === undefined };
	}
	return null;
}
