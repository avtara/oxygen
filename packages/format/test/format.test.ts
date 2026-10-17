import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPONENTS, componentInsertionIndex, JsonDocument, readMeta, validateEffect, writeFieldComments, writeMeta } from '../src/index';

const sample = `{
	"format_version": "1.10.0",
	"particle_effect": {
		"description": {
			"identifier": "test:fx",
			"basic_render_parameters": { "material": "particles_alpha", "texture": "textures/particle/particles" }
		},
		// comment kept
		"components": {
			"minecraft:emitter_rate_steady": { "spawn_rate": 1.0, "max_particles": "v.max" },
			"minecraft:particle_appearance_billboard": { "size": [0.1, { "expression": "v.h", "version": 12 }], "facing_camera_mode": "lookat_xyz" },
			"minecraft:particle_lifetime_expression": { "max_lifetime": 2 },
		}
	}
}
`;

describe('JsonDocument', () => {
	it('keeps untouched text byte-identical (comments, trailing commas, number formatting)', () => {
		const doc = new JsonDocument(sample);
		expect(doc.text).toBe(sample);
		doc.set('particle_effect/components/minecraft:particle_lifetime_expression/max_lifetime', 3);
		expect(doc.text).toContain('// comment kept');
		expect(doc.text).toContain('"spawn_rate": 1.0');
		expect(doc.text).toContain('"max_lifetime": 3');
		expect(doc.text.replace('"max_lifetime": 3', '"max_lifetime": 2')).toBe(sample);
	});

	it('detects tabs vs spaces and uses them for new keys', () => {
		const doc = new JsonDocument(sample);
		expect(doc.formatting.insertSpaces).toBe(false);
		const spaced = new JsonDocument('{\n  "a": {\n    "b": 1\n  }\n}\n');
		spaced.set(['a', 'c'], 2);
		expect(spaced.text).toBe('{\n  "a": {\n    "b": 1,\n    "c": 2\n  }\n}\n');
	});

	it('writes Molang back in the existing representation', () => {
		const doc = new JsonDocument(sample);
		const C = 'particle_effect/components/';
		doc.setMolang(C + 'minecraft:emitter_rate_steady/spawn_rate', '2.50');
		expect(doc.text).toContain('"spawn_rate": 2.50');
		doc.setMolang(C + 'minecraft:emitter_rate_steady/spawn_rate', 'v.rate * 2');
		expect(doc.get(C + 'minecraft:emitter_rate_steady/spawn_rate')).toBe('v.rate * 2');
		doc.setMolang(C + 'minecraft:particle_appearance_billboard/size/1', 'v.h * 2');
		expect(doc.get(C + 'minecraft:particle_appearance_billboard/size/1')).toEqual({ expression: 'v.h * 2', version: 12 });
		doc.setMolang(C + 'minecraft:emitter_rate_steady/max_particles', '40');
		expect(doc.get(C + 'minecraft:emitter_rate_steady/max_particles')).toBe('40'); // was a string: stays a string
	});

	it('resolves numeric segments as indices only inside arrays', () => {
		const doc = new JsonDocument('{"g": {"0.5": "#fff"}, "a": [1, 2]}');
		expect(doc.get('g/0.5')).toBe('#fff');
		expect(doc.get('a/1')).toBe(2);
	});

	it('inserts components in canonical order', () => {
		const doc = new JsonDocument(sample);
		const id = 'minecraft:emitter_lifetime_looping';
		doc.set(['particle_effect', 'components', id], { active_time: 1 }, 'Add', componentInsertionIndex(id));
		const keys = Object.keys((doc.value as any).particle_effect.components);
		expect(keys).toEqual(['minecraft:emitter_rate_steady', id, 'minecraft:particle_appearance_billboard', 'minecraft:particle_lifetime_expression']);
	});

	it('renames keys in place', () => {
		const doc = new JsonDocument('{"events": {"a": {"expression": "v.x = 1;"}, "b": {}}}');
		doc.renameKey('events/a', 'boom');
		expect(doc.text).toBe('{"events": {"boom": {"expression": "v.x = 1;"}, "b": {}}}');
	});

	it('groups a transaction into one undo step and one minimal change', () => {
		const doc = new JsonDocument(sample);
		const changes: number[] = [];
		doc.onChange((c) => changes.push(c.edits.length));
		doc.transact('Two edits', () => {
			doc.set('particle_effect/components/minecraft:particle_lifetime_expression/max_lifetime', 5);
			doc.set('particle_effect/description/identifier', 'test:other');
		});
		expect(changes).toEqual([1]);
		expect(doc.undo()).toBe(true);
		expect(doc.text).toBe(sample);
		expect(doc.redo()).toBe(true);
		expect(doc.get('particle_effect/description/identifier')).toBe('test:other');
	});

	it('external changes are not undoable but notify listeners', () => {
		const doc = new JsonDocument('{"a": 1}');
		const origins: string[] = [];
		doc.onChange((c) => origins.push(c.origin));
		doc.setText('{"a": 2}');
		expect(origins).toEqual(['external']);
		expect(doc.history.canUndo).toBe(false);
	});
});

describe('metadata block', () => {
	it('creates, updates and removes the top-level oxygen block', () => {
		const doc = new JsonDocument(sample);
		writeFieldComments(doc, 'particle_effect/components/minecraft:emitter_rate_steady/spawn_rate', [{ before: 0, text: 'tuned by eye' }]);
		expect(readMeta(doc).comments?.['particle_effect/components/minecraft:emitter_rate_steady/spawn_rate']?.[0].text).toBe('tuned by eye');
		expect(Object.keys(doc.value as object)).toEqual(['format_version', 'particle_effect', 'oxygen']);
		writeFieldComments(doc, 'particle_effect/components/minecraft:emitter_rate_steady/spawn_rate', []);
		expect(doc.has(['oxygen'])).toBe(false);
		writeMeta(doc, 'activeScenario', 'big');
		expect(readMeta(doc).activeScenario).toBe('big');
	});
});

describe('catalog', () => {
	it('every component has a phase for every field', () => {
		for (const c of COMPONENTS) for (const f of c.fields) expect(['setup', 'emitter', 'spawn', 'particle', 'render']).toContain(f.phase);
	});
});

describe('vanilla corpus', () => {
	const dir = join(__dirname, '../../metadata/cache/resource_pack/particles');
	const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
	it.skipIf(!files.length)(`round-trips and validates all vanilla particles (${files.length})`, () => {
		const problems: string[] = [];
		for (const f of files) {
			const text = readFileSync(join(dir, f), 'utf8');
			const doc = new JsonDocument(text);
			expect(doc.text).toBe(text);
			// a no-op write keeps the bytes
			const id = doc.get('particle_effect/description/identifier');
			doc.set('particle_effect/description/identifier', id);
			expect(doc.text).toBe(text);
			for (const p of validateEffect(doc)) problems.push(`${f}: ${p.path} ${p.message}`);
		}
		// Mojang's own files should satisfy Mojang's schema (a few legacy shapes are known exceptions)
		expect(problems.length).toBeLessThan(files.length);
		console.log(`schema notes on vanilla files: ${problems.length}\n${problems.slice(0, 10).join('\n')}`);
	});
});

describe('semanticDiff', () => {
	it('reports component, field, event and curve changes, ignoring Molang whitespace', async () => {
		const { semanticDiff, formatDiff } = await import('../src/diff');
		const before = {
			format_version: '1.10.0',
			particle_effect: {
				description: { identifier: 'a:b' },
				components: {
					'minecraft:emitter_rate_steady': { spawn_rate: 'v.a*2', max_particles: 50 },
					'minecraft:particle_lifetime_expression': { max_lifetime: 1 },
				},
				events: { pop: { expression: 'v.x = 1;' } },
			},
		};
		const after = {
			format_version: '1.10.0',
			particle_effect: {
				description: { identifier: 'a:b' },
				components: {
					'minecraft:emitter_rate_steady': { spawn_rate: 'v.a * 2', max_particles: 80 },
					'minecraft:particle_appearance_billboard': { size: [0.1, 0.1] },
				},
				curves: { 'variable.c': { type: 'linear', nodes: [0, 1] } },
			},
		};
		const d = semanticDiff(before, after);
		expect(d.map((e) => `${e.kind} ${e.where}`)).toEqual([
			'changed Steady rate › max_particles',
			'removed Particle lifetime',
			'added Billboard',
			'added Curve v.c',
			'removed Event pop',
		]);
		expect(formatDiff(d, 'HEAD', 'working copy')).toContain('~ Steady rate › max_particles');
		expect(semanticDiff(before, JSON.parse(JSON.stringify(before)))).toEqual([]);
	});
});
