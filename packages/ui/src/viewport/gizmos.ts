/** Viewport helpers that can be hidden one by one */
export interface Gizmos {
	/** the ground plane and its grid */
	ground: boolean;
	/** the one-block outline, for scale */
	block: boolean;
	/** the effect's own emitter (axes and ring) */
	emitter: boolean;
	/** emitters its events spawn */
	children: boolean;
	killPlane: boolean;
	/** the stand-in entity, its locator and its path */
	entity: boolean;
}
export const DEFAULT_GIZMOS: Gizmos = { ground: true, block: true, emitter: true, children: true, killPlane: true, entity: true };

/** What a click on the viewport hit, other than a particle */
export type GizmoHit = { kind: 'emitter'; id: number } | { kind: 'shape' } | { kind: 'killPlane' } | { kind: 'entity' };
