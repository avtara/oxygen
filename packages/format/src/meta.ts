import type { JsonDocument } from './document';

/**
 * Oxygen's data inside a particle file: a top-level "oxygen" key. The game ignores unknown top-level keys
 * without logging anything (test t12), so this travels with the file.
 */
export const META_KEY = 'oxygen';
export const META_VERSION = 1;

/** `//` comments for one Molang field, anchored to the statement they precede (or the end) */
export interface FieldComment {
	/** statement index the comment precedes; equal to the statement count for trailing comments */
	before: number;
	text: string;
}

/** Where a scene-bound input reads from */
export type SceneSource =
	| 'time'
	| 'time_of_day'
	| 'entity.x'
	| 'entity.y'
	| 'entity.z'
	| 'entity.speed'
	| 'entity.vertical_speed'
	| 'entity.yaw'
	| 'entity.moving'
	| 'camera.x'
	| 'camera.y'
	| 'camera.z'
	| 'camera.distance'
	| 'camera.yaw'
	| 'camera.pitch';

/**
 * A value the preview supplies for something the effect reads from outside. Numbers and strings are
 * constants (Molang has no booleans: true is 1.0). The object forms are drivers, evaluated over scene time.
 */
export type InputValue =
	| number
	| string
	/** Molang, with q.anim_time / q.life_time = seconds since the effect started */
	| { molang: string }
	/** [seconds, value] keys, linear between keys and held at the ends */
	| { keys: [number, number][]; loop?: boolean; step?: boolean }
	/** a value per argument list for a query called with changing arguments, keyed like `0` or `'head', 2` */
	| { table: Record<string, number | string>; fallback?: number | string }
	| { scene: SceneSource };

export interface Scenario {
	name: string;
	/** Molang run before creation_expression, like an entity's pre_effect_script */
	preEffect?: string;
	/** Variable values handed in like a Script API MolangVariableMap (read once, when the emitter starts) */
	variables?: Record<string, InputValue>;
	/** Variables written again before every update. The game never does this; it's for exploring. */
	pinned?: string[];
	/** Query values by call signature (`query.position(1)`) or by bare name (`query.is_moving`) */
	queries?: Record<string, InputValue>;
	spawn?: 'command' | 'entity' | 'script';
}

export interface CameraBookmark {
	name: string;
	position: [number, number, number];
	target: [number, number, number];
	fov?: number;
}

export interface OxygenMeta {
	version: number;
	/** JSON path (slash form) → comments */
	comments?: Record<string, FieldComment[]>;
	scenarios?: Scenario[];
	activeScenario?: string;
	scene?: Record<string, unknown>;
	cameras?: CameraBookmark[];
}

export function readMeta(doc: JsonDocument): OxygenMeta {
	const raw = doc.get([META_KEY]);
	if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { version: META_VERSION, ...(raw as object) } as OxygenMeta;
	return { version: META_VERSION };
}

/** Write one metadata entry; creates the block (at the end of the file) when needed */
export function writeMeta<K extends keyof OxygenMeta>(doc: JsonDocument, key: K, value: OxygenMeta[K] | undefined, label = 'Edit metadata'): void {
	doc.transact(label, () => {
		if (!doc.has([META_KEY])) {
			if (value === undefined) return;
			doc.set([META_KEY], { version: META_VERSION }, label);
		}
		if (value === undefined) doc.remove([META_KEY, key], label);
		else doc.set([META_KEY, key], value, label);
		const rest = doc.get([META_KEY]) as Record<string, unknown>;
		if (rest && Object.keys(rest).every((k) => k === 'version')) doc.remove([META_KEY], label);
	});
}

export function fieldComments(meta: OxygenMeta, path: string): FieldComment[] {
	return meta.comments?.[path] ?? [];
}

export function writeFieldComments(doc: JsonDocument, path: string, comments: FieldComment[]): void {
	const meta = readMeta(doc);
	const all = { ...(meta.comments ?? {}) };
	if (comments.length) all[path] = comments;
	else delete all[path];
	writeMeta(doc, 'comments', Object.keys(all).length ? all : undefined, 'Edit comments');
}
