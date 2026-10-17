<script lang="ts">
	import { json } from '@codemirror/lang-json';
	import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
	import { Annotation, EditorState } from '@codemirror/state';
	import { EditorView, keymap, lineNumbers } from '@codemirror/view';
	import { defaultKeymap } from '@codemirror/commands';
	import { tags } from '@lezer/highlight';
	import { molangTheme } from '@oxygen/lang';
	import { onDestroy, onMount } from 'svelte';
	import type { Workspace } from '../../state/workspace.svelte';

	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();
	const session = $derived(workspace.active);
	const External = Annotation.define<boolean>();
	let host: HTMLDivElement;
	let view: EditorView | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let boundTo: string | null = null;

	const style = HighlightStyle.define([
		{ tag: tags.propertyName, color: 'var(--ox-syn-variable)' },
		{ tag: tags.string, color: 'var(--ox-syn-string)' },
		{ tag: tags.number, color: 'var(--ox-syn-number)' },
		{ tag: [tags.bool, tags.null], color: 'var(--ox-syn-keyword)' },
		{ tag: tags.punctuation, color: 'var(--ox-haze)' },
	]);

	function commit() {
		timer = null;
		if (!view || !session) return;
		session.doc.setText(view.state.doc.toString(), 'edit', 'Edit source');
	}

	onMount(() => {
		view = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: session?.doc.text ?? '',
				extensions: [
					json(),
					lineNumbers(),
					syntaxHighlighting(style),
					molangTheme,
					keymap.of(defaultKeymap),
					EditorView.contentAttributes.of({ 'aria-label': 'File source' }),
					EditorView.updateListener.of((u) => {
						if (!u.docChanged || u.transactions.some((t) => t.annotation(External))) return;
						if (timer) clearTimeout(timer);
						timer = setTimeout(commit, 300);
					}),
				],
			}),
		});
	});

	// mirror the document (other editors, undo) without moving the cursor more than needed
	$effect(() => {
		const s = session;
		void s?.version;
		if (!view) return;
		const text = s?.doc.text ?? '';
		const switched = boundTo !== (s?.id ?? null);
		boundTo = s?.id ?? null;
		if (timer && !switched) return;
		const cur = view.state.doc.toString();
		if (cur === text) return;
		let from = 0;
		while (from < cur.length && from < text.length && cur[from] === text[from]) from++;
		let endA = cur.length, endB = text.length;
		while (endA > from && endB > from && cur[endA - 1] === text[endB - 1]) {
			endA--;
			endB--;
		}
		view.dispatch({ changes: { from, to: endA, insert: text.slice(from, endB) }, annotations: External.of(true) });
	});

	onDestroy(() => {
		if (timer) commit();
		view?.destroy();
	});
</script>

<div class="source" bind:this={host}></div>

<style>
	.source {
		height: 100%;
		overflow: hidden;
	}
	.source :global(.cm-editor) {
		height: 100%;
	}
	.source :global(.cm-scroller) {
		overflow: auto;
	}
	.source :global(.cm-gutters) {
		color: var(--ox-text-dim);
	}
</style>
