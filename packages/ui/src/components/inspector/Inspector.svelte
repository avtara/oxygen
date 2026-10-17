<script lang="ts">
	import { CATEGORIES, COMPONENTS, COMPONENT_BY_ID, MATERIALS, PHASES, type ComponentInfo, type FieldInfo } from '@oxygen/format';
	import type { Workspace } from '../../state/workspace.svelte';
	import type { EffectSession } from '../../state/session.svelte';
	import { componentPath, joinPath, PHASE_VAR } from '../../lib/molang-text';
	import ComponentBlock from './ComponentBlock.svelte';
	import ComponentField from './ComponentField.svelte';
	import Select from '../fields/Select.svelte';

	interface Props {
		workspace: Workspace;
		session: EffectSession;
	}

	let { workspace, session }: Props = $props();

	const components = $derived.by(() => {
		void session.version;
		const c = session.doc.get('particle_effect/components');
		return c && typeof c === 'object' ? Object.keys(c as object) : [];
	});
	const present = $derived(components.map((id) => COMPONENT_BY_ID.get(id)).filter((c): c is ComponentInfo => !!c));
	const unknown = $derived(components.filter((id) => !COMPONENT_BY_ID.has(id)));
	/** every component, on or off, in catalogue order; a group (rate, lifetime, shape) is one row */
	const rows = $derived.by(() => {
		const out: { component: ComponentInfo; enabled: boolean }[] = [];
		const groups = new Set<string>();
		for (const c of COMPONENTS) {
			if (c.group) {
				if (groups.has(c.group)) continue;
				groups.add(c.group);
				const member = present.find((p) => p.group === c.group);
				out.push({ component: member ?? c, enabled: !!member });
			} else out.push({ component: c, enabled: components.includes(c.id) });
		}
		return out;
	});

	const desc = 'particle_effect/description';
	const identifier = $derived.by(() => {
		void session.version;
		return String(session.doc.get(joinPath(desc, 'identifier')) ?? '');
	});
	const material = $derived.by(() => {
		void session.version;
		return String(session.doc.get(joinPath(desc, 'basic_render_parameters', 'material')) ?? 'particles_alpha');
	});
	const texture = $derived.by(() => {
		void session.version;
		return String(session.doc.get(joinPath(desc, 'basic_render_parameters', 'texture')) ?? '');
	});

	/** Phase view rows: every field of every present component, in evaluation order */
	const phaseRows = $derived.by(() => {
		void session.version;
		const rows: { component: ComponentInfo; field: FieldInfo; rank: number }[] = [];
		for (const c of present) {
			c.fields.forEach((f, i) => {
				const base = componentPath(c.id);
				const p = f.key ? joinPath(base, ...f.key.split('/')) : base;
				const ref = session.analysis?.byPath.get(p) ?? session.analysis?.byPath.get(joinPath(p, 0));
				rows.push({ component: c, field: f, rank: ref?.rank ?? 10_000 + COMPONENTS.indexOf(c) * 10 + i });
			});
		}
		return rows.sort((a, b) => a.rank - b.rank);
	});
</script>

<div class="inspector">
	<div class="toolbar">
		<div class="seg" role="tablist" aria-label="Inspector view">
			<button role="tab" aria-selected={workspace.inspectorView === 'categories'} onclick={() => (workspace.inspectorView = 'categories')}>Categories</button>
			<button role="tab" aria-selected={workspace.inspectorView === 'phases'} onclick={() => (workspace.inspectorView = 'phases')}>Phases</button>
		</div>
	</div>

	<div class="scroll">
		<section class="effect" aria-label="Effect">
			<div class="erow">
				<label for="ox-id">Identifier</label>
				<input
					id="ox-id"
					class="ox-code"
					value={identifier}
					placeholder="namespace:name"
					onchange={(e) => session.doc.set(joinPath(desc, 'identifier'), e.currentTarget.value, 'Rename effect')}
				/>
			</div>
			<div class="erow">
				<span class="lab">Material</span>
				<Select value={material} label="Material" options={MATERIALS} onchange={(v) => session.doc.set(joinPath(desc, 'basic_render_parameters', 'material'), v, 'Change material')} />
			</div>
			<div class="erow">
				<label for="ox-tex">Texture</label>
				<input
					id="ox-tex"
					class="ox-code"
					value={texture}
					placeholder="textures/particle/particles"
					onchange={(e) => session.doc.set(joinPath(desc, 'basic_render_parameters', 'texture'), e.currentTarget.value, 'Change texture')}
				/>
			</div>
		</section>

		{#if workspace.inspectorView === 'categories'}
			{#each CATEGORIES as cat (cat.id)}
				{@const list = rows.filter((r) => r.component.category === cat.id)}
				{#if list.length}
					<h2 class="cat">{cat.label}</h2>
					{#each list as r (r.component.group ?? r.component.id)}
						<ComponentBlock {session} component={r.component} enabled={r.enabled} />
					{/each}
				{/if}
			{/each}
		{:else}
			{#each PHASES as ph (ph.id)}
				{@const rows = phaseRows.filter((r) => r.field.phase === ph.id)}
				{#if rows.length}
					<h2 class="cat phase" style:--phase={PHASE_VAR[ph.id]} title={ph.detail}>{ph.label}</h2>
					<p class="phase-detail">{ph.detail}</p>
					{#each rows as r, i (r.component.id + r.field.key)}
						<div class="prefixed">
							{#if i === 0 || rows[i - 1].component.id !== r.component.id}<span class="owner">{r.component.label}</span>{/if}
							<ComponentField {session} component={r.component} field={r.field} />
						</div>
					{/each}
				{/if}
			{/each}
		{/if}

		{#each unknown as id (id)}
			<div class="unknown">
				<span class="ox-code">{id}</span>
				<span>Not a particle component. The game logs an error and ignores it.</span>
				<button class="link" onclick={() => session.doc.remove(componentPath(id), 'Remove unknown component')}>Remove</button>
			</div>
		{/each}
	</div>
</div>

<style>
	.inspector {
		display: flex;
		flex-direction: column;
		height: 100%;
		position: relative;
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		border-bottom: 1px solid var(--ox-rule);
	}
	.seg {
		display: flex;
		background: var(--ox-input);
		border-radius: var(--ox-radius);
		padding: 2px;
	}
	.seg button {
		border: none;
		background: none;
		padding: 2px 10px;
		border-radius: 2px;
		color: var(--ox-haze);
		cursor: pointer;
		height: 20px;
	}
	.seg button[aria-selected='true'] {
		background: var(--ox-raised);
		color: var(--ox-frost);
	}
	.scroll {
		flex: 1;
		overflow: auto;
		padding-bottom: 40px;
	}
	.effect {
		padding: 8px 8px 8px 10px;
		display: flex;
		flex-direction: column;
		gap: 3px;
		border-bottom: 1px solid var(--ox-rule);
	}
	.erow {
		display: grid;
		grid-template-columns: minmax(84px, 34%) 1fr;
		gap: 6px;
		align-items: center;
	}
	.erow label,
	.erow .lab {
		color: var(--ox-haze);
	}
	.erow input {
		height: 22px;
		background: var(--ox-input);
		border: 1px solid transparent;
		border-radius: var(--ox-radius);
		padding: 0 6px;
		outline: none;
		min-width: 0;
	}
	.erow input:focus {
		border-color: var(--ox-lox);
	}
	.cat {
		margin: 0;
		padding: 12px 10px 2px;
		font-size: var(--ox-title-size);
		font-weight: 600;
		color: var(--ox-haze);
	}
	.cat.phase {
		color: var(--phase);
	}
	.phase-detail {
		margin: 0 10px 4px;
		color: var(--ox-text-dim);
		font-size: 11.5px;
	}
	.prefixed {
		position: relative;
	}
	.owner {
		display: block;
		padding: 4px 10px 0 10px;
		color: var(--ox-text-dim);
		font-size: 11px;
		line-height: 14px;
	}
	.unknown {
		margin: 8px;
		padding: 6px 8px;
		border-left: 2px solid var(--ox-warning);
		background: var(--ox-hover);
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
		color: var(--ox-haze);
	}
	.link {
		border: none;
		background: none;
		color: var(--ox-lox);
		cursor: pointer;
		padding: 0;
	}
</style>
