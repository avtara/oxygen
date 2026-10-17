<script lang="ts">
	import type { FieldRef } from '@oxygen/effect';
	import { prettyMolang } from '@oxygen/lang';
	import { tick } from 'svelte';
	import type { EffectSession } from '../../state/session.svelte';
	import { molangContextFor } from '../../lib/field-context';
	import { molangText, PHASE_NAME, PHASE_VAR } from '../../lib/molang-text';
	import MolangInput from '../fields/MolangInput.svelte';

	interface Props {
		session: EffectSession;
	}

	let { session }: Props = $props();
	let list: HTMLDivElement;
	let filterInput = $state<HTMLInputElement>();
	// asked to find uses: put the cursor in the filter, after what's there
	let lastRequest = 0;
	$effect(() => {
		const r = session.referencesRequest;
		const input = filterInput;
		if (!r || !input || r.at === lastRequest) return;
		lastRequest = r.at;
		input.focus();
		input.setSelectionRange(input.value.length, input.value.length);
	});

	interface Item {
		key: string;
		refs: FieldRef[];
		step: number | null;
		/** variables this item sets: steps that read them later this frame, and earlier ones that see them next frame */
		flows: { name: string; readers: { ref: FieldRef; step: number | null }[]; nextFrame: { ref: FieldRef; step: number | null }[]; self: boolean }[];
	}

	const AXES = ['X', 'Y', 'Z', 'W'];
	const short = (n: string) => n.replace(/^variable\./, 'v.').replace(/^temp\./, 't.');
	const canon = (n: string) => n.trim().toLowerCase().replace(/^v\./, 'variable.').replace(/^t\./, 'temp.');

	const model = $derived.by(() => {
		void session.version;
		const fields = [...(session.analysis?.fields ?? [])].sort((a, b) => a.rank - b.rank);
		const steps = new Map<string, number>();
		let n = 0;
		for (const f of fields) if (f.rank !== Infinity) steps.set(f.path, ++n);
		const readers = new Map<string, FieldRef[]>();
		for (const f of fields) for (const r of f.analysis?.reads ?? []) if (r.ns === 'variable' || r.ns === 'temp') readers.set(r.name, [...(readers.get(r.name) ?? []).filter((x) => x !== f), f]);
		const items: Item[] = [];
		const used = new Set<string>();
		let group: string | null = null;
		for (const f of fields) {
			// axes of one vector stay together while they run back to back (uv's U and V don't)
			const parent = f.axis !== null ? f.path.replace(/\/\d+$/, '') : null;
			const prev = items[items.length - 1];
			if (parent && prev && group === parent) prev.refs.push(f);
			else {
				let key = parent ?? f.path;
				if (used.has(key)) key = f.path;
				used.add(key);
				items.push({ key, refs: [f], step: steps.get(f.path) ?? null, flows: [] });
			}
			group = parent;
		}
		for (const it of items) {
			const names = new Set<string>();
			for (const ref of it.refs) for (const w of ref.analysis?.writes ?? []) if (w.ns === 'variable' || w.ns === 'temp') names.add(w.name);
			const first = Math.min(...it.refs.map((r) => r.rank));
			const last = Math.max(...it.refs.map((r) => r.rank));
			const step = (ref: FieldRef) => ({ ref, step: steps.get(ref.path) ?? null });
			it.flows = [...names].map((name) => {
				const all = readers.get(name) ?? [];
				return {
					name,
					readers: all.filter((r) => !it.refs.includes(r) && r.rank > last).map(step),
					nextFrame: all.filter((r) => !it.refs.includes(r) && r.rank < first && r.rank !== Infinity).map(step),
					self: all.some((r) => it.refs.includes(r)),
				};
			});
		}
		return items;
	});

	function touches(it: Item, q: string): boolean {
		const c = canon(q);
		if (/^(variable|temp)\./.test(c)) return it.refs.some((r) => [...(r.analysis?.reads ?? []), ...(r.analysis?.writes ?? [])].some((u) => u.name === c || u.name.startsWith(c)));
		const lower = q.toLowerCase();
		return it.refs.some((r) => r.label.toLowerCase().includes(lower) || molangText(session.doc.get(r.path)).toLowerCase().includes(lower));
	}

	const groups = $derived.by(() => {
		const q = session.programFilter.trim();
		const items = q ? model.filter((it) => touches(it, q)) : model;
		const out: { phase: FieldRef['phase'] | 'never'; items: Item[] }[] = [];
		for (const it of items) {
			const phase = it.step === null ? 'never' : it.refs[0].phase;
			const g = out[out.length - 1];
			if (g && g.phase === phase) g.items.push(it);
			else out.push({ phase, items: [it] });
		}
		return out;
	});

	// editors mount when scrolled into view and stay mounted
	let mounted = $state(new Set<string>());
	function lazy(node: HTMLElement, key: string) {
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting) && !mounted.has(key)) {
					mounted = new Set(mounted).add(key);
					io.disconnect();
				}
			},
			{ root: list, rootMargin: '300px 0px' },
		);
		io.observe(node);
		return { destroy: () => io.disconnect() };
	}

	let flash = $state<string | null>(null);
	async function reveal(path: string, select = true) {
		const it = model.find((m) => m.refs.some((r) => r.path === path));
		if (!it) return;
		if (session.programFilter && !groups.some((g) => g.items.includes(it))) session.programFilter = '';
		await tick();
		list?.querySelector(`[data-key="${CSS.escape(it.key)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		flash = it.key;
		setTimeout(() => (flash === it.key ? (flash = null) : null), 900);
		if (select) session.selected = path;
	}

	// follow the selection made elsewhere (Inspector, Problems, Pipeline)
	let lastSelected: string | null = null;
	$effect(() => {
		const sel = session.selected;
		if (!sel || sel === lastSelected) return;
		lastSelected = sel;
		// typing in one of this view's editors selects its field: that's not a reason to scroll or flash
		if (list?.contains(document.activeElement)) return;
		void reveal(sel, false);
	});

	function isSelected(it: Item): boolean {
		const sel = session.selected;
		return !!sel && (it.key === sel || it.refs.some((r) => r.path === sel));
	}
</script>

<div class="program">
	<div class="tools">
		<input bind:this={filterInput} class="ox-code" placeholder="Filter: v.timer, size, math.random…" aria-label="Filter expressions" bind:value={session.programFilter} />
		<span class="dim ox-num">{groups.reduce((n, g) => n + g.items.length, 0)} of {model.length}</span>
	</div>
	<div class="list" bind:this={list}>
		{#each groups as g, gi (gi)}
			<h4 style:--phase={g.phase === 'never' ? 'var(--ox-text-dim)' : PHASE_VAR[g.phase]}>{g.phase === 'never' ? 'Never runs (no event triggers it)' : PHASE_NAME[g.phase]}</h4>
			{#each g.items as it (it.key)}
				{@const first = it.refs[0]}
				<div class="item" class:selected={isSelected(it)} class:flash={flash === it.key} data-key={it.key} style:--phase={PHASE_VAR[first.phase]} use:lazy={it.key}>
					<div class="ihead">
						<span class="step ox-num">{it.step ?? '–'}</span>
						<button class="lbl" onclick={() => (session.selected = first.path)}>{it.refs.length > 1 ? first.label.replace(/ [XYZWRGBAUVH]$/, '') : first.label}</button>
						{#each it.flows as fl (fl.name)}
							<span class="flow">
								sets <span class="ox-code var">{short(fl.name)}</span>
								{#if fl.readers.length}
									<span class="arrow" aria-hidden="true">→</span>
									{#each fl.readers.slice(0, 4) as r (r.ref.path)}
										<button class="to" style:--phase={PHASE_VAR[r.ref.phase]} title="Go to {r.ref.label}" onclick={() => reveal(r.ref.path)}><span class="ox-num">{r.step ?? '–'}</span> {r.ref.label}</button>
									{/each}
									{#if fl.readers.length > 4}<span class="dim">+{fl.readers.length - 4}</span>{/if}
								{/if}
								{#if fl.nextFrame.length}
									<span class="arrow" title="Read before this step, so they see this value on the next frame">↻ next frame</span>
									{#each fl.nextFrame.slice(0, 3) as r (r.ref.path)}
										<button class="to" style:--phase={PHASE_VAR[r.ref.phase]} title="Go to {r.ref.label}" onclick={() => reveal(r.ref.path)}><span class="ox-num">{r.step ?? '–'}</span> {r.ref.label}</button>
									{/each}
									{#if fl.nextFrame.length > 3}<span class="dim">+{fl.nextFrame.length - 3}</span>{/if}
								{/if}
								{#if !fl.readers.length && !fl.nextFrame.length}
									<span class="dim">{fl.self ? '(only used in this expression)' : '(nothing reads it)'}</span>
								{/if}
							</span>
						{/each}
					</div>
					{#each it.refs as ref, i (ref.path)}
						<div class="axis">
							{#if it.refs.length > 1}<span class="tag">{AXES[i]}</span>{/if}
							{#if mounted.has(it.key)}
								<MolangInput
									{session}
									path={ref.path}
									label={ref.label}
									multiline
									pretty
									context={molangContextFor(session, ref.path)}
									placeholder={ref.fallback === null ? '' : String(ref.fallback)}
									onfocus={() => (session.selected = ref.path)}
									siblings={it.refs.length > 1 ? () => it.refs.filter((r) => r.path !== ref.path).map((r) => prettyMolang(molangText(session.doc.get(r.path)))) : undefined}
								/>
							{:else}
								<pre class="static ox-code">{prettyMolang(molangText(session.doc.get(ref.path))) || ' '}</pre>
							{/if}
						</div>
					{/each}
				</div>
			{/each}
		{:else}
			<p class="dim pad">{session.programFilter ? 'No expression matches.' : 'This effect has no Molang fields yet.'}</p>
		{/each}
	</div>
</div>

<style>
	.program {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}
	.tools {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		border-bottom: 1px solid var(--ox-rule);
	}
	.tools input {
		flex: 1;
		height: 22px;
		padding: 0 6px;
		background: var(--ox-input);
		border: 1px solid transparent;
		border-radius: var(--ox-radius);
		outline: none;
	}
	.tools input:focus {
		border-color: var(--ox-lox);
	}
	.list {
		flex: 1;
		overflow: auto;
		padding: 0 8px 12px;
	}
	h4 {
		position: sticky;
		top: 0;
		z-index: 1;
		margin: 0;
		padding: 8px 2px 4px;
		background: var(--ox-panel);
		color: var(--phase);
		font-size: 11.5px;
		font-weight: 600;
		letter-spacing: 0.02em;
	}
	.item {
		border-left: var(--ox-phase-bar) solid var(--phase);
		padding: 4px 0 6px 8px;
		margin-bottom: 4px;
		border-radius: 0 var(--ox-radius) var(--ox-radius) 0;
		transition: background-color 0.4s;
	}
	.item.selected {
		background: var(--ox-hover);
	}
	.item.flash {
		background: var(--ox-selection);
		transition: none;
	}
	.ihead {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 2px 10px;
		padding-bottom: 3px;
	}
	.step {
		color: var(--ox-text-dim);
		min-width: 18px;
	}
	.lbl {
		border: none;
		background: none;
		padding: 0;
		color: var(--ox-frost);
		font-weight: 500;
		cursor: pointer;
	}
	.lbl:hover {
		color: var(--ox-lox);
	}
	.flow {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 2px 6px;
		color: var(--ox-text-dim);
		font-size: 11.5px;
	}
	.var {
		color: var(--ox-syn-variable);
	}
	.arrow {
		color: var(--ox-haze);
	}
	.to {
		border: none;
		background: none;
		padding: 0 0 0 5px;
		border-left: var(--ox-phase-bar) solid var(--phase);
		color: var(--ox-haze);
		font-size: 11.5px;
		cursor: pointer;
	}
	.to:hover {
		color: var(--ox-frost);
	}
	.axis {
		display: flex;
		gap: 6px;
		align-items: flex-start;
		margin-top: 2px;
	}
	.tag {
		width: 14px;
		line-height: 26px;
		color: var(--ox-text-dim);
		text-align: center;
		flex: none;
	}
	.axis:focus-within .tag {
		color: var(--ox-lox);
	}
	/* short expressions take one line here; long ones grow with their text */
	.axis :global(.molang.multiline) {
		min-height: 26px;
	}
	.static {
		flex: 1;
		margin: 0;
		min-height: 26px;
		padding: 3px 7px;
		background: var(--ox-input);
		border-radius: var(--ox-radius);
		color: var(--ox-code-fg);
		font-size: var(--ox-code-size);
		line-height: var(--ox-code-line);
		white-space: pre-wrap;
	}
	.dim {
		color: var(--ox-text-dim);
	}
	.pad {
		padding: 12px 4px;
	}
</style>
