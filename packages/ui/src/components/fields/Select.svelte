<script lang="ts">
	interface Option {
		value: string;
		label: string;
		help?: string;
	}

	interface Props {
		value: string;
		options: Option[];
		label: string;
		onchange: (value: string) => void;
	}

	let { value, options, label, onchange }: Props = $props();
	const known = $derived(options.some((o) => o.value === value));
</script>

<div class="select">
	<select aria-label={label} {value} onchange={(e) => onchange(e.currentTarget.value)}>
		{#if !known}<option value={value}>{value} (unknown to the game)</option>{/if}
		{#each options as o (o.value)}
			<option value={o.value} title={o.help}>{o.label}</option>
		{/each}
	</select>
	<svg class="chev" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.4" /></svg>
</div>

<style>
	.select {
		position: relative;
		flex: 1;
		min-width: 0;
	}
	select {
		appearance: none;
		width: 100%;
		height: 22px;
		background: var(--ox-input);
		border: 1px solid transparent;
		border-radius: var(--ox-radius);
		padding: 0 22px 0 6px;
		cursor: pointer;
		outline: none;
	}
	select:hover {
		background: var(--ox-input-hover);
	}
	select:focus-visible {
		border-color: var(--ox-lox);
	}
	option {
		background: var(--ox-float);
		color: var(--ox-frost);
	}
	.chev {
		position: absolute;
		right: 7px;
		top: 8px;
		width: 9px;
		height: 6px;
		color: var(--ox-haze);
		pointer-events: none;
	}
</style>
