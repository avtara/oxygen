<script lang="ts">
	import type { FieldInfo } from '@oxygen/format';
	import type { EffectSession } from '../../state/session.svelte';
	import { molangContextFor } from '../../lib/field-context';
	import { joinPath } from '../../lib/molang-text';
	import MolangInput from './MolangInput.svelte';

	interface Props {
		session: EffectSession;
		path: string;
		info: FieldInfo;
		labels: string[];
		defaults: number[];
		baseLabel: string;
		onfocus?: (axisPath: string) => void;
	}

	let { session, path, info, labels, defaults, baseLabel, onfocus }: Props = $props();

	// write the whole vector with defaults before the first per-axis edit
	function ensure() {
		if (!Array.isArray(session.doc.get(path))) session.doc.set(path, defaults.slice(0, labels.length), `Set ${baseLabel}`);
	}
</script>

<div class="vec">
	{#each labels as axis, i (axis)}
		{@const p = joinPath(path, i)}
		<div class="axis">
			<span class="tag" aria-hidden="true">{axis}</span>
			<MolangInput
				{session}
				path={p}
				label="{baseLabel} {axis}"
				placeholder={String(defaults[i] ?? 0)}
				context={molangContextFor(session, p, info, defaults[i] ?? 0)}
				beforeWrite={ensure}
				onfocus={() => onfocus?.(p)}
			/>
		</div>
	{/each}
</div>

<style>
	.vec {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}
	.axis {
		display: flex;
		align-items: flex-start;
		gap: 4px;
		min-width: 0;
	}
	.tag {
		width: 12px;
		flex: none;
		line-height: 22px;
		color: var(--ox-text-dim);
		font-size: 11px;
		text-align: center;
	}
	.axis:focus-within .tag {
		color: var(--ox-lox);
	}
</style>
