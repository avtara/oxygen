import { featuresForVersion } from 'molangjs';
import { describe, expect, it } from 'vitest';
import { applyEdits, quickFixes } from '../src/fixes';
import { diagnose, type LangDiagnostic, type MolangContext } from '../src/service';

function fixed(src: string, code: string, ctx: MolangContext = {}, pick = 0): string[] {
	const d = diagnose(src, ctx).find((x) => x.code === code);
	expect(d, `expected a ${code} diagnostic for ${src}`).toBeDefined();
	const fixes = quickFixes(src, d!, ctx);
	return pick < 0 ? fixes.map((f) => applyEdits(src, f.edits)) : [applyEdits(src, fixes[pick].edits)];
}

describe('quick fixes', () => {
	it('suggest the closest query or math function for a misspelling', () => {
		expect(fixed('q.anim_tme * 2', 'unknown-query', {}, -1)).toContain('q.anim_time * 2');
		expect(fixed('query.postion(1)', 'unknown-query', {}, -1)[0]).toBe('query.position(1)');
		expect(fixed('math.lerpp(0, 1, 0.5)', 'unknown-function', {}, -1)).toContain('math.lerp(0, 1, 0.5)');
	});

	it('return the last value, or spell out the 0.0 the game returns', () => {
		const ctx = { expectsValue: true };
		expect(fixed('v.a = 2; v.a * 3', 'missing-return', ctx)).toEqual(['v.a = 2; return v.a * 3']);
		expect(fixed('v.a = 2; ( v.a + 1 )', 'missing-return', ctx)).toEqual(['v.a = 2; return ( v.a + 1 )']);
		expect(fixed('v.a = 2; v.b = 3;', 'missing-return', ctx)).toEqual(['v.a = 2; v.b = 3; return 0;']);
	});

	it('parenthesize nested ternaries the way the pack version already reads them', () => {
		expect(fixed('v.a ? 1 : v.b ? 2 : 3', 'ternary-assoc')).toEqual(['v.a ? 1 : (v.b ? 2 : 3)']);
		const old = { features: featuresForVersion(0) };
		const src = 'v.a ? 1 : v.b ? 2 : 3';
		const d = diagnose(src, old).find((x) => x.code === 'ternary-assoc') as LangDiagnostic;
		const out = quickFixes(src, d, old).map((f) => applyEdits(src, f.edits));
		expect(out).toEqual(['(v.a ? 1 : v.b) ? 2 : 3']);
	});

	it('parenthesize mixed && and ||', () => {
		expect(fixed('v.a && v.b || v.c', 'mixed-logic')).toEqual(['(v.a && v.b) || v.c']);
	});

	it('guard a variable that may be unset', () => {
		const src = 'v.count + 1';
		const d: LangDiagnostic = { from: 0, to: 7, severity: 'error', code: 'never-set', message: '' };
		expect(quickFixes(src, d).map((f) => applyEdits(src, f.edits))).toEqual(['(v.count ?? 0) + 1']);
	});
});

describe('folding', () => {
	it('folds what a line opens and closes further down, skipping strings', async () => {
		const { EditorState } = await import('@codemirror/state');
		const { foldable } = await import('@codemirror/language');
		const { molang } = await import('../src/index');
		const doc = "math.min(\n  1,\n  math.max(0, ')')\n) + loop(3, {\n  t.i = 1;\n});";
		const state = EditorState.create({ doc, extensions: [molang()] });
		const at = (n: number) => {
			const l = state.doc.line(n);
			const f = foldable(state, l.from, l.to);
			return f ? state.sliceDoc(f.from, f.to).replace(/\n/g, '⏎') : null;
		};
		expect(at(1)).toBe("⏎  1,⏎  math.max(0, ')')⏎");
		expect(at(3)).toBeNull();
		expect(at(4)).toBe('⏎  t.i = 1;⏎');
	});
});
