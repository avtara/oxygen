import type { Phase } from '@oxygen/format';

/** Molang source text of a JSON value (number, string or {expression, version}) */
export function molangText(raw: unknown): string {
	if (raw === undefined || raw === null) return '';
	if (typeof raw === 'number') return String(raw);
	if (typeof raw === 'boolean') return raw ? '1' : '0';
	if (typeof raw === 'string') return raw;
	if (typeof raw === 'object' && raw && typeof (raw as { expression?: unknown }).expression === 'string') return (raw as { expression: string }).expression;
	return JSON.stringify(raw);
}

export const PHASE_VAR: Record<Phase | 'event', string> = {
	setup: 'var(--ox-phase-setup)',
	emitter: 'var(--ox-phase-emitter)',
	spawn: 'var(--ox-phase-particle)',
	particle: 'var(--ox-phase-particle)',
	render: 'var(--ox-phase-render)',
	event: 'var(--ox-phase-event)',
};

export const PHASE_NAME: Record<Phase | 'event', string> = {
	setup: 'Emitter setup',
	emitter: 'Emitter update',
	spawn: 'Particle spawn',
	particle: 'Particle update',
	render: 'Render',
	event: 'Event',
};

/** Append segments to an already-joined path. Only the appended segments are escaped (`/` → `~1`). */
export function joinPath(base: string | number, ...segments: (string | number)[]): string {
	const rest = segments.filter((p) => p !== '').map((p) => String(p).replace(/~/g, '~0').replace(/\//g, '~1'));
	return [String(base), ...rest].filter((p) => p !== '').join('/');
}

export const COMPONENTS_PATH = 'particle_effect/components';

export function componentPath(id: string): string {
	return joinPath('particle_effect', 'components', id);
}
