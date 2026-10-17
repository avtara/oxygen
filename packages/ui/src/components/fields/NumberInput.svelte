<script lang="ts">
	import type { EffectSession } from '../../state/session.svelte';

	interface Props {
		session: EffectSession;
		path: string;
		label: string;
		fallback?: number;
		step?: number;
		min?: number;
		max?: number;
		unit?: string;
	}

	let { session, path, label, fallback = 0, step = 1, min, max, unit }: Props = $props();

	let editing = $state<string | null>(null);
	const value = $derived.by(() => {
		void session.version;
		const v = session.doc.get(path);
		return typeof v === 'number' ? v : null;
	});
	const shown = $derived(editing ?? (value === null ? '' : String(value)));

	function clamp(n: number) {
		if (min !== undefined && n < min) n = min;
		if (max !== undefined && n > max) n = max;
		return n;
	}

	function commit(text: string) {
		editing = null;
		const t = text.trim();
		if (t === '') {
			session.doc.remove(path, `Reset ${label}`);
			return;
		}
		const n = Number(t);
		if (!Number.isFinite(n)) return;
		const out = clamp(n);
		session.doc.setRaw(path, out === n ? t : String(out), `Edit ${label}`);
	}

	function nudge(dir: number, e: KeyboardEvent) {
		const base = value ?? fallback;
		const s = e.shiftKey ? step * 10 : e.altKey ? step / 10 : step;
		const n = clamp(Math.round((base + dir * s) * 1e6) / 1e6);
		session.doc.setRaw(path, String(n), `Edit ${label}`);
	}
</script>

<label class="num">
	<input
		class="ox-num"
		type="text"
		inputmode="decimal"
		aria-label={label}
		value={shown}
		placeholder={String(fallback)}
		oninput={(e) => (editing = e.currentTarget.value)}
		onblur={(e) => commit(e.currentTarget.value)}
		onkeydown={(e) => {
			if (e.key === 'Enter') e.currentTarget.blur();
			else if (e.key === 'Escape') {
				editing = null;
				e.currentTarget.blur();
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				nudge(1, e);
			} else if (e.key === 'ArrowDown') {
				e.preventDefault();
				nudge(-1, e);
			}
		}}
	/>
	{#if unit}<span class="unit">{unit}</span>{/if}
</label>

<style>
	.num {
		display: flex;
		align-items: center;
		flex: 1;
		min-width: 0;
		background: var(--ox-input);
		border: 1px solid transparent;
		border-radius: var(--ox-radius);
		height: 22px;
	}
	.num:hover {
		background: var(--ox-input-hover);
	}
	.num:focus-within {
		border-color: var(--ox-lox);
	}
	input {
		flex: 1;
		min-width: 0;
		border: none;
		background: transparent;
		padding: 0 6px;
		outline: none;
		height: 100%;
	}
	input::placeholder {
		color: var(--ox-text-dim);
	}
	.unit {
		color: var(--ox-text-dim);
		padding-right: 6px;
		white-space: nowrap;
	}
</style>
