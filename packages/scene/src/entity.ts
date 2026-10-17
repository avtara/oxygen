import { quatFromYawPitch, rotateByQuat, type Attachment, type Quat, type Vec3 } from 'wintersky';

export interface Locator {
	name: string;
	/** offset from the entity's feet, in the entity's facing frame (+Z forward) */
	offset: Vec3;
}

/** Player-sized stand-in: locators where vanilla rigs usually put them */
export const DEFAULT_LOCATORS: Locator[] = [
	{ name: 'root', offset: [0, 0, 0] },
	{ name: 'body', offset: [0, 0.9, 0] },
	{ name: 'head', offset: [0, 1.62, 0] },
	{ name: 'right_hand', offset: [-0.375, 1.05, 0.1] },
	{ name: 'left_hand', offset: [0.375, 1.05, 0.1] },
	{ name: 'above_head', offset: [0, 2.1, 0] },
];

export type Motion =
	| { kind: 'still' }
	| { kind: 'circle'; radius: number; speed: number }
	| { kind: 'line'; length: number; speed: number }
	| { kind: 'bob'; height: number; speed: number }
	/** through waypoints at a steady speed; at the last one, back to the first (`loop`) or back the way it came */
	| { kind: 'path'; points: Vec3[]; speed: number; ends: 'loop' | 'reverse' };

/** A path to start from: a 4 × 4 square on the ground */
export const DEFAULT_PATH: Vec3[] = [
	[-2, 0, -2],
	[2, 0, -2],
	[2, 0, 2],
	[-2, 0, 2],
];

/**
 * Where a path motion is at time `t`, and which way it heads (horizontal; null on a vertical stretch).
 * A looping path closes from the last point back to the first.
 */
export function pathAt(m: Extract<Motion, { kind: 'path' }>, t: number): { position: Vec3; heading: [number, number] | null } {
	const pts = m.points.length ? m.points : [[0, 0, 0] as Vec3];
	const route = m.ends === 'loop' && pts.length > 2 ? [...pts, pts[0]] : pts;
	const ends: number[] = [0];
	for (let i = 1; i < route.length; i++) ends.push(ends[i - 1] + Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1], route[i][2] - route[i - 1][2]));
	const total = ends[ends.length - 1];
	if (total < 1e-6) return { position: [...route[0]], heading: null };
	let d = Math.max(0, t) * Math.max(0.01, m.speed);
	let forward = true;
	if (m.ends === 'loop') d %= total;
	else {
		const p = d % (2 * total);
		forward = p < total;
		d = forward ? p : 2 * total - p;
	}
	let i = 1;
	while (i < route.length - 1 && ends[i] < d) i++;
	const a = route[i - 1];
	const b = route[i];
	const len = ends[i] - ends[i - 1];
	const f = len > 0 ? (d - ends[i - 1]) / len : 0;
	const dx = (b[0] - a[0]) * (forward ? 1 : -1);
	const dz = (b[2] - a[2]) * (forward ? 1 : -1);
	return { position: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], heading: Math.hypot(dx, dz) > 1e-6 ? [dx, dz] : null };
}

export interface EntitySettings {
	motion: Motion;
	locator: string;
	/** extra locators defined by the user */
	locators?: Locator[];
	/** facing yaw in degrees (Minecraft: 0 = south/+Z) when still */
	yaw?: number;
	/** bounding box width/height (entity_aabb shape) */
	width?: number;
	height?: number;
	/** the chosen locator flips the Y axis, as some rigs' locators do in-game (not the root) */
	locatorFlipY?: boolean;
}

export const DEFAULT_ENTITY: EntitySettings = { motion: { kind: 'still' }, locator: 'root', width: 0.6, height: 1.8 };

/**
 * The entity an effect is attached to in entity spawn mode: moves along a simple path so local space,
 * velocity inheritance and travel-distance events can be seen, and exposes its locators.
 */
export class EntityDummy {
	position: Vec3 = [0, 0, 0];
	velocity: Vec3 = [0, 0, 0];
	yaw = 0;
	time = 0;
	alive = true;

	constructor(public settings: EntitySettings = DEFAULT_ENTITY) {
		this.update(0);
	}

	get locators(): Locator[] {
		return [...DEFAULT_LOCATORS, ...(this.settings.locators ?? [])];
	}

	update(dt: number): void {
		const prev: Vec3 = [...this.position];
		this.time += dt;
		const m = this.settings.motion;
		const t = this.time;
		switch (m.kind) {
			case 'still':
				this.position = [0, 0, 0];
				this.yaw = this.settings.yaw ?? 0;
				break;
			case 'circle': {
				const w = m.speed / Math.max(0.01, m.radius);
				const a = t * w;
				this.position = [Math.sin(a) * m.radius, 0, Math.cos(a) * m.radius];
				// face along the direction of travel: d/dt (sin a, cos a) = (cos a, -sin a)
				this.yaw = ((a * 180) / Math.PI + 90) % 360;
				break;
			}
			case 'line': {
				const period = (2 * m.length) / Math.max(0.01, m.speed);
				const p = (t % period) / period;
				const s = p < 0.5 ? p * 2 : 2 - p * 2;
				this.position = [0, 0, (s - 0.5) * m.length];
				this.yaw = p < 0.5 ? 0 : 180;
				break;
			}
			case 'bob':
				this.position = [0, (Math.sin(t * m.speed * Math.PI) * 0.5 + 0.5) * m.height, 0];
				this.yaw = this.settings.yaw ?? 0;
				break;
			case 'path': {
				const at = pathAt(m, t);
				this.position = at.position;
				// face the way it walks (yaw 0 = +Z, 90 = +X, as above); straight up or down keeps the last facing
				if (at.heading) this.yaw = (((Math.atan2(at.heading[0], at.heading[1]) * 180) / Math.PI) % 360 + 360) % 360;
				else if (t === 0) this.yaw = this.settings.yaw ?? 0;
				break;
			}
		}
		if (dt > 0) this.velocity = [(this.position[0] - prev[0]) / dt, (this.position[1] - prev[1]) / dt, (this.position[2] - prev[2]) / dt];
	}

	get rotation(): Quat {
		return quatFromYawPitch(this.yaw, 0);
	}

	locatorPosition(name: string): Vec3 {
		const loc = this.locators.find((l) => l.name === name) ?? DEFAULT_LOCATORS[0];
		const out: Vec3 = [0, 0, 0];
		rotateByQuat(out, loc.offset[0], loc.offset[1], loc.offset[2], this.rotation);
		return [this.position[0] + out[0], this.position[1] + out[1], this.position[2] + out[2]];
	}

	/** wintersky attachment for an emitter bound to a locator */
	attachment(locator = this.settings.locator): Attachment {
		const w = (this.settings.width ?? 0.6) / 2;
		const h = this.settings.height ?? 1.8;
		const loc = this.locators.find((l) => l.name === locator) ?? DEFAULT_LOCATORS[0];
		return {
			getTransform: () => ({ position: this.locatorPosition(locator), rotation: this.rotation, velocity: [...this.velocity] as Vec3 }),
			alive: () => this.alive,
			// entity_aabb: the entity's box relative to the emitter (locator) origin
			aabb: { min: [-w, -loc.offset[1], -w], max: [w, h - loc.offset[1], w] },
			mirrorY: !!this.settings.locatorFlipY && loc.name !== 'root',
		};
	}
}
