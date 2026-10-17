import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { LATEST_FEATURES, parse, walk, type MolangFeatures, type Node } from 'molangjs';
import { stripComments } from './service';

/** Values recorded for one evaluation: AST node id → values (loops record several) */
export type LensValues = Map<number, unknown[]>;

export interface LensData {
	values: LensValues;
	result: unknown;
	features?: MolangFeatures;
}

/** Push new traced values into an editor (null hides the lenses) */
export const setLenses = StateEffect.define<LensData | null>();

function show(v: unknown): string {
	if (typeof v === 'number') {
		if (Number.isNaN(v)) return 'NaN';
		if (!Number.isFinite(v)) return v > 0 ? '∞' : '-∞';
		return String(Math.round(v * 1000) / 1000);
	}
	if (typeof v === 'string') return `'${v}'`;
	return String(v);
}

class LensWidget extends WidgetType {
	constructor(
		readonly text: string,
		readonly kind: 'value' | 'result',
	) {
		super();
	}
	override eq(other: LensWidget): boolean {
		return other.text === this.text && other.kind === this.kind;
	}
	override toDOM(): HTMLElement {
		const el = document.createElement('span');
		el.className = `cm-mo-lens cm-mo-lens-${this.kind}`;
		el.textContent = this.text;
		el.setAttribute('aria-hidden', 'true');
		return el;
	}
	override ignoreEvent(): boolean {
		return true;
	}
}

/** Which nodes get a lens: reads of names, calls, and assignments (shown after the target) */
function lensPoints(src: string, features: MolangFeatures | undefined): { id: number; at: number }[] {
	const { program } = parse(stripComments(src), { features: features ?? LATEST_FEATURES });
	const out: { id: number; at: number }[] = [];
	const targets = new Set<number>();
	walk(program, (n: Node) => {
		if (n.type === 'Assign') {
			targets.add(n.target.id);
			out.push({ id: n.id, at: n.target.end });
		} else if (n.type === 'Name' && !targets.has(n.id) && (n.ns === 'variable' || n.ns === 'temp' || n.ns === 'context')) out.push({ id: n.id, at: n.end });
		else if (n.type === 'Call' && (n.callee.ns === 'query' || n.callee.ns === 'math')) {
			out.push({ id: n.id, at: n.end });
			return false; // the call's own value is enough; skip its arguments' callee
		}
	});
	return out;
}

function build(src: string, data: LensData | null): DecorationSet {
	if (!data) return Decoration.none;
	const ranges = [];
	try {
		for (const p of lensPoints(src, data.features)) {
			const vals = data.values.get(p.id);
			if (!vals || !vals.length) continue;
			const text = vals.length > 1 ? `${show(vals[0])}…${show(vals[vals.length - 1])}` : show(vals[0]);
			ranges.push(Decoration.widget({ widget: new LensWidget(text, 'value'), side: 1 }).range(p.at));
		}
	} catch {
		return Decoration.none;
	}
	ranges.push(Decoration.widget({ widget: new LensWidget(`→ ${show(data.result)}`, 'result'), side: 1 }).range(src.length));
	return Decoration.set(ranges, true);
}

const lensState = StateField.define<{ data: LensData | null; deco: DecorationSet }>({
	create: () => ({ data: null, deco: Decoration.none }),
	update(value, tr) {
		let data = value.data;
		for (const e of tr.effects) if (e.is(setLenses)) data = e.value;
		if (data !== value.data) return { data, deco: build(tr.state.doc.toString(), data) };
		// the text changed under the lenses: they no longer describe it
		if (tr.docChanged) return { data: null, deco: Decoration.none };
		return value;
	},
	provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

// one theme for every editor: each EditorView.baseTheme call adds a stylesheet that is never removed
const lensTheme = EditorView.baseTheme({
	'.cm-mo-lens': {
		fontFamily: 'var(--ox-font-ui)',
		fontVariationSettings: "'MONO' 0",
		fontSize: '11px',
		color: 'var(--ox-lox)',
		background: 'rgba(147, 189, 245, 0.1)',
		borderRadius: '3px',
		padding: '0 4px',
		margin: '0 2px 0 3px',
		pointerEvents: 'none',
	},
	'.cm-mo-lens-result': { color: 'var(--ox-frost)', background: 'rgba(223, 229, 240, 0.08)', marginLeft: '8px' },
});

/** Inline values of the inspected particle's last evaluation */
export function valueLenses(): Extension {
	return [lensState, lensTheme];
}
