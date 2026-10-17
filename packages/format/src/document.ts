import {
	applyEdits,
	findNodeAtLocation,
	findNodeAtOffset,
	getNodeValue,
	getNodePath,
	modify,
	parseTree,
	printParseErrorCode,
	type Edit,
	type FormattingOptions,
	type JSONPath,
	type Node,
	type ParseError,
} from 'jsonc-parser';

export type { Edit, JSONPath, Node };

export interface DocumentFormatting {
	insertSpaces: boolean;
	tabSize: number;
	eol: '\n' | '\r\n';
}

export interface SyntaxProblem {
	message: string;
	offset: number;
	length: number;
}

export type ChangeOrigin = 'edit' | 'undo' | 'redo' | 'external';

export interface DocumentChange {
	/** Text edits relative to the previous text, in application order (non-overlapping, any order) */
	edits: Edit[];
	version: number;
	origin: ChangeOrigin;
	label: string;
}

const NUMBER_LITERAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** Detect the indentation and line endings a file already uses, so edits match it. */
export function detectFormatting(text: string): DocumentFormatting {
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	const m = /\n([ \t]+)\S/.exec(text);
	if (!m) return { insertSpaces: false, tabSize: 4, eol };
	const indent = m[1];
	if (indent.startsWith('\t')) return { insertSpaces: false, tabSize: 4, eol };
	return { insertSpaces: true, tabSize: Math.min(8, indent.length) || 2, eol };
}

/**
 * Parse a slash path (`particle_effect/components/minecraft:x/size/0`) against the tree. Segments are
 * array indices only where the parent is an array, so numeric object keys (gradient stops, curve keys)
 * stay strings. Segments use JSON pointer escapes (`~1` for `/`, `~0` for `~`).
 */
export function parsePath(path: string, root?: Node): JSONPath {
	if (!path) return [];
	const segs = path.replace(/^\//, '').split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
	const out: JSONPath = [];
	let node: Node | undefined = root;
	for (const s of segs) {
		const isIndex = /^\d+$/.test(s) && (node ? node.type === 'array' : false);
		const seg = isIndex ? Number(s) : s;
		out.push(seg);
		node = node ? findNodeAtLocation(node, [seg]) : undefined;
	}
	return out;
}

export function formatPath(path: JSONPath): string {
	return path.map((s) => String(s).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
}

/**
 * A particle JSON file as text. Every change is a surgical text edit (jsonc-parser), so untouched bytes,
 * key order, comments, unknown fields and number formatting never change. Parsing is lenient like the
 * game (comments and trailing commas are accepted).
 */
export class JsonDocument {
	private _text: string;
	private _tree: Node | undefined;
	private _errors: ParseError[] = [];
	private _value: unknown;
	private _valueDirty = true;
	version = 0;
	formatting: DocumentFormatting;
	private listeners = new Set<(change: DocumentChange) => void>();
	private batch: { label: string; before: string } | null = null;
	readonly history = new History();

	constructor(text: string) {
		this._text = text;
		this.formatting = detectFormatting(text);
		this.reparse();
	}

	get text(): string {
		return this._text;
	}

	get tree(): Node | undefined {
		return this._tree;
	}

	/** Parse problems (the game is equally lenient about comments and trailing commas) */
	get problems(): SyntaxProblem[] {
		return this._errors.map((e) => ({ message: printParseErrorCode(e.error), offset: e.offset, length: e.length }));
	}

	/** Plain JS value of the whole document (cached until the next change) */
	get value(): unknown {
		if (this._valueDirty) {
			this._value = this._tree ? getNodeValue(this._tree) : undefined;
			this._valueDirty = false;
		}
		return this._value;
	}

	private reparse() {
		this._errors = [];
		this._tree = parseTree(this._text, this._errors, { allowTrailingComma: true, disallowComments: false, allowEmptyContent: true });
		this._valueDirty = true;
	}

	onChange(fn: (change: DocumentChange) => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private emit(edits: Edit[], origin: ChangeOrigin, label: string) {
		this.version++;
		const change: DocumentChange = { edits, version: this.version, origin, label };
		for (const fn of this.listeners) fn(change);
	}

	resolve(path: string | JSONPath): JSONPath {
		return typeof path === 'string' ? parsePath(path, this._tree) : path;
	}

	node(path: string | JSONPath): Node | undefined {
		return this._tree ? findNodeAtLocation(this._tree, this.resolve(path)) : undefined;
	}

	get(path: string | JSONPath): unknown {
		const n = this.node(path);
		return n ? getNodeValue(n) : undefined;
	}

	has(path: string | JSONPath): boolean {
		return this.node(path) !== undefined;
	}

	/** Source range of a value (for diagnostics and editor mapping) */
	range(path: string | JSONPath): { offset: number; length: number } | null {
		const n = this.node(path);
		return n ? { offset: n.offset, length: n.length } : null;
	}

	/** Range of a property's key (falls back to the value) */
	keyRange(path: string | JSONPath): { offset: number; length: number } | null {
		const n = this.node(path);
		if (!n) return null;
		const prop = n.parent?.type === 'property' ? n.parent.children?.[0] : undefined;
		return prop ? { offset: prop.offset, length: prop.length } : { offset: n.offset, length: n.length };
	}

	pathAt(offset: number): JSONPath | null {
		if (!this._tree) return null;
		const n = findNodeAtOffset(this._tree, offset, true);
		return n ? getNodePath(n) : null;
	}

	private options(insertionIndex?: (keys: string[]) => number): { formattingOptions: FormattingOptions; getInsertionIndex?: (keys: string[]) => number } {
		const f = this.formatting;
		return { formattingOptions: { insertSpaces: f.insertSpaces, tabSize: f.tabSize, eol: f.eol }, getInsertionIndex: insertionIndex };
	}

	/** Group several changes into one undo step and one change event */
	transact<T>(label: string, fn: () => T): T {
		if (this.batch) return fn();
		this.batch = { label, before: this._text };
		try {
			return fn();
		} finally {
			const b = this.batch;
			this.batch = null;
			if (b.before !== this._text) {
				this.history.push({ label: b.label, before: b.before, after: this._text });
				this.emit([minimalEdit(b.before, this._text)], 'edit', b.label);
			}
		}
	}

	/** Apply raw text edits made by this document (internal) or by the host (external) */
	applyEdits(edits: Edit[], origin: ChangeOrigin = 'edit', label = 'Edit'): void {
		if (!edits.length) return;
		const before = this._text;
		this._text = applyEdits(this._text, edits);
		this.reparse();
		if (origin === 'external') {
			this.emit(edits, origin, label);
			return;
		}
		if (this.batch) return; // reported once, as a minimal edit, when the transaction ends
		this.history.push({ label, before, after: this._text });
		this.emit(edits, origin, label);
	}

	/** Replace the whole text (file reloaded, VS Code document changed outside Oxygen) */
	setText(text: string, origin: ChangeOrigin = 'external', label = 'Reload'): void {
		if (text === this._text) return;
		const before = this._text;
		const edit = minimalEdit(before, text);
		this._text = text;
		this.reparse();
		if (origin === 'edit') this.history.push({ label, before, after: text });
		this.emit([edit], origin, label);
	}

	/** Set a value. `order` decides where a new key goes (default: end of the object). */
	set(path: string | JSONPath, value: unknown, label = 'Edit', order?: (keys: string[]) => number): void {
		const p = this.resolve(path);
		const edits = modify(this._text, p, value, this.options(order));
		this.applyEdits(edits, 'edit', label);
	}

	/**
	 * Write a value as literal JSON text where it already exists, so number formatting such as `1.0` survives.
	 * Falls back to `set` with the parsed value when the location is new.
	 */
	setRaw(path: string | JSONPath, json: string, label = 'Edit'): void {
		const n = this.node(path);
		if (n && n.type !== 'object' && n.type !== 'array') {
			if (this._text.slice(n.offset, n.offset + n.length) === json) return;
			this.applyEdits([{ offset: n.offset, length: n.length, content: json }], 'edit', label);
			return;
		}
		this.set(path, JSON.parse(json), label);
	}

	remove(path: string | JSONPath, label = 'Remove'): void {
		const p = this.resolve(path);
		if (!this.node(p)) return;
		const edits = modify(this._text, p, undefined, this.options());
		this.applyEdits(edits, 'edit', label);
	}

	/** Insert into an array at `index` (default: append) */
	insert(path: string | JSONPath, value: unknown, index?: number, label = 'Add'): void {
		const p = this.resolve(path);
		const arr = this.node(p);
		const at = index ?? (arr?.type === 'array' ? (arr.children?.length ?? 0) : 0);
		if (!arr) {
			this.set(p, [value], label);
			return;
		}
		const edits = modify(this._text, [...p, at], value, { ...this.options(), isArrayInsertion: true });
		this.applyEdits(edits, 'edit', label);
	}

	/** Rename an object key in place, keeping its position and value text */
	renameKey(path: string | JSONPath, newKey: string, label = 'Rename'): void {
		const n = this.node(path);
		const key = n?.parent?.type === 'property' ? n.parent.children?.[0] : undefined;
		if (!key) return;
		this.applyEdits([{ offset: key.offset, length: key.length, content: JSON.stringify(newKey) }], 'edit', label);
	}

	/** Write Molang back keeping the file's representation (number, string or {expression, version}) */
	setMolang(path: string | JSONPath, source: string, label = 'Edit expression'): void {
		const p = this.resolve(path);
		const existing = this.get(p);
		const trimmed = source.trim();
		if (existing && typeof existing === 'object' && !Array.isArray(existing) && 'expression' in existing) {
			this.set([...p, 'expression'], source, label);
			return;
		}
		if (NUMBER_LITERAL.test(trimmed) && (existing === undefined || typeof existing === 'number')) {
			this.setRaw(p, trimmed, label);
			return;
		}
		this.set(p, source, label);
	}

	undo(): boolean {
		const step = this.history.undo();
		if (!step) return false;
		this.setText(step.before, 'undo', `Undo ${step.label}`);
		return true;
	}

	redo(): boolean {
		const step = this.history.redo();
		if (!step) return false;
		this.setText(step.after, 'redo', `Redo ${step.label}`);
		return true;
	}
}

/** One replace edit covering the changed middle of two texts */
export function minimalEdit(a: string, b: string): Edit {
	let start = 0;
	const min = Math.min(a.length, b.length);
	while (start < min && a.charCodeAt(start) === b.charCodeAt(start)) start++;
	let endA = a.length, endB = b.length;
	while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
		endA--;
		endB--;
	}
	return { offset: start, length: endA - start, content: b.slice(start, endB) };
}

interface HistoryStep {
	label: string;
	before: string;
	after: string;
	time?: number;
}

/** Text-snapshot undo history. Consecutive edits with the same label within `mergeMs` merge into one step. */
export class History {
	private past: HistoryStep[] = [];
	private future: HistoryStep[] = [];
	limit = 500;
	mergeMs = 800;

	push(step: HistoryStep): void {
		const now = Date.now();
		const last = this.past[this.past.length - 1];
		if (last && last.label === step.label && last.after === step.before && last.time && now - last.time < this.mergeMs) {
			last.after = step.after;
			last.time = now;
		} else {
			this.past.push({ ...step, time: now });
			if (this.past.length > this.limit) this.past.shift();
		}
		this.future.length = 0;
	}

	undo(): HistoryStep | null {
		const s = this.past.pop();
		if (!s) return null;
		this.future.push(s);
		return s;
	}

	redo(): HistoryStep | null {
		const s = this.future.pop();
		if (!s) return null;
		this.past.push(s);
		return s;
	}

	get canUndo(): boolean {
		return this.past.length > 0;
	}

	get canRedo(): boolean {
		return this.future.length > 0;
	}

	/** Break merging so the next edit starts a new step */
	seal(): void {
		const last = this.past[this.past.length - 1];
		if (last) last.time = 0;
	}

	clear(): void {
		this.past.length = 0;
		this.future.length = 0;
	}
}
