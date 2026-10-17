/**
 * Who spawns whom: the effects an effect's events spawn, and the variables each spawn's
 * pre_effect_expression sets in the child. Works on raw JSON so hosts can index a whole pack cheaply.
 */

export interface EffectSpawns {
	identifier: string;
	spawns: { effect: string; sets: string[] }[];
}

/** Variables an expression assigns (`v.x = …`, `variable.x = …`), canonical and lower-case */
export function assignedVariables(src: string): string[] {
	const out = new Set<string>();
	for (const m of src.matchAll(/\b(?:v|variable)\.([a-z_][a-z0-9_]*)\s*=(?!=)/gi)) out.add(`variable.${m[1].toLowerCase()}`);
	return [...out];
}

const molangSource = (raw: unknown): string =>
	typeof raw === 'string' ? raw : raw && typeof raw === 'object' && typeof (raw as { expression?: unknown }).expression === 'string' ? (raw as { expression: string }).expression : '';

/** The spawns in one effect file (null when it isn't a particle effect) */
export function spawnsOf(json: unknown): EffectSpawns | null {
	const pe = (json as { particle_effect?: { description?: { identifier?: unknown }; events?: unknown } } | null)?.particle_effect;
	const identifier = pe?.description?.identifier;
	if (typeof identifier !== 'string') return null;
	const spawns: EffectSpawns['spawns'] = [];
	const walk = (node: unknown, depth: number) => {
		if (!node || typeof node !== 'object' || depth > 32) return;
		const n = node as { sequence?: unknown; randomize?: unknown; particle_effect?: { effect?: unknown; pre_effect_expression?: unknown } };
		if (Array.isArray(n.sequence)) for (const x of n.sequence) walk(x, depth + 1);
		if (Array.isArray(n.randomize)) for (const x of n.randomize) walk(x, depth + 1);
		const p = n.particle_effect;
		if (p && typeof p.effect === 'string' && p.effect) spawns.push({ effect: p.effect, sets: assignedVariables(molangSource(p.pre_effect_expression)) });
	};
	const events = pe?.events;
	if (events && typeof events === 'object') for (const e of Object.values(events)) walk(e, 0);
	return { identifier, spawns };
}

/** Variables set for `child` by the pre-effects of the effects that spawn it (variable → parents) */
export function parentInputsFor(index: Iterable<EffectSpawns>, child: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const e of index) {
		for (const s of e.spawns) {
			if (s.effect !== child) continue;
			for (const v of s.sets) {
				const has = out[v]?.split(', ') ?? [];
				if (!has.includes(e.identifier)) out[v] = [...has, e.identifier].join(', ');
			}
		}
	}
	return out;
}
