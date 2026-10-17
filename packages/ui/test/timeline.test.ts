import { describe, expect, it } from 'vitest';
import { ParticleWorld } from 'wintersky';
import { TimelineRecorder } from '../src/state/timeline';

const effect = (id: string, components: Record<string, unknown>, events: Record<string, unknown> = {}) => ({
	format_version: '1.10.0',
	particle_effect: {
		description: { identifier: id, basic_render_parameters: { material: 'particles_alpha', texture: 'textures/particle/particles' } },
		components: { 'minecraft:particle_appearance_billboard': { size: [0.1, 0.1], facing_camera_mode: 'rotate_xyz' }, ...components },
		events,
	},
});

describe('timeline recorder', () => {
	const setup = () => {
		const world = new ParticleWorld({ seed: 1 });
		const child = world.loadEffect(
			effect('test:child', {
				'minecraft:emitter_rate_instant': { num_particles: 3 },
				'minecraft:emitter_lifetime_once': { active_time: 0.2 },
				'minecraft:particle_lifetime_expression': { max_lifetime: 0.3 },
			}),
		);
		const root = world.loadEffect(
			effect(
				'test:root',
				{
					'minecraft:emitter_rate_steady': { spawn_rate: 10, max_particles: 100 },
					'minecraft:emitter_lifetime_once': { active_time: 1 },
					'minecraft:emitter_lifetime_events': { creation_event: 'start', timeline: { '0.5': 'pop' } },
					'minecraft:particle_lifetime_expression': { max_lifetime: 0.5 },
				},
				{ start: { expression: 'v.a = 1;' }, pop: { particle_effect: { effect: 'test:child', type: 'emitter' } } },
			),
		);
		world.resolveEffect = (id) => (id === 'test:child' ? child : id === 'test:root' ? root : null);
		const rec = new TimelineRecorder();
		rec.attach(world);
		world.spawn(root, { position: [0, 0, 0] });
		rec.commitEvents(world.time);
		const run = (frames: number) => {
			for (let i = 0; i < frames; i++) {
				rec.discardPending();
				world.step(1 / 60);
				rec.frame(world.time, world.emitters, world.particleCount);
			}
		};
		return { world, rec, run };
	};

	it('records particle counts, emitter lives and the events they fire', () => {
		const { rec, run } = setup();
		run(120);
		expect(rec.times).toHaveLength(120);
		expect(Math.max(...rec.counts)).toBeGreaterThan(3);
		const lanes = [...rec.lanes.values()];
		const root = lanes.find((l) => l.effect === 'test:root')!;
		const child = lanes.find((l) => l.effect === 'test:child')!;
		expect(root.events.map((e) => e.name)).toEqual(['start', 'pop']);
		expect(root.events[0].t).toBe(0);
		expect(root.events[1].t).toBeCloseTo(0.5, 1);
		// active for its 1 s, then lingers until its particles are gone
		expect(root.active).toHaveLength(1);
		expect(root.active[0][1]).toBeCloseTo(1, 1);
		expect(root.end).not.toBeNull();
		expect(root.end!).toBeGreaterThan(1.3);
		expect(child.parent).toBe(root.id);
		expect(child.start).toBeCloseTo(0.5, 1);
		expect(child.end!).toBeLessThan(1.2);
	});

	it("doesn't record replays, and cuts off the future when play forks", () => {
		const { world, rec, run } = setup();
		run(30);
		const snap = world.snapshot();
		run(30);
		const before = rec.times.length;
		// a replay (scrub): steps without recording
		world.restore(snap);
		for (let i = 0; i < 30; i++) world.step(1 / 60);
		rec.discardPending();
		expect(rec.times.length).toBe(before);
		expect([...rec.lanes.values()].find((l) => l.effect === 'test:root')!.events).toHaveLength(2);
		// playing on from 0.5 s drops what came after
		world.restore(snap);
		rec.truncateAfter(world.time);
		expect(rec.times.at(-1)).toBeCloseTo(0.5, 5);
		expect([...rec.lanes.values()].some((l) => l.effect === 'test:child')).toBe(false);
		run(30);
		expect([...rec.lanes.values()].filter((l) => l.effect === 'test:child')).toHaveLength(1);
	});
});
