import type { Scenario } from '@oxygen/format';
import { describe, expect, it } from 'vitest';
import { argText, callSignature, evalInput, evalKeys, scenarioQuery, scenarioVariables, type InputScene } from '../src/lib/inputs';
import { parseNumberText, showNumber } from '../src/lib/numbers';

const scene = (time = 0): InputScene => ({
	time,
	timeOfDay: 0.25,
	entity: { position: [1, 0, 2], velocity: [3, 0, 4], yaw: 90 },
	camera: { position: [0, 0, 10], forward: [0, 0, -1] },
	origin: [0, 0, 0],
});

describe('scenario inputs', () => {
	it('evaluates constants, Molang, keyframes and scene bindings', () => {
		expect(evalInput(2, scene())).toBe(2);
		expect(evalInput('red', scene())).toBe('red');
		expect(evalInput({ molang: 'q.anim_time * 2 + q.time_of_day' }, scene(1.5))).toBe(3.25);
		expect(evalInput({ scene: 'entity.speed' }, scene())).toBe(5);
		expect(evalInput({ scene: 'camera.distance' }, scene())).toBe(10);
		expect(evalInput({ scene: 'time' }, scene(4))).toBe(4);
	});

	it('interpolates keyframes, holds the ends, loops and steps', () => {
		const keys: [number, number][] = [
			[1, 0],
			[0, 10],
			[2, 20],
		];
		expect(evalKeys(keys, -1)).toBe(10);
		expect(evalKeys(keys, 0.5)).toBe(5);
		expect(evalKeys(keys, 1.5)).toBe(10);
		expect(evalKeys(keys, 9)).toBe(20);
		expect(evalKeys(keys, 2.5, true)).toBe(5);
		expect(evalKeys(keys, 0.5, false, true)).toBe(10);
	});

	it('looks queries up by exact call, then by name with a per-argument table', () => {
		const sc: Scenario = {
			name: 's',
			queries: {
				'query.armor_texture_slot(0)': 7,
				'query.armor_texture_slot': { table: { '1': 3, '2': 4 }, fallback: -1 },
				"query.property('ns:mode')": 'angry',
				'query.is_moving': 1,
			},
		};
		expect(scenarioQuery(sc, 'query.armor_texture_slot', [0], scene())).toBe(7);
		expect(scenarioQuery(sc, 'query.armor_texture_slot', [2], scene())).toBe(4);
		expect(scenarioQuery(sc, 'query.armor_texture_slot', [3], scene())).toBe(-1);
		expect(scenarioQuery(sc, 'query.property', ['ns:mode'], scene())).toBe('angry');
		expect(scenarioQuery(sc, 'query.is_moving', [], scene())).toBe(1);
		expect(scenarioQuery(sc, 'query.position', [1], scene())).toBeUndefined();
		expect(scenarioQuery(null, 'query.is_moving', [], scene())).toBeUndefined();
	});

	it('matches arguments that went through float32 emulation', () => {
		expect(argText(Math.fround(0.1))).toBe('0.1');
		expect(callSignature('query.x', [Math.fround(0.1), 'a'])).toBe("query.x(0.1, 'a')");
	});

	it('reads variable drivers once for the spawn', () => {
		const sc: Scenario = { name: 's', variables: { 'v.a': 1, 'v.b': { keys: [[0, 0], [2, 10]] }, 'v.c': 'blue' } };
		expect(scenarioVariables(sc, scene(1))).toEqual({ 'v.a': 1, 'v.b': 5, 'v.c': 'blue' });
	});
});

describe('number fields', () => {
	it('take numbers and arithmetic, and reject anything else', () => {
		expect(parseNumberText(' 2.5 ')).toBe(2.5);
		expect(parseNumberText('1/4')).toBe(0.25);
		expect(parseNumberText('math.pi / 2')).toBeCloseTo(Math.PI / 2);
		expect(parseNumberText('')).toBeNull();
		expect(parseNumberText('abc +')).toBeUndefined();
		expect(parseNumberText('2*(3')).toBeUndefined();
		expect(parseNumberText('v.x')).toBeUndefined();
	});

	it('display without float noise', () => {
		expect(showNumber(0.1 + 0.2)).toBe('0.3');
		expect(showNumber(-0.0000001)).toBe('0');
		expect(showNumber(1.23456, 2)).toBe('1.23');
	});
});
