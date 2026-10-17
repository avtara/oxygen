<script lang="ts">
	import { Annotation, EditorState } from '@codemirror/state';
	import { EditorView, placeholder as cmPlaceholder } from '@codemirror/view';
	import { molang, molangTheme, setMolangContext, type MolangContext } from '@oxygen/lang';
	import { onDestroy, onMount } from 'svelte';

	/** Molang editor for text that isn't a field of the effect (scenario scripts, drivers) */
	interface Props {
		value: string;
		onchange: (text: string) => void;
		label: string;
		multiline?: boolean;
		placeholder?: string;
		context?: MolangContext;
	}

	let { value, onchange, label, multiline = false, placeholder = '', context = {} }: Props = $props();

	const External = Annotation.define<boolean>();
	let host: HTMLDivElement;
	let view: EditorView | null = null;

	function commit() {
		if (!view) return;
		const text = view.state.doc.toString();
		if (text !== value) onchange(text);
	}

	onMount(() => {
		view = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: value,
				extensions: [
					molang({ context, singleLine: !multiline, onCommit: (v) => v.contentDOM.blur() }),
					molangTheme,
					cmPlaceholder(placeholder),
					EditorView.contentAttributes.of({ 'aria-label': label }),
					EditorView.updateListener.of((u) => {
						if (u.focusChanged && !u.view.hasFocus) commit();
					}),
				],
			}),
		});
	});

	$effect(() => {
		const text = value;
		if (!view || view.hasFocus) return;
		const cur = view.state.doc.toString();
		if (cur !== text) view.dispatch({ changes: { from: 0, to: cur.length, insert: text }, annotations: External.of(true) });
	});

	$effect(() => {
		const ctx = context;
		if (view) setMolangContext(view, ctx);
	});

	onDestroy(() => {
		commit();
		view?.destroy();
	});
</script>

<div class="molang" class:multiline bind:this={host}></div>

<style>
	.molang {
		min-width: 0;
		flex: 1;
		background: var(--ox-input);
		border: 1px solid transparent;
		border-radius: var(--ox-radius);
		min-height: 22px;
		cursor: text;
	}
	.molang:hover {
		background: var(--ox-input-hover);
	}
	.molang:focus-within {
		border-color: var(--ox-lox);
		background: var(--ox-input);
	}
	.molang:not(.multiline) :global(.cm-content) {
		padding: 1px 0;
		white-space: pre;
	}
	.molang:not(.multiline) :global(.cm-scroller) {
		overflow-x: auto;
		scrollbar-width: none;
	}
	.molang.multiline {
		min-height: 44px;
	}
	.molang :global(.cm-placeholder) {
		color: var(--ox-text-dim);
		font-style: normal;
	}
</style>
