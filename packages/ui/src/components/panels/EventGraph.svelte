<script lang="ts">
	import type { EffectSession } from '../../state/session.svelte';
	import type { Workspace } from '../../state/workspace.svelte';
	import { CARD_W, HEAD_H, ROW_H, eventGraph, type GraphCard, type GraphEdge, type GraphRow, type TempSource } from '../../lib/event-graph';

	interface Props {
		workspace: Workspace;
		session: EffectSession;
		/** event shown in the editor next to the graph */
		current: string | null;
		onpick: (name: string) => void;
	}

	let { workspace, session, current, onpick }: Props = $props();
	let hover = $state<string | null>(null);
	let zoom = $state(1);

	const graph = $derived.by(() => {
		void session.version;
		void session.childrenVersion;
		const d = session.def;
		return d ? eventGraph(d, (id) => session.childDefinition(id)) : null;
	});
	/** the automatic layout, moved by wherever the user dragged cards */
	const cards = $derived(
		(graph?.cards ?? []).map((c) => {
			const o = session.eventLayout[c.id];
			return o ? { ...c, x: Math.max(0, c.x + o.dx), y: Math.max(0, c.y + o.dy) } : c;
		}),
	);
	const byId = $derived(new Map(cards.map((c) => [c.id, c])));
	const width = $derived(Math.max(graph?.width ?? 0, ...cards.map((c) => c.x + CARD_W + 40)));
	const height = $derived(Math.max((graph?.height ?? 0) + 24, ...cards.map((c) => c.y + c.h + 60)));
	const moved = $derived(Object.keys(session.eventLayout).length > 0);

	// pan: drag the empty background (or middle-drag anywhere); move a card: drag its header
	let el = $state<HTMLElement>();
	let pan: { x: number; y: number; left: number; top: number } | null = null;
	let drag: { id: string; x: number; y: number; dx: number; dy: number; moved: boolean } | null = null;
	let suppressClick = false;
	let panning = $state(false);

	function onpointerdown(e: PointerEvent) {
		const t = e.target as HTMLElement;
		const onBackground = !t.closest('.card, .zoom, .label');
		if (!el || !(e.button === 1 || (e.button === 0 && onBackground))) return;
		e.preventDefault();
		pan = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
		panning = true;
		el.setPointerCapture(e.pointerId);
	}
	function startCardDrag(e: PointerEvent, c: GraphCard) {
		if (e.button !== 0) return;
		const o = session.eventLayout[c.id] ?? { dx: 0, dy: 0 };
		drag = { id: c.id, x: e.clientX, y: e.clientY, dx: o.dx, dy: o.dy, moved: false };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onpointermove(e: PointerEvent) {
		if (pan && el) {
			el.scrollLeft = pan.left - (e.clientX - pan.x);
			el.scrollTop = pan.top - (e.clientY - pan.y);
		} else if (drag) {
			const mx = (e.clientX - drag.x) / zoom;
			const my = (e.clientY - drag.y) / zoom;
			if (!drag.moved && Math.hypot(mx, my) < 3) return;
			drag.moved = true;
			session.eventLayout = { ...session.eventLayout, [drag.id]: { dx: drag.dx + mx, dy: drag.dy + my } };
		}
	}
	function onpointerup() {
		if (drag?.moved) suppressClick = true;
		pan = null;
		drag = null;
		panning = false;
	}
	/** a drag that moved a card isn't also a click on it */
	function clickGuard(fn: () => void) {
		if (suppressClick) {
			suppressClick = false;
			return;
		}
		fn();
	}
	const rootId = $derived(session.def?.identifier ?? '');

	const short = (n: string) => n.replace(/^variable\./, 'v.').replace(/^temp\./, 't.');
	const TEMP_NOTE: Record<TempSource, string> = {
		event: 'set earlier in this event: the child gets this value (temps are global, so they leak into the pre-effect)',
		maybe: 'set earlier only in some random options: otherwise the child gets whatever was left in it',
		elsewhere: "not set in this event: the child gets whatever this effect's other expressions last left in it",
		nowhere: 'set nowhere in this effect: unless another effect left it, the read aborts the pre-effect',
	};

	function rowY(c: GraphCard, row: number) {
		return c.y + HEAD_H + row * ROW_H + ROW_H / 2;
	}
	function edgePath(e: GraphEdge): string {
		const a = byId.get(e.from)!;
		const b = byId.get(e.to)!;
		const x1 = a.x + CARD_W;
		const y1 = rowY(a, e.row);
		const x2 = b.x;
		const y2 = b.y + HEAD_H / 2;
		if (!e.back) {
			const dx = Math.max(28, (x2 - x1) / 2);
			return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2 - 4},${y2}`;
		}
		// back to a card on the left (an effect spawning itself or an earlier one): loop under the cards
		const low = Math.max(a.y + a.h, b.y + b.h) + 18;
		return `M${x1},${y1} C${x1 + 40},${y1} ${x1 + 40},${low} ${x1 - 20},${low} L${x2 + 20},${low} C${x2 - 40},${low} ${x2 - 40},${y2} ${x2 - 4},${y2}`;
	}
	function labelAt(e: GraphEdge): { x: number; y: number } {
		const a = byId.get(e.from)!;
		const b = byId.get(e.to)!;
		if (e.back) return { x: Math.min(a.x, b.x) + CARD_W + 12, y: Math.max(a.y + a.h, b.y + b.h) + 22 };
		return { x: a.x + CARD_W + 10, y: (rowY(a, e.row) + b.y + HEAD_H / 2) / 2 };
	}
	const related = (e: GraphEdge) => !hover || e.from === hover || e.to === hover;
	const labelled = $derived((graph?.edges ?? []).filter((e) => e.kind === 'spawns' && (e.temps.length || e.needs.length)));

	async function openCard(c: GraphCard, path?: string | null) {
		if (c.effect === rootId) {
			if (c.kind === 'event') onpick(c.name);
			if (path) {
				session.selected = path;
				if (path.includes('/components/')) workspace.show('inspector');
			}
			return;
		}
		if (c.status === 'missing' && c.kind === 'effect') return;
		const s = await workspace.showEffect(c.effect);
		if (s && path) s.selected = path;
		else if (s && c.kind === 'event') s.selected = `particle_effect/events/${c.name}`;
	}
	function rowTitle(c: GraphCard, r: GraphRow): string {
		if (r.kind === 'trigger') return `${r.text}: fires ${(graph?.edges ?? []).filter((e) => e.from === c.id && rowIndex(c, r) === e.row).map((e) => byId.get(e.to)?.name).join(', ')}`;
		if (r.kind === 'spawn') return `Spawns ${r.text}`;
		if (r.kind === 'sound') return `Plays the sound event ${r.text}`;
		return r.text;
	}
	const rowIndex = (c: GraphCard, r: GraphRow) => c.rows.indexOf(r);

	function onwheel(e: WheelEvent) {
		if (!e.ctrlKey) return;
		e.preventDefault();
		zoom = Math.min(1.6, Math.max(0.4, +(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)).toFixed(2)));
	}
</script>

{#if graph}
	<div class="graph" role="group" aria-label="Events graph: drag the background to pan, drag a card by its header to move it" class:panning bind:this={el} {onwheel} {onpointerdown} {onpointermove} {onpointerup} onpointercancel={onpointerup}>
		<div class="zoom">
			<button aria-label="Zoom out" onclick={() => (zoom = Math.max(0.4, +(zoom / 1.2).toFixed(2)))}>−</button>
			<button class="pct ox-num" title="Actual size (Ctrl+wheel zooms)" onclick={() => (zoom = 1)}>{Math.round(zoom * 100)}%</button>
			<button aria-label="Zoom in" onclick={() => (zoom = Math.min(1.6, +(zoom * 1.2).toFixed(2)))}>+</button>
			{#if moved}<button class="tidy" title="Put every card back where the automatic layout places it" onclick={() => (session.eventLayout = {})}>Tidy</button>{/if}
		</div>
		<div class="sizer" style:width="{width * zoom}px" style:height="{height * zoom}px">
			<div class="canvas" style:width="{width}px" style:height="{height}px" style:transform="scale({zoom})">
				<svg {width} {height} aria-hidden="true">
					<defs>
						<marker id="ox-ev-arrow" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
							<path d="M0,0 L8,4 L0,8 z" fill="context-stroke" />
						</marker>
					</defs>
					{#each graph.edges as e, i (i)}
						<path class="edge {e.kind}" class:back={e.back} class:dim={!related(e)} class:hot={hover && related(e)} d={edgePath(e)} marker-end="url(#ox-ev-arrow)" />
					{/each}
				</svg>
				{#each cards as c (c.id)}
					<div
						class="card {c.kind} {c.status}"
						class:sel={c.kind === 'event' && c.effect === rootId && c.name === current}
						style:left="{c.x}px"
						style:top="{c.y}px"
						style:width="{CARD_W}px"
						style:height="{c.h}px"
						role="group"
						aria-label="{c.kind === 'effect' ? 'Effect' : 'Event'} {c.name}"
						onmouseenter={() => (hover = c.id)}
						onmouseleave={() => (hover = null)}
					>
						<button
							class="head"
							style:height="{HEAD_H}px"
							aria-disabled={c.kind === 'effect' && (c.effect === rootId || c.status === 'missing')}
							title={c.kind === 'effect' ? (c.effect === rootId ? 'This effect' : c.status === 'missing' ? `${c.name} isn't in this pack` : `Open ${c.name}`) : c.effect === rootId ? `Edit ${c.name}` : `Open ${c.effect} at ${c.name}`}
							onpointerdown={(e) => startCardDrag(e, c)}
							onclick={() => clickGuard(() => openCard(c))}
						>
							<span class="kind">{c.kind === 'effect' ? (c.effect === rootId && c.status === 'root' ? 'This effect' : 'Effect') : 'Event'}</span>
							<span class="name ox-code">{c.name || '(unnamed)'}</span>
							{#if c.status === 'unfired'}<span class="tag">never fired</span>{:else if c.status === 'missing'}<span class="tag bad">missing</span>{/if}
						</button>
						{#each c.rows as r, i (i)}
							<button class="row {r.kind}" class:ignored={!!r.ignored} style:height="{ROW_H}px" disabled={!r.path} title={r.ignored ?? r.warn ?? rowTitle(c, r)} onclick={() => openCard(c, r.path)}>
								{#if r.where}<span class="where ox-num">{r.where}</span>{/if}
								{#if r.kind === 'spawn'}<span class="verb">spawn</span>{:else if r.kind === 'sound'}<span class="verb">sound</span>{/if}
								<span class="text" class:ox-code={r.kind === 'expression' || r.kind === 'spawn' || r.kind === 'sound'}>{r.text}</span>
								{#if r.ignored}<span class="flag">ignored</span>{:else if r.warn}<span class="flag warn">at origin</span>{/if}
								{#if r.kind === 'trigger' || (r.kind === 'spawn' && !r.ignored)}<span class="port" aria-hidden="true"></span>{/if}
							</button>
						{/each}
					</div>
				{/each}
				{#each labelled as e, i (i)}
					{@const p = labelAt(e)}
					<div class="label" class:dim={!related(e)} style:left="{p.x}px" style:top="{p.y}px">
						{#each e.temps as t (t.name)}
							<code class="chip ox-code {t.from}" title="{short(t.name)} {TEMP_NOTE[t.from]}">{short(t.name)}</code>
						{/each}
						{#each e.needs as n (n)}
							<code class="chip ox-code need" title="The child reads {short(n)}, but neither this pre-effect nor the child sets it: those reads abort">needs {short(n)}</code>
						{/each}
					</div>
				{/each}
			</div>
		</div>
	</div>
{/if}

<style>
	.graph {
		position: relative;
		height: 100%;
		overflow: auto;
		background-color: var(--ox-bg);
		background-image: radial-gradient(var(--ox-rule) 1px, transparent 1.2px);
		background-size: 16px 16px;
	}
	.zoom {
		position: sticky;
		top: 6px;
		left: calc(100% - 136px);
		z-index: 3;
		display: inline-flex;
		width: 130px;
		margin-bottom: -28px;
		background: var(--ox-float);
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
	}
	.zoom button {
		flex: 1;
		height: 20px;
		border: none;
		background: none;
		color: var(--ox-haze);
		cursor: pointer;
		padding: 0;
	}
	.zoom button:hover {
		color: var(--ox-frost);
	}
	.zoom .pct {
		flex: 1.6;
		font-size: 10.5px;
	}
	.zoom .tidy {
		flex: 2;
		font-size: 10.5px;
		border-left: 1px solid var(--ox-rule);
	}
	.canvas {
		position: relative;
		transform-origin: 0 0;
	}
	svg {
		position: absolute;
		inset: 0;
		overflow: visible;
	}
	.edge {
		fill: none;
		stroke-width: 1.3;
		opacity: 0.7;
		transition: opacity 0.1s;
	}
	.edge.fires {
		stroke: var(--ox-phase-event);
	}
	.edge.spawns {
		stroke: var(--ox-lox);
	}
	.edge.back {
		stroke-dasharray: 4 3;
	}
	.edge.dim {
		opacity: 0.12;
	}
	.edge.hot {
		opacity: 1;
		stroke-width: 1.7;
	}
	.card {
		position: absolute;
		display: flex;
		flex-direction: column;
		background: var(--ox-raised);
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
		box-shadow: 0 1px 0 rgb(0 0 0 / 0.25);
		overflow: hidden;
	}
	.card.effect {
		border-top: 2px solid var(--ox-lox);
	}
	.card.event {
		border-top: 2px solid var(--ox-phase-event);
	}
	.card.root {
		border-top-color: var(--ox-frost);
	}
	.card.unfired {
		opacity: 0.7;
		border-style: dashed;
	}
	.card.missing {
		border-color: var(--ox-error);
		border-style: dashed;
	}
	.card.sel {
		border-color: var(--ox-lox);
		box-shadow: 0 0 0 1px var(--ox-lox);
	}
	button {
		font: inherit;
		color: inherit;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 8px;
		border: none;
		border-bottom: 1px solid var(--ox-rule);
		background: none;
		text-align: left;
		cursor: pointer;
		flex: none;
	}
	.head {
		cursor: grab;
	}
	.panning,
	.panning .head {
		cursor: grabbing;
	}
	.head:not([aria-disabled='true']):hover .name {
		text-decoration: underline;
	}
	.kind {
		color: var(--ox-text-dim);
		font-size: 10.5px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		flex: none;
	}
	.name {
		color: var(--ox-frost);
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.tag {
		margin-left: auto;
		flex: none;
		font-size: 10.5px;
		color: var(--ox-text-dim);
	}
	.tag.bad {
		color: var(--ox-error);
	}
	.row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 14px 0 8px;
		border: none;
		background: none;
		text-align: left;
		cursor: pointer;
		flex: none;
		min-width: 0;
	}
	.row:not(:disabled):hover {
		background: var(--ox-hover);
	}
	.row:disabled {
		cursor: default;
	}
	.row.note {
		color: var(--ox-text-dim);
		font-style: italic;
	}
	.row.trigger {
		color: var(--ox-haze);
	}
	.where {
		flex: none;
		color: var(--ox-text-dim);
		font-size: 10.5px;
	}
	.verb {
		flex: none;
		color: var(--ox-text-dim);
		font-size: 10.5px;
	}
	.text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.row.expression .text {
		color: var(--ox-code-fg);
	}
	.row.spawn .text {
		color: var(--ox-lox);
	}
	.row.ignored .text,
	.row.ignored .verb {
		text-decoration: line-through;
		opacity: 0.5;
	}
	.flag {
		flex: none;
		margin-left: auto;
		font-size: 10px;
		color: var(--ox-text-dim);
	}
	.flag.warn {
		color: var(--ox-warning);
	}
	.port {
		position: absolute;
		right: 3px;
		top: 50%;
		width: 6px;
		height: 6px;
		margin-top: -3px;
		border-radius: 50%;
		background: var(--ox-phase-event);
	}
	.row.spawn .port {
		background: var(--ox-lox);
	}
	.label {
		position: absolute;
		transform: translateY(-50%);
		display: flex;
		flex-wrap: wrap;
		gap: 3px;
		max-width: 80px;
		z-index: 2;
		transition: opacity 0.1s;
	}
	.label.dim {
		opacity: 0.2;
	}
	.chip {
		padding: 0 4px;
		border-radius: 3px;
		background: var(--ox-float);
		border: 1px solid var(--ox-syn-temp);
		color: var(--ox-syn-temp);
		font-size: 10.5px;
		line-height: 15px;
		white-space: nowrap;
	}
	.chip.maybe {
		border-style: dashed;
	}
	.chip.elsewhere {
		border-color: var(--ox-warning);
		color: var(--ox-warning);
	}
	.chip.nowhere,
	.chip.need {
		border-color: var(--ox-error);
		color: var(--ox-error);
	}
</style>
