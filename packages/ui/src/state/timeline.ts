import type { ParticleWorld } from 'wintersky';

/** One emitter's life on the timeline */
export interface TimelineLane {
	id: number;
	effect: string;
	parent: number | null;
	start: number;
	/** removed (expired with no particles left); null while it lasts */
	end: number | null;
	/** spans while the emitter is active (spawning or able to), [from, to] */
	active: [number, number][];
	events: { t: number; name: string; particle: boolean }[];
}

/** Anything the timeline can follow: a live emitter or a stand-in for one simulated in a worker */
export interface TimelineEmitter {
	readonly id: number;
	readonly def: { identifier: string };
	readonly parentId?: number | null;
	readonly active?: boolean;
	readonly expired?: boolean;
}

/** seconds of activity kept */
const WINDOW = 120;
const MAX_LANES = 4000;
const MAX_EVENTS = 400;

/**
 * What happened over time in a preview: the particle count each frame, every emitter's life (when it
 * appeared, while it was active, when it went away) and the events it fired. Only frames that move time
 * forward are recorded; replays (scrubbing, re-running a frame for the debugger) are not, and playing on
 * from a scrubbed moment cuts off the old future.
 */
export class TimelineRecorder {
	times: number[] = [];
	counts: number[] = [];
	lanes = new Map<number, TimelineLane>();
	private openSpan = new Set<number>();
	private pending: { id: number; effect: string; parent: number | null; name: string; particle: boolean }[] = [];

	attach(world: ParticleWorld): void {
		world.onEvent = (e, name, particle) => this.pending.push({ id: e.id, effect: e.def.identifier, parent: e.parentId ?? null, name, particle: particle >= 0 });
	}

	reset(): void {
		this.times = [];
		this.counts = [];
		this.lanes.clear();
		this.openSpan.clear();
		this.pending.length = 0;
	}

	/** Events from a replayed step are not news */
	discardPending(): void {
		this.pending.length = 0;
	}

	private lane(id: number, effect: string, parent: number | null, t: number): TimelineLane {
		let l = this.lanes.get(id);
		if (!l) this.lanes.set(id, (l = { id, effect, parent, start: t, end: null, active: [], events: [] }));
		return l;
	}

	/** File the events fired since the last commit at time `t` */
	commitEvents(t: number): void {
		for (const p of this.pending) {
			const l = this.lane(p.id, p.effect, p.parent, t);
			if (l.events.length < MAX_EVENTS) l.events.push({ t, name: p.name, particle: p.particle });
		}
		this.pending.length = 0;
	}

	/** Record a frame that moved time forward to `t` */
	frame(t: number, emitters: Iterable<TimelineEmitter>, particles: number): void {
		this.commitEvents(t);
		this.times.push(t);
		this.counts.push(particles);
		const seen = new Set<number>();
		for (const e of emitters) {
			seen.add(e.id);
			const l = this.lane(e.id, e.def.identifier, e.parentId ?? null, t);
			l.end = null;
			const active = e.active ?? !e.expired;
			if (active) {
				const last = l.active[l.active.length - 1];
				if (this.openSpan.has(e.id) && last) last[1] = t;
				else l.active.push([t, t]);
				this.openSpan.add(e.id);
			} else this.openSpan.delete(e.id);
		}
		for (const l of this.lanes.values()) {
			if (l.end === null && !seen.has(l.id)) {
				l.end = t;
				this.openSpan.delete(l.id);
			}
		}
		this.prune(t);
	}

	/** Playing on from a scrubbed moment: forget everything recorded after it */
	truncateAfter(t: number): void {
		let n = this.times.length;
		while (n > 0 && this.times[n - 1] > t) n--;
		this.times.length = n;
		this.counts.length = n;
		for (const l of [...this.lanes.values()]) {
			if (l.start > t) {
				this.lanes.delete(l.id);
				continue;
			}
			if (l.end !== null && l.end > t) l.end = null;
			l.active = l.active.filter((s) => s[0] <= t).map((s) => [s[0], Math.min(s[1], t)] as [number, number]);
			l.events = l.events.filter((e) => e.t <= t);
		}
		this.openSpan.clear();
		this.pending.length = 0;
	}

	private prune(now: number): void {
		const from = now - WINDOW;
		let drop = 0;
		while (drop < this.times.length && this.times[drop] < from) drop++;
		if (drop > 600 || (drop && this.times.length > 20000)) {
			this.times.splice(0, drop);
			this.counts.splice(0, drop);
		}
		if (this.lanes.size > MAX_LANES || (this.times.length % 600 === 0 && this.lanes.size)) {
			const ended = [...this.lanes.values()].filter((l) => l.end !== null).sort((a, b) => a.end! - b.end!);
			for (const l of ended) {
				if (this.lanes.size <= MAX_LANES && l.end! >= from) break;
				this.lanes.delete(l.id);
			}
		}
	}
}
