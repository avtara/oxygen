import { describe, expect, it } from 'vitest';
import { ParticleWorld } from 'wintersky';
import { PreviewQueries } from '../src/lib/queries';

const fx = {
	format_version: '1.10.0',
	particle_effect: {
		description: { identifier: 'test:cam', basic_render_parameters: { material: 'particles_alpha', texture: 't' } },
		components: {
			'minecraft:emitter_rate_instant': { num_particles: 1 },
			'minecraft:emitter_lifetime_once': { active_time: 1 },
			'minecraft:particle_lifetime_expression': { max_lifetime: 1 },
			'minecraft:particle_appearance_billboard': { size: [0.1, 0.1], facing_camera_mode: 'lookat_xyz' },
		},
	},
};

describe('preview camera queries (measured in 1.26.52, t60-t64)', () => {
	const setup = (context: 'command' | 'entity') => {
		const world = new ParticleWorld();
		const q = new PreviewQueries({ override: () => undefined, timeOfDay: () => 0, lastDelta: () => 1 / 60, entity: () => null });
		world.queries = q;
		const e = world.spawn(world.loadEffect(fx), { position: [0, 0, 0], context });
		// camera 8 blocks west (-x), looking east
		world.camera = { ...world.camera, position: [-8, 0, 0], forward: [1, 0, 0], right: [0, 0, 1], up: [0, 1, 0] };
		const ask = (name: string, ...args: number[]) => q.resolve(name, args, { world, emitter: e, particle: -1, spawnContext: context } as never);
		return ask;
	};

	it('/particle and script spawns: rotation queries are constants, distance follows the camera', () => {
		const ask = setup('command');
		expect(ask('query.camera_rotation', 0)).toBe(0);
		expect(ask('query.camera_rotation', 1)).toBe(0);
		expect(ask('query.rotation_to_camera', 0)).toBe(0);
		expect(ask('query.rotation_to_camera', 1)).toBe(-90);
		expect(ask('query.distance_from_camera')).toBeCloseTo(8);
		expect(ask('query.camera_distance_range_lerp', 0, 20)).toBeCloseTo(0.4);
	});

	it('entity-attached effects keep the live camera (not measured: documented behaviour)', () => {
		const ask = setup('entity');
		expect(ask('query.camera_rotation', 1)).toBeCloseTo(-90);
		expect(ask('query.rotation_to_camera', 1)).toBeCloseTo(90);
	});
});
