<script lang="ts">
	interface Props {
		items: string[];
		label: string;
		placeholder?: string;
		suggestions?: string[];
		onchange: (items: string[]) => void;
	}

	let { items, label, placeholder = 'Add…', suggestions = [], onchange }: Props = $props();
	let draft = $state('');
	const listId = `list-${Math.random().toString(36).slice(2)}`;

	function add() {
		const v = draft.trim();
		if (!v) return;
		draft = '';
		if (!items.includes(v)) onchange([...items, v]);
	}
</script>

<div class="list" role="group" aria-label={label}>
	{#each items as item, i (item + i)}
		<span class="chip ox-code">
			{item}
			<button class="x" aria-label="Remove {item}" onclick={() => onchange(items.filter((_, k) => k !== i))}>×</button>
		</span>
	{/each}
	<input
		class="add"
		{placeholder}
		aria-label="Add to {label}"
		list={suggestions.length ? listId : undefined}
		bind:value={draft}
		onkeydown={(e) => {
			if (e.key === 'Enter') add();
			else if (e.key === 'Backspace' && !draft && items.length) onchange(items.slice(0, -1));
		}}
		onblur={add}
	/>
	{#if suggestions.length}
		<datalist id={listId}>
			{#each suggestions.filter((s) => !items.includes(s)) as s (s)}<option value={s}></option>{/each}
		</datalist>
	{/if}
</div>

<style>
	.list {
		display: flex;
		flex-wrap: wrap;
		gap: 3px;
		flex: 1;
		min-width: 0;
		background: var(--ox-input);
		border: 1px solid transparent;
		border-radius: var(--ox-radius);
		padding: 2px;
		min-height: 22px;
	}
	.list:focus-within {
		border-color: var(--ox-lox);
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		background: var(--ox-raised);
		border-radius: 2px;
		padding: 0 2px 0 6px;
		line-height: 16px;
		font-size: 12px;
	}
	.x {
		border: none;
		background: none;
		color: var(--ox-haze);
		cursor: pointer;
		padding: 0 3px;
		line-height: 16px;
	}
	.x:hover {
		color: var(--ox-frost);
	}
	.add {
		flex: 1;
		min-width: 60px;
		border: none;
		background: none;
		outline: none;
		padding: 0 4px;
		height: 16px;
	}
	.add::placeholder {
		color: var(--ox-text-dim);
	}
</style>
