import { analyzeEffect, type EffectAnalysis, type FieldRef } from '@oxygen/effect';
import { classify, complete, hoverAt, quickFixes, type LangDiagnostic, type MolangContext, type TokenClass } from '@oxygen/lang';
import { queryExists } from '@oxygen/metadata';
import { findNodeAtLocation, findNodeAtOffset, getNodePath, parseTree, type Node } from 'jsonc-parser';
import * as vscode from 'vscode';
import { ParticleWorld } from 'wintersky';
import { isParticleDocument, type PackIndex } from './pack';

interface Analysed {
	version: number;
	tree: Node | undefined;
	analysis: EffectAnalysis | null;
}

/** Map an index in a JSON string's decoded value to an offset in its raw literal (after the opening quote) */
function rawIndex(raw: string, valueIndex: number): number {
	let v = 0;
	let i = 1; // skip the opening quote
	while (i < raw.length - 1 && v < valueIndex) {
		if (raw[i] === '\\') i += raw[i + 1] === 'u' ? 6 : 2;
		else i++;
		v++;
	}
	return i;
}

function segments(path: string, tree: Node): (string | number)[] {
	const out: (string | number)[] = [];
	let node: Node | undefined = tree;
	for (const raw of path.split('/')) {
		const s = raw.replace(/~1/g, '/').replace(/~0/g, '~');
		const seg: string | number = /^\d+$/.test(s) && node?.type === 'array' ? Number(s) : s;
		out.push(seg);
		node = node ? findNodeAtLocation(node, [seg]) : undefined;
	}
	return out;
}

/** The JSON string node holding a field's Molang (the `expression` member for {expression, version}) */
function molangNode(tree: Node, path: string): Node | undefined {
	const clean = path.replace(/#\d+$/, '');
	let node = findNodeAtLocation(tree, segments(clean, tree));
	if (node?.type === 'object') node = findNodeAtLocation(node, ['expression']);
	return node;
}

const TOKEN_TYPES = ['variable', 'parameter', 'property', 'function', 'number', 'string', 'keyword', 'operator'];
const TOKEN_MODIFIERS = ['readonly', 'defaultLibrary'];
export const legend = new vscode.SemanticTokensLegend(TOKEN_TYPES, TOKEN_MODIFIERS);
const CLASS_TOKEN: Partial<Record<TokenClass, [string, number]>> = {
	variable: ['variable', 0],
	builtin: ['variable', 1],
	temp: ['parameter', 0],
	context: ['property', 0],
	query: ['function', 0],
	math: ['function', 2],
	number: ['number', 0],
	string: ['string', 0],
	keyword: ['keyword', 0],
	operator: ['operator', 0],
};

/**
 * Molang language features for particle JSON opened as text: diagnostics phrased as what the game does,
 * semantic coloring of expressions, completion and hover inside Molang strings.
 */
export class ParticleLanguage implements vscode.Disposable {
	private cache = new Map<string, Analysed>();
	private diagnostics = vscode.languages.createDiagnosticCollection('oxygen');
	private timers = new Map<string, ReturnType<typeof setTimeout>>();
	private disposables: vscode.Disposable[] = [];

	constructor(private pack: PackIndex) {
		const selector: vscode.DocumentSelector = [
			{ language: 'json', scheme: 'file' },
			{ language: 'jsonc', scheme: 'file' },
			{ language: 'json', scheme: 'untitled' },
		];
		this.disposables.push(
			this.diagnostics,
			vscode.workspace.onDidOpenTextDocument((d) => this.schedule(d)),
			vscode.workspace.onDidChangeTextDocument((e) => this.schedule(e.document)),
			vscode.workspace.onDidCloseTextDocument((d) => {
				this.diagnostics.delete(d.uri);
				this.cache.delete(d.uri.toString());
			}),
			vscode.languages.registerDocumentSemanticTokensProvider(selector, { provideDocumentSemanticTokens: (d) => this.tokens(d) }, legend),
			vscode.languages.registerCompletionItemProvider(selector, { provideCompletionItems: (d, p) => this.completions(d, p) }, '.', '('),
			vscode.languages.registerHoverProvider(selector, { provideHover: (d, p) => this.hover(d, p) }),
			vscode.languages.registerCodeActionsProvider(selector, { provideCodeActions: (d, r, c) => this.codeActions(d, r, c) }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
		);
		for (const d of vscode.workspace.textDocuments) this.schedule(d);
	}

	dispose(): void {
		for (const d of this.disposables) d.dispose();
	}

	private schedule(doc: vscode.TextDocument) {
		if (!isParticleDocument(doc)) return;
		const key = doc.uri.toString();
		clearTimeout(this.timers.get(key));
		this.timers.set(
			key,
			setTimeout(() => void this.publish(doc), 250),
		);
	}

	private async analyse(doc: vscode.TextDocument): Promise<Analysed> {
		const key = doc.uri.toString();
		const hit = this.cache.get(key);
		if (hit && hit.version === doc.version) return hit;
		const text = doc.getText();
		const tree = parseTree(text, [], { allowTrailingComma: true });
		let analysis: EffectAnalysis | null = null;
		try {
			const engine = await this.pack.engine(doc.uri);
			const world = new ParticleWorld({ engine, queryExists });
			const def = world.loadEffect(tree ? jsonValue(tree) : null);
			const parents = def.identifier ? await this.pack.parentInputs(doc.uri, def.identifier) : {};
			analysis = analyzeEffect(def, { cap: 1000, spawnContext: 'command', parents });
		} catch {
			analysis = null;
		}
		const out = { version: doc.version, tree, analysis };
		this.cache.set(key, out);
		return out;
	}

	private async publish(doc: vscode.TextDocument) {
		if (!vscode.workspace.getConfiguration('oxygen').get('diagnostics.enabled', true)) return;
		const { tree, analysis } = await this.analyse(doc);
		if (!tree || !analysis) {
			this.diagnostics.set(doc.uri, []);
			return;
		}
		const list: vscode.Diagnostic[] = [];
		for (const p of analysis.problems) {
			if (p.source === 'schema') continue;
			let range: vscode.Range | null = null;
			const node = p.path ? molangNode(tree, p.path) : undefined;
			if (node) {
				if (node.type === 'string' && p.from !== undefined) {
					const raw = doc.getText(new vscode.Range(doc.positionAt(node.offset), doc.positionAt(node.offset + node.length)));
					const a = node.offset + rawIndex(raw, p.from);
					const b = node.offset + rawIndex(raw, Math.max(p.to ?? p.from + 1, p.from + 1));
					range = new vscode.Range(doc.positionAt(a), doc.positionAt(b));
				} else range = new vscode.Range(doc.positionAt(node.offset), doc.positionAt(node.offset + node.length));
			}
			range ??= new vscode.Range(0, 0, 0, 1);
			const sev = p.severity === 'error' ? vscode.DiagnosticSeverity.Error : p.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information;
			const d = new vscode.Diagnostic(range, p.message, sev);
			d.source = 'Oxygen';
			d.code = p.code;
			list.push(d);
		}
		this.diagnostics.set(doc.uri, list);
	}

	/** The Molang field under a position: its string node, field info and the index inside the value */
	private async fieldAt(doc: vscode.TextDocument, pos: vscode.Position): Promise<{ node: Node; ref: FieldRef; index: number; value: string; analysis: EffectAnalysis } | null> {
		const { tree, analysis } = await this.analyse(doc);
		if (!tree || !analysis) return null;
		const offset = doc.offsetAt(pos);
		const node = findNodeAtOffset(tree, offset, false);
		if (!node || node.type !== 'string') return null;
		const path = getNodePath(node);
		let p = path.map((s) => String(s).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
		if (p.endsWith('/expression')) p = p.slice(0, -'/expression'.length);
		const ref = analysis.byPath.get(p);
		if (!ref) return null;
		const raw = doc.getText(new vscode.Range(doc.positionAt(node.offset), doc.positionAt(node.offset + node.length)));
		let index = 0;
		while (index < (node.value as string).length && node.offset + rawIndex(raw, index + 1) <= offset) index++;
		return { node, ref, index, value: node.value as string, analysis };
	}

	private context(analysis: EffectAnalysis, ref: FieldRef): MolangContext {
		return { phase: ref.phase, expectsValue: ref.expectsValue, fallback: ref.fallback, variables: () => analysis.variables, temps: () => analysis.temps };
	}

	private async completions(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.CompletionItem[] | undefined> {
		if (!isParticleDocument(doc)) return undefined;
		const f = await this.fieldAt(doc, pos);
		if (!f) return undefined;
		const r = complete(f.value, f.index, this.context(f.analysis, f.ref), true);
		if (!r) return undefined;
		const raw = doc.getText(new vscode.Range(doc.positionAt(f.node.offset), doc.positionAt(f.node.offset + f.node.length)));
		const range = new vscode.Range(doc.positionAt(f.node.offset + rawIndex(raw, r.from)), doc.positionAt(f.node.offset + rawIndex(raw, r.to)));
		const KIND: Record<string, vscode.CompletionItemKind> = {
			variable: vscode.CompletionItemKind.Variable,
			function: vscode.CompletionItemKind.Function,
			keyword: vscode.CompletionItemKind.Keyword,
			namespace: vscode.CompletionItemKind.Module,
			constant: vscode.CompletionItemKind.Constant,
			property: vscode.CompletionItemKind.Property,
			snippet: vscode.CompletionItemKind.Snippet,
		};
		return r.items.map((i) => {
			const item = new vscode.CompletionItem(i.label, KIND[i.type]);
			// inside a JSON string: snippets stay on one line
			item.insertText = i.snippet ? new vscode.SnippetString(i.snippet.replace(/\n\s*/g, ' ')) : (i.apply ?? i.label);
			item.detail = i.detail;
			item.documentation = i.info;
			item.range = range;
			item.sortText = String(9 - (i.boost ?? 0)) + i.label;
			if (i.label.endsWith('.')) item.command = { command: 'editor.action.triggerSuggest', title: 'Suggest' };
			return item;
		});
	}

	/** Quick fixes for Oxygen's diagnostics, as edits inside the Molang string */
	private async codeActions(doc: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): Promise<vscode.CodeAction[]> {
		const out: vscode.CodeAction[] = [];
		for (const diag of context.diagnostics) {
			if (diag.source !== 'Oxygen' || typeof diag.code !== 'string') continue;
			const start = await this.fieldAt(doc, diag.range.start);
			const end = await this.fieldAt(doc, diag.range.end);
			if (!start || !end || start.node !== end.node) continue;
			const d: LangDiagnostic = { from: start.index, to: Math.max(end.index, start.index + 1), severity: 'error', code: diag.code, message: diag.message };
			const raw = doc.getText(new vscode.Range(doc.positionAt(start.node.offset), doc.positionAt(start.node.offset + start.node.length)));
			for (const fix of quickFixes(start.value, d, this.context(start.analysis, start.ref))) {
				const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
				action.diagnostics = [diag];
				action.edit = new vscode.WorkspaceEdit();
				for (const e of fix.edits) {
					const range = new vscode.Range(doc.positionAt(start.node.offset + rawIndex(raw, e.from)), doc.positionAt(start.node.offset + rawIndex(raw, e.to)));
					// the edit lands inside a JSON string
					action.edit.replace(doc.uri, range, e.insert.replace(/["\\]/g, (c) => `\\${c}`));
				}
				out.push(action);
			}
		}
		return out;
	}

	private async hover(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.Hover | undefined> {
		try {
			return await this.hoverInner(doc, pos);
		} catch (e) {
			console.error('Oxygen hover failed', e);
			return undefined;
		}
	}

	private async hoverInner(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.Hover | undefined> {
		if (!isParticleDocument(doc)) return undefined;
		const f = await this.fieldAt(doc, pos);
		if (!f) return undefined;
		const h = hoverAt(f.value, f.index, this.context(f.analysis, f.ref));
		const md = new vscode.MarkdownString();
		// escape Markdown syntax but keep spaces readable (appendText turns them into &nbsp;)
		const text = (s: string) => md.appendMarkdown(s.replace(/[\\`*_{}[\]<>#|]/g, (c) => `\\${c}`).replace(/\n/g, '  \n'));
		if (h) {
			md.appendCodeblock(h.signature ?? h.title, 'molang');
			text(h.body);
		} else {
			text(`${f.ref.label}: runs in ${f.ref.phase === 'event' ? 'an event' : `the ${f.ref.phase} phase`}`);
		}
		return new vscode.Hover(md);
	}

	private async tokens(doc: vscode.TextDocument): Promise<vscode.SemanticTokens | undefined> {
		if (!isParticleDocument(doc) || !vscode.workspace.getConfiguration('oxygen').get('semanticHighlighting.enabled', true)) return undefined;
		const { tree, analysis } = await this.analyse(doc);
		if (!tree || !analysis) return undefined;
		const builder = new vscode.SemanticTokensBuilder(legend);
		const spans: { offset: number; length: number; type: number; mods: number }[] = [];
		for (const ref of analysis.fields) {
			const node = molangNode(tree, ref.path);
			if (!node || node.type !== 'string') continue;
			const raw = doc.getText(new vscode.Range(doc.positionAt(node.offset), doc.positionAt(node.offset + node.length)));
			for (const t of classify(node.value as string)) {
				const m = CLASS_TOKEN[t.cls];
				if (!m) continue;
				const a = node.offset + rawIndex(raw, t.from);
				const b = node.offset + rawIndex(raw, t.to);
				spans.push({ offset: a, length: b - a, type: TOKEN_TYPES.indexOf(m[0]), mods: m[1] });
			}
		}
		spans.sort((x, y) => x.offset - y.offset);
		for (const s of spans) {
			const start = doc.positionAt(s.offset);
			const end = doc.positionAt(s.offset + s.length);
			if (start.line !== end.line) continue;
			builder.push(start.line, start.character, s.length, s.type, s.mods);
		}
		return builder.build();
	}
}

function jsonValue(node: Node): unknown {
	switch (node.type) {
		case 'object': {
			const o: Record<string, unknown> = {};
			for (const p of node.children ?? []) if (p.children?.[0] && p.children[1]) o[p.children[0].value as string] = jsonValue(p.children[1]);
			return o;
		}
		case 'array':
			return (node.children ?? []).map(jsonValue);
		default:
			return node.value;
	}
}
