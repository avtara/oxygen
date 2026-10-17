import { analyzeEffect } from '@oxygen/effect';
import { rotateByQuat, type Attachment, type ContentError, type EffectDefinition, type ParticleWorld, type PortableEmitter, type Quat, type Vec3 } from 'wintersky';
import type { RenderableEmitter } from 'wintersky/render';
import SimWorker from './worker?worker&inline';
import type { FrameInputs, FromSim, PackedArrays, RemoteFrame, SimSetup, ToSim } from './protocol';

/**
 * Heavy scenes run on several threads. Bedrock's temps are global, so emitter trees that touch temps
 * stay together on the main thread; every other tree is independent and can run in a worker, in its own
 * world, stepped in lockstep with the main thread's inputs. Drawing uses what the workers send back.
 * Anything that needs the whole world in one place (inspecting, the log, stepping, scrubbing, pausing)
 * calls the trees back first.
 */

/** live particles before work is spread over threads (below this one thread is well inside a frame) */
export const PARALLEL_THRESHOLD = 12000;

// queries that read the whole world: a worker only sees its own part of it
const GLOBAL_QUERIES = new Set(['query.total_particle_count', 'query.total_emitter_count', 'query.effect_emitter_count', 'query.effect_particle_count']);

export interface ParallelHost {
	readonly world: ParticleWorld;
	setup(): Omit<SimSetup, 'seed' | 'emitterBase' | 'particleBase' | 'time' | 'frame'> & { seed: number };
	definition(identifier: string): EffectDefinition | null;
	attachment(): Attachment | null;
	frameInputs(dt: number): FrameInputs;
	contentErrors(errors: ContentError[]): void;
	/** a worker failed: its emitters are gone, so start over */
	failed(message: string): void;
}

const STRIDE = { pos: 3, size: 2, rot: 1, facing: 3, uv: 4, color: 4, visible: 1, local: 1, id: 1 } as const;

/** An emitter simulated in a worker, as drawing, markers and picking see it */
export class RemoteEmitter implements RenderableEmitter {
	readonly pool = {
		count: 0,
		capacity: 0,
		pos: new Float32Array(0),
		size: new Float32Array(0),
		rot: new Float32Array(0),
		facing: new Float32Array(0),
		uv: new Float32Array(0),
		color: new Uint8Array(0),
		visible: new Uint8Array(0),
		local: new Uint8Array(0),
		id: new Uint32Array(0),
	};
	parentId: number | null = null;
	culled = false;
	localSpace = false;
	expired = false;
	activeTime = 0;
	sleepTime = 0;
	cap = 0;
	position: Vec3 = [0, 0, 0];
	rotation: Quat = [0, 0, 0, 1];

	constructor(
		readonly id: number,
		readonly def: EffectDefinition,
	) {}

	/** Copy a frame in; the arrays keep their identity so the GPU buffers are reused */
	update(f: RemoteFrame, packed: PackedArrays) {
		const p = this.pool;
		if (f.count > p.capacity) {
			let cap = Math.max(64, p.capacity);
			while (cap < f.count) cap *= 2;
			p.capacity = cap;
			p.pos = new Float32Array(cap * 3);
			p.size = new Float32Array(cap * 2);
			p.rot = new Float32Array(cap);
			p.facing = new Float32Array(cap * 3);
			p.uv = new Float32Array(cap * 4);
			p.color = new Uint8Array(cap * 4);
			p.visible = new Uint8Array(cap);
			p.local = new Uint8Array(cap);
			p.id = new Uint32Array(cap);
		}
		for (const key of Object.keys(STRIDE) as (keyof typeof STRIDE)[]) {
			const k = STRIDE[key];
			(p[key] as Float32Array).set((packed[key] as Float32Array).subarray(f.offset * k, (f.offset + f.count) * k));
		}
		p.count = f.count;
		this.parentId = f.parentId;
		this.culled = f.culled;
		this.localSpace = f.localSpace;
		this.expired = f.expired;
		this.activeTime = f.activeTime;
		this.sleepTime = f.sleepTime;
		this.cap = f.cap;
		this.position = f.position;
		this.rotation = f.rotation;
	}

	/** Same as EmitterInstance.particleWorldPos */
	particleWorldPos(i: number, out: Vec3): Vec3 {
		const p = this.pool;
		const x = p.pos[i * 3], y = p.pos[i * 3 + 1], z = p.pos[i * 3 + 2];
		if (!p.local[i]) {
			out[0] = x;
			out[1] = y;
			out[2] = z;
			return out;
		}
		if (this.def.emitter.localSpace.rotation) rotateByQuat(out, x, y, z, this.rotation);
		else {
			out[0] = x;
			out[1] = y;
			out[2] = z;
		}
		out[0] += this.position[0];
		out[1] += this.position[1];
		out[2] += this.position[2];
		return out;
	}
}

interface Lane {
	worker: Worker;
	/** replies to steps older than this belong to a previous run */
	base: number;
	seq: number;
	busy: boolean;
	pendingDt: number;
	/** emitters this lane owns */
	ids: Set<number>;
	recalled: ((emitters: PortableEmitter[]) => void) | null;
	idle: (() => void)[];
}

export class ParallelSim {
	/** emitters running in workers, by id */
	readonly remote = new Map<number, RemoteEmitter>();
	engaged = false;
	/** frames received from workers (for measuring) */
	framesReceived = 0;
	/** workers can't be used here (no Worker, a CSP that forbids them, or one failed) */
	unavailable = false;
	private lanes: Lane[] = [];
	private runs = 0;
	private transition: Promise<void> | null = null;
	private eligible = new WeakMap<EffectDefinition, boolean>();

	constructor(
		private host: ParallelHost,
		private maxLanes = Math.max(1, Math.min(4, (globalThis.navigator?.hardwareConcurrency ?? 4) - 1)),
	) {}

	get lanesInUse(): number {
		return this.lanes.filter((l) => l.ids.size).length;
	}

	get particleCount(): number {
		let n = 0;
		for (const e of this.remote.values()) n += e.pool.count;
		return n;
	}

	/** A tree can leave the main thread when it touches no temps and asks nothing about the whole world */
	private independent(def: EffectDefinition): boolean {
		let ok = this.eligible.get(def);
		if (ok === undefined) {
			const a = analyzeEffect(def);
			ok = !a.temps.length && !a.queries.some((q) => GLOBAL_QUERIES.has(q.name));
			this.eligible.set(def, ok);
		}
		return ok;
	}

	/** The main world's emitters as trees (a root and what its events spawned), with their particle counts */
	private trees(): { ids: number[]; particles: number; independent: boolean }[] {
		const w = this.host.world;
		const byId = new Map(w.emitters.map((e) => [e.id, e]));
		const rootOf = (id: number): number => {
			let e = byId.get(id)!;
			while (e.parentId !== null && byId.has(e.parentId)) e = byId.get(e.parentId)!;
			return e.id;
		};
		const trees = new Map<number, { ids: number[]; particles: number; independent: boolean }>();
		for (const e of w.emitters) {
			const r = rootOf(e.id);
			let t = trees.get(r);
			if (!t) trees.set(r, (t = { ids: [], particles: 0, independent: true }));
			t.ids.push(e.id);
			t.particles += e.pool.count;
			t.independent &&= this.independent(e.def);
		}
		return [...trees.values()];
	}

	/** Spread independent trees over workers when the scene is heavy enough to gain from it */
	engage(): void {
		if (this.engaged || this.transition || this.unavailable || typeof Worker === 'undefined') return;
		const free = this.trees().filter((t) => t.independent);
		const particles = free.reduce((n, t) => n + t.particles, 0);
		if (free.length < 2 || particles < PARALLEL_THRESHOLD) return;
		const laneCount = Math.min(this.maxLanes, free.length);
		try {
			while (this.lanes.length < laneCount) this.lanes.push(this.createLane());
		} catch (e) {
			console.warn('Oxygen: simulation workers are unavailable here', e);
			this.unavailable = true;
			return;
		}
		// biggest trees first, each to the least loaded worker
		const load = new Array(laneCount).fill(0);
		const plan: number[][] = Array.from({ length: laneCount }, () => []);
		for (const t of free.sort((a, b) => b.particles - a.particles)) {
			const k = load.indexOf(Math.min(...load));
			load[k] += t.particles;
			plan[k].push(...t.ids);
		}
		this.runs++;
		const base = this.host.setup();
		const w = this.host.world;
		plan.forEach((ids, k) => {
			const lane = this.lanes[k];
			const setup: SimSetup = {
				...base,
				seed: (base.seed + 7919 * (k + 1) + 104729 * this.runs) >>> 0,
				emitterBase: (k + 1) * 2 ** 24 + this.runs * 2 ** 20,
				particleBase: (k + 1) * 2 ** 28 + ((this.runs * 2 ** 22) % 2 ** 27),
				time: w.time,
				frame: w.frame,
			};
			lane.base = lane.seq + 1;
			lane.busy = false;
			lane.pendingDt = 0;
			lane.ids = new Set(ids);
			const moving = w.export(lane.ids);
			for (const p of moving) {
				const def = this.host.definition(p.effect);
				if (!def) continue;
				const r = new RemoteEmitter(p.id, def);
				r.update(portableFrame(p), p.pool as unknown as PackedArrays);
				r.localSpace = p.options.attached && def.emitter.localSpace.position;
				this.remote.set(p.id, r);
			}
			this.send(lane, { type: 'setup', setup });
			this.send(lane, { type: 'adopt', emitters: moving });
		});
		this.engaged = true;
	}

	/** Advance the workers by the same step as the main world (a busy worker gets the time on its next step) */
	step(dt: number): void {
		if (!this.engaged || this.transition) return;
		const inputs = this.host.frameInputs(dt);
		for (const lane of this.lanes) {
			if (!lane.ids.size) continue;
			if (lane.busy) {
				lane.pendingDt += dt;
				continue;
			}
			lane.busy = true;
			this.send(lane, { type: 'step', seq: ++lane.seq, inputs: { ...inputs, dt: dt + lane.pendingDt } });
			lane.pendingDt = 0;
		}
	}

	/** Bring every tree back to the main world */
	recall(): Promise<void> {
		if (!this.engaged) return this.transition ?? Promise.resolve();
		if (this.transition) return this.transition;
		this.transition = (async () => {
			const lanes = this.lanes.filter((l) => l.ids.size);
			const answers = Promise.all(
				lanes.map(async (lane) => {
					if (lane.busy) await new Promise<void>((r) => lane.idle.push(r));
					return new Promise<PortableEmitter[]>((resolve) => {
						lane.recalled = resolve;
						this.send(lane, { type: 'recall', seq: ++lane.seq });
					});
				}),
			);
			// a worker that doesn't answer has failed: start over on this thread rather than wait forever
			let timer: ReturnType<typeof setTimeout> | undefined;
			const silent = new Promise<null>((r) => (timer = setTimeout(() => r(null), 5000)));
			const back = await Promise.race([answers, silent]);
			clearTimeout(timer);
			if (!back) {
				this.fail("a simulation worker didn't hand its emitters back");
				return;
			}
			const w = this.host.world;
			for (const list of back) w.adopt(list, (id) => this.host.definition(id), () => this.host.attachment());
			for (const lane of lanes) lane.ids = new Set();
			this.remote.clear();
			this.engaged = false;
		})();
		return this.transition.finally(() => (this.transition = null));
	}

	/** Forget everything in the workers (the effect restarts) */
	reset(): void {
		for (const lane of this.lanes) {
			lane.base = lane.seq + 1;
			lane.busy = false;
			lane.pendingDt = 0;
			lane.ids = new Set();
			lane.recalled?.([]);
			lane.recalled = null;
			for (const r of lane.idle.splice(0)) r();
			this.send(lane, { type: 'clear' });
		}
		this.remote.clear();
		this.engaged = false;
	}

	dispose(): void {
		for (const lane of this.lanes) lane.worker.terminate();
		this.lanes = [];
		this.remote.clear();
		this.engaged = false;
	}

	private send(lane: Lane, m: ToSim) {
		lane.worker.postMessage(m);
	}

	private createLane(): Lane {
		const worker = new SimWorker();
		const lane: Lane = { worker, base: 0, seq: 0, busy: false, pendingDt: 0, ids: new Set(), recalled: null, idle: [] };
		worker.onmessage = (ev: MessageEvent<FromSim>) => this.receive(lane, ev.data);
		worker.onerror = (ev) => {
			ev.preventDefault();
			this.fail(`a simulation worker stopped: ${ev.message}`);
		};
		return lane;
	}

	private receive(lane: Lane, m: FromSim) {
		if (m.type === 'failed') return this.fail(m.message);
		if (m.seq < lane.base) return; // from before a restart
		if (m.type === 'recalled') {
			lane.recalled?.(m.emitters);
			lane.recalled = null;
			return;
		}
		lane.busy = false;
		this.framesReceived++;
		const seen = new Set<number>();
		for (const f of m.emitters) {
			seen.add(f.id);
			lane.ids.add(f.id);
			let r = this.remote.get(f.id);
			if (!r) {
				const def = this.host.definition(f.effect);
				if (!def) continue;
				this.remote.set(f.id, (r = new RemoteEmitter(f.id, def)));
			}
			r.update(f, m.packed);
		}
		// emitters that ended in the worker
		for (const id of [...lane.ids]) {
			if (seen.has(id)) continue;
			lane.ids.delete(id);
			this.remote.delete(id);
		}
		if (m.errors?.length) this.host.contentErrors(m.errors);
		for (const r of lane.idle.splice(0)) r();
	}

	private fail(message: string) {
		console.warn(`Oxygen: ${message}`);
		this.unavailable = true;
		this.reset();
		this.host.failed(message);
	}
}

/** A RemoteFrame built from an exported emitter, so it draws before the worker's first frame */
function portableFrame(p: PortableEmitter): RemoteFrame {
	const n = p.pool.count;
	return {
		id: p.id,
		parentId: p.parentId,
		effect: p.effect,
		count: n,
		culled: false,
		localSpace: false,
		expired: !!(p.scalars as { expired?: boolean }).expired,
		position: p.position,
		rotation: p.rotation,
		activeTime: Number((p.scalars as { activeTime?: number }).activeTime ?? 0),
		sleepTime: Number((p.scalars as { sleepTime?: number }).sleepTime ?? 0),
		cap: 0,
		// the exported pool itself serves as the packed arrays, starting at 0
		offset: 0,
	};
}
