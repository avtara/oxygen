import { describe, expect, it } from 'vitest';
import { extractToVariable, findExpression } from '../src/extract';

describe('findExpression', () => {
	it('matches whole subexpressions only, ignoring spacing and name case', () => {
		expect(findExpression('a(1) + V.Age*2 + v.age * 2', 'v.age*2')).toHaveLength(2);
		// `v.a + v.b` is not a subexpression of `v.a + v.b * 2`
		expect(findExpression('v.a + v.b * 2', 'v.a + v.b')).toEqual([]);
		expect(findExpression('(v.a + v.b) * 2', 'v.a + v.b')).toHaveLength(1);
	});
});

describe('extractToVariable', () => {
	const life = 'math.min(1, v.particle_age / v.particle_lifetime)';
	const xyz = [`math.cos(v.angle) * v.r * ${life}`, 'math.sin(v.t) * 0.2', `math.sin(v.angle) * v.r * ${life}`];

	it('computes it once in X and reuses it in X, Y and Z', () => {
		const r = extractToVariable(xyz, ` ( ${life} ) `, 'v.life');
		if ('error' in r) throw new Error(r.error);
		expect(r.occurrences).toBe(2);
		expect(r.texts).toEqual([`v.life = ${life}; return math.cos(v.angle) * v.r * v.life;`, 'math.sin(v.t) * 0.2', 'math.sin(v.angle) * v.r * v.life']);
	});

	it('inserts before the statement that first uses it in a multi-statement X', () => {
		const x = 'v.angle = v.i * 10; v.k = math.cos(v.angle) * 2; return v.k;';
		const r = extractToVariable([x, 'math.cos(v.angle) * 3'], 'math.cos(v.angle)', 'v.c');
		if ('error' in r) throw new Error(r.error);
		expect(r.texts).toEqual(['v.angle = v.i * 10; v.c = math.cos(v.angle); v.k = v.c * 2; return v.k;', 'v.c * 3']);
	});

	it('refuses what X cannot compute yet, and non-expressions', () => {
		const r = extractToVariable(['1', 't.k = 2; return t.k * 3;'], 't.k * 3', 'v.x');
		expect('error' in r && r.error).toMatch(/t\.k is set later/);
		expect('error' in extractToVariable(['v.a = 1;'], 'v.a = 1', 'v.x')).toBe(true);
		expect('error' in extractToVariable(['v.a + 1'], 'v.a', 'v.x')).toBe(true);
	});
});

describe('moveStatements', () => {
	it('moves whole statements to the end of another field', async () => {
		const { moveStatements } = await import('../src/extract');
		const r = moveStatements('v.a = 1; v.b = v.a * 2; v.c = 3;', 'v.b = v.a*2;', 'v.x = 0;');
		expect(r).toEqual({ from: 'v.a = 1; v.c = 3;', to: 'v.x = 0; v.b = v.a * 2;', moved: 1 });
		expect(moveStatements('v.a = 1;', 'v.a = 1', '')).toEqual({ from: '', to: 'v.a = 1;', moved: 1 });
	});
	it('refuses partial statements and return', async () => {
		const { moveStatements } = await import('../src/extract');
		expect('error' in moveStatements('v.a = 1 + 2;', '1 + 2', '')).toBe(true);
		expect('error' in moveStatements('v.a = 1; return v.a;', 'return v.a;', '')).toBe(true);
		expect('error' in moveStatements('v.aa = 1;', 'a = 1;', '')).toBe(true);
	});
});
