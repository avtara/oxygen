import { describe, expect, it } from 'vitest';
import { assignedVariables, parentInputsFor, spawnsOf } from '../src/spawns';

const fx = (id: string, events: Record<string, unknown>) => ({ format_version: '1.10.0', particle_effect: { description: { identifier: id }, components: {}, events } });

describe('spawn index', () => {
	it('finds spawns in sequences and random options, with what their pre-effects set', () => {
		const s = spawnsOf(
			fx('a:rocket', {
				burst: {
					sequence: [
						{ expression: 't.h = v.hue;' },
						{ particle_effect: { effect: 'a:spark', pre_effect_expression: 'v.hue = t.h; V.Size = 2; v.same == 1;' } },
						{ randomize: [{ weight: 1, particle_effect: { effect: 'a:smoke', pre_effect_expression: { expression: 'variable.dark = 1;', version: 12 } } }, { weight: 1 }] },
					],
				},
				plain: { particle_effect: { effect: 'a:spark' } },
			}),
		)!;
		expect(s.identifier).toBe('a:rocket');
		expect(s.spawns).toEqual([
			{ effect: 'a:spark', sets: ['variable.hue', 'variable.size'] },
			{ effect: 'a:smoke', sets: ['variable.dark'] },
			{ effect: 'a:spark', sets: [] },
		]);
		expect(spawnsOf({ nope: true })).toBeNull();
		expect(assignedVariables('v.a=1;v.b==2;variable.C = 3')).toEqual(['variable.a', 'variable.c']);
	});

	it('merges every parent that sets a variable for a child', () => {
		const index = [
			spawnsOf(fx('a:rocket', { e: { particle_effect: { effect: 'a:spark', pre_effect_expression: 'v.hue = 1;' } } }))!,
			spawnsOf(fx('a:fountain', { e: { particle_effect: { effect: 'a:spark', pre_effect_expression: 'v.hue = 0.3; v.speed = 2;' } } }))!,
		];
		expect(parentInputsFor(index, 'a:spark')).toEqual({ 'variable.hue': 'a:rocket, a:fountain', 'variable.speed': 'a:fountain' });
		expect(parentInputsFor(index, 'a:other')).toEqual({});
	});
});
