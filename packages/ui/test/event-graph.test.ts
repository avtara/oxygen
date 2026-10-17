import { describe, expect, it } from 'vitest';
import { ParticleWorld } from 'wintersky';
import { eventGraph } from '../src/lib/event-graph';

const world = new ParticleWorld();
const effect = (id: string, components: Record<string, unknown>, events: Record<string, unknown> = {}) =>
	world.loadEffect({
		format_version: '1.10.0',
		particle_effect: {
			description: { identifier: id, basic_render_parameters: { material: 'particles_alpha', texture: 'textures/particle/particles' } },
			components: { 'minecraft:emitter_rate_instant': { num_particles: 1 }, 'minecraft:emitter_lifetime_once': { active_time: 1 }, ...components },
			events,
		},
	});

describe('event graph', () => {
	const child = effect('test:child', {
		'minecraft:emitter_initialization': { creation_expression: 'v.k = 1;' },
		'minecraft:particle_appearance_billboard': { size: ['v.size', 'v.size ?? 1'], facing_camera_mode: 'rotate_xyz' },
		'minecraft:particle_lifetime_expression': { max_lifetime: 'v.life' },
	});
	const root = effect(
		'test:root',
		{
			'minecraft:emitter_lifetime_events': { creation_event: 'boom', timeline: { '0.5': ['boom', 'gone'] } },
			'minecraft:particle_lifetime_events': { expiration_event: 'pop' },
			'minecraft:particle_initialization': { per_update_expression: 't.left = 2;' },
		},
		{
			boom: {
				sequence: [
					{ expression: 't.size = 3;' },
					{ randomize: [{ weight: 3, expression: 't.maybe = 1;' }, { weight: 1, sound_effect: { event_name: 'random.pop' } }] },
					{ particle_effect: { effect: 'test:child', type: 'emitter_bound', pre_effect_expression: 'v.size = t.size; v.x = t.maybe + t.left + t.never;' } },
				],
			},
			pop: { particle_effect: { effect: 'test:root' } },
			idle: { expression: 'v.a = 1;' },
			missing_child: { particle_effect: { effect: 'test:nowhere' } },
		},
	);
	const graph = eventGraph(root, (id) => (id === 'test:child' ? child : id === 'test:root' ? root : null));
	const card = (id: string) => graph.cards.find((c) => c.id === id)!;

	it('lists triggers in frame order and fires events from them', () => {
		expect(card('fx:test:root').rows.map((r) => r.text)).toEqual(['Emitter created', 'Emitter at 0.5 s', 'Particle expires']);
		const fires = graph.edges.filter((e) => e.kind === 'fires').map((e) => `${e.row}→${e.to}`);
		expect(fires).toEqual(['0→ev:test:root#boom', '1→ev:test:root#boom', '1→ev:test:root#gone', '2→ev:test:root#pop']);
		expect(card('ev:test:root#gone').status).toBe('missing');
		expect(card('ev:test:root#idle').status).toBe('unfired');
		expect(card('ev:test:root#missing_child').status).toBe('unfired');
	});

	it('orders actions the way the game runs them, with sequence steps and random shares', () => {
		expect(card('ev:test:root#boom').rows.map((r) => [r.where, r.kind, r.text])).toEqual([
			['1', 'expression', 't.size = 3;'],
			['2 › 75%', 'expression', 't.maybe = 1;'],
			['2 › 25%', 'sound', 'random.pop'],
			['3', 'spawn', 'test:child'],
		]);
	});

	it('says where the temps a pre-effect reads come from, and what the child still needs', () => {
		const spawn = graph.edges.find((e) => e.from === 'ev:test:root#boom' && e.kind === 'spawns')!;
		expect(spawn.to).toBe('fx:test:child');
		expect(spawn.row).toBe(3);
		expect(spawn.spawnType).toBe('emitter_bound');
		expect(Object.fromEntries(spawn.temps.map((t) => [t.name, t.from]))).toEqual({
			'temp.size': 'event',
			'temp.maybe': 'maybe',
			'temp.left': 'elsewhere',
			'temp.never': 'nowhere',
		});
		// v.size is set by the pre-effect; v.life is read unguarded and never set
		expect(spawn.needs).toEqual(['variable.life']);
	});

	it('draws effects once: self-spawns go back to the existing card, missing effects are marked', () => {
		const self = graph.edges.find((e) => e.from === 'ev:test:root#pop')!;
		expect(self.to).toBe('fx:test:root');
		expect(self.back).toBe(true);
		expect(graph.cards.filter((c) => c.id === 'fx:test:root')).toHaveLength(1);
		expect(card('fx:test:nowhere').status).toBe('missing');
		expect(card('fx:test:child').layer).toBe(2);
	});

	it('follows the measured node rules: spawn before expression, ignored parts, creation spawns at the origin', () => {
		const kid = effect('test:kid', {});
		const fx = effect(
			'test:fx',
			{ 'minecraft:emitter_lifetime_events': { creation_event: ['leaf', 'group'] }, 'minecraft:particle_lifetime_events': { creation_event: 'born' } },
			{
				leaf: { expression: 't.k = 1;', particle_effect: { effect: 'test:kid', pre_effect_expression: 'v.k = t.k;' } },
				group: { sequence: [{ expression: 'v.a = 1;' }], particle_effect: { effect: 'test:kid' }, randomize: [{ weight: 0 }, { weight: 0, expression: 'v.b = 1;' }] },
				born: { particle_effect: { effect: 'test:kid' } },
			},
		);
		const g = eventGraph(fx, (id) => (id === 'test:kid' ? kid : null));
		const rows = (name: string) => g.cards.find((c) => c.id === `ev:test:fx#${name}`)!.rows;
		expect(rows('leaf').map((r) => r.kind)).toEqual(['spawn', 'expression']);
		// the spawn runs first, so its pre-effect gets what an earlier run of the expression left, not this step's
		expect(g.edges.find((e) => e.from === 'ev:test:fx#leaf')!.temps).toEqual([{ name: 'temp.k', from: 'elsewhere' }]);
		const group = rows('group');
		// all weights 0: the first (empty) option always wins, the second never
		expect(group.map((r) => [r.where, r.kind, !!r.ignored])).toEqual([
			['1', 'expression', false],
			['0%', 'expression', false],
			['', 'spawn', true],
		]);
		// ignored spawns draw no edge
		expect(g.edges.filter((e) => e.from === 'ev:test:fx#group')).toHaveLength(0);
		expect(rows('born')[0].warn).toMatch(/world origin/);
	});
	it('lays cards out in layers without overlaps', () => {
		for (const a of graph.cards)
			for (const b of graph.cards) {
				if (a === b || a.layer !== b.layer) continue;
				expect(a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
			}
		expect(Math.max(...graph.cards.map((c) => c.x))).toBeLessThan(graph.width);
	});
});
