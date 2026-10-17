<script lang="ts">
	import type { EffectSession } from '../../state/session.svelte';
	import { joinPath } from '../../lib/molang-text';
	import ListInput from './ListInput.svelte';

	interface Props {
		session: EffectSession;
		path: string;
		label: string;
		/** time/distance: { "<key>": events }, looping: [{ distance, effects }], collision: [{ event, min_speed }] */
		mode: 'time' | 'distance' | 'looping' | 'collision';
	}

	let { session, path, label, mode }: Props = $props();

	const value = $derived.by(() => {
		void session.version;
		return session.doc.get(path);
	});
	const events = $derived([...(session.def?.events.keys() ?? [])]);

	type Row = { key: string; events: string[] };
	const rows = $derived.by((): Row[] => {
		if (mode === 'time' || mode === 'distance') {
			if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
			return Object.entries(value as Record<string, unknown>)
				.map(([k, v]) => ({ key: k, events: Array.isArray(v) ? v.map(String) : typeof v === 'string' ? [v] : [] }))
				.sort((a, b) => parseFloat(a.key) - parseFloat(b.key));
		}
		const list = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
		return list.map((e: Record<string, unknown>) =>
			mode === 'looping'
				? { key: String(e.distance ?? 1), events: Array.isArray(e.effects) ? e.effects.map(String) : typeof e.effects === 'string' ? [e.effects] : [] }
				: { key: String(e.min_speed ?? 2), events: e.event ? [String(e.event)] : [] },
		);
	});

	const unit = $derived(mode === 'time' ? 's' : mode === 'collision' ? 'm/s' : 'blocks');
	const keyLabel = $derived(mode === 'time' ? 'At' : mode === 'collision' ? 'Faster than' : mode === 'looping' ? 'Every' : 'After');

	function write(next: Row[]) {
		if (!next.length) {
			session.doc.remove(path, `Clear ${label}`);
			return;
		}
		if (mode === 'time' || mode === 'distance') {
			const obj: Record<string, unknown> = {};
			for (const r of next) obj[r.key] = r.events.length === 1 ? r.events[0] : r.events;
			session.doc.set(path, obj, `Edit ${label}`);
		} else if (mode === 'looping') session.doc.set(path, next.map((r) => ({ distance: Number(r.key) || 1, effects: r.events })), `Edit ${label}`);
		else session.doc.set(path, next.map((r) => ({ event: r.events[0] ?? '', min_speed: Math.max(2, Number(r.key) || 2) })), `Edit ${label}`);
	}

	function add() {
		const last = rows[rows.length - 1];
		const key = mode === 'collision' ? '2' : last ? String(Number(last.key) + 1) : mode === 'time' ? '0.0' : '1';
		write([...rows, { key, events: [] }]);
	}
</script>

<div class="timeline">
	{#each rows as r, i (i)}
		<div class="row">
			<span class="sub">{keyLabel}</span>
			<input
				class="key ox-num"
				aria-label="{label} {keyLabel}"
				value={r.key}
				onchange={(e) => write(rows.map((x, k) => (k === i ? { ...x, key: e.currentTarget.value } : x)))}
			/>
			<span class="unit">{unit}</span>
			<ListInput items={r.events} label="{label} events" placeholder="event" suggestions={events} onchange={(evs) => write(rows.map((x, k) => (k === i ? { ...x, events: mode === 'collision' ? evs.slice(-1) : evs } : x)))} />
			<button class="icon" aria-label="Remove" onclick={() => write(rows.filter((_, k) => k !== i))}>×</button>
		</div>
	{/each}
	<button class="link" onclick={add}>Add {mode === 'collision' ? 'collision event' : 'entry'}</button>
</div>

<style>
	.timeline {
		display: flex;
		flex-direction: column;
		gap: 3px;
		flex: 1;
		min-width: 0;
	}
	.row {
		display: flex;
		align-items: flex-start;
		gap: 4px;
	}
	.sub,
	.unit {
		color: var(--ox-text-dim);
		line-height: 22px;
		white-space: nowrap;
	}
	.key {
		width: 44px;
		height: 22px;
		background: var(--ox-input);
		border: 1px solid transparent;
		border-radius: var(--ox-radius);
		padding: 0 4px;
		outline: none;
	}
	.key:focus {
		border-color: var(--ox-lox);
	}
	.icon {
		border: none;
		background: none;
		color: var(--ox-haze);
		cursor: pointer;
		width: 20px;
		height: 22px;
	}
	.icon:hover {
		color: var(--ox-frost);
	}
	.link {
		align-self: flex-start;
		border: none;
		background: none;
		color: var(--ox-lox);
		cursor: pointer;
		padding: 0;
	}
	.link:hover {
		text-decoration: underline;
	}
</style>
