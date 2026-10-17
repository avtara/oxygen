<script lang="ts">
	import type { Workspace } from '../../state/workspace.svelte';

	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();

	const GROUPS: { title: string; note?: string; keys: [string, string][] }[] = [
		{
			title: 'Anywhere',
			keys: [
				['Ctrl K', 'Commands'],
				['Ctrl S', 'Save'],
				['Ctrl O', 'Open files'],
				['Ctrl Alt N', 'New effect'],
				['Ctrl Z', 'Undo (one history for every editor)'],
				['Ctrl Y', 'Redo'],
				['?', 'This list'],
			],
		},
		{
			title: 'Preview',
			note: 'when no text field has focus',
			keys: [
				['Space', 'Play / pause'],
				['R', 'Restart'],
				['F', 'Frame the particles'],
				['Click', 'Inspect the particle under the cursor'],
				['Drag', 'Orbit around the particle or ground under the cursor'],
				['Right drag', 'Look around; hold W A S D to fly'],
				['Middle drag · Shift drag', 'Pan'],
				['Wheel', 'Move toward what is under the cursor'],
				['W A S D', 'Fly the camera (Q down, E up, Shift faster)'],
			],
		},
		{
			title: 'Molang editors',
			keys: [
				['Ctrl Space', 'Complete'],
				['F2', 'Rename a variable everywhere'],
				['F12 · Ctrl click', 'Go to where it is set'],
				['Shift F12', 'List its uses'],
				['Ctrl D', 'Select the next occurrence'],
				['Alt click', 'Add a cursor'],
				['Shift Alt drag', 'Column selection'],
				['Ctrl /', 'Comment (kept in the oxygen block)'],
				['Shift Alt F', 'Format'],
				['Ctrl F', 'Find and replace'],
				['Ctrl Shift [ · ]', 'Fold · unfold'],
			],
		},
		{
			title: 'Panels',
			keys: [['Double-click a tab', 'Maximize the panel (again to restore)']],
		},
	];

	const close = () => (workspace.shortcutsOpen = false);
	/** mouse words read as text, everything else as a key cap */
	const isKey = (t: string) => !/^(click|Click|drag|Double-click|a|tab)$/.test(t);
</script>

<svelte:window onkeydown={(e) => workspace.shortcutsOpen && e.key === 'Escape' && close()} />

{#if workspace.shortcutsOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="scrim" onclick={close}></div>
	<div class="dialog" role="dialog" aria-label="Keyboard shortcuts">
		<div class="top">
			<h3>Keyboard shortcuts</h3>
			<button class="x" aria-label="Close" onclick={close}>×</button>
		</div>
		<div class="groups">
			{#each GROUPS as g (g.title)}
				<section>
					<h4>{g.title}{#if g.note}<span class="note">{g.note}</span>{/if}</h4>
					<dl>
						{#each g.keys as [k, what] (k)}
							<dt>{#each k.split(' · ') as alt, i (i)}{#if i}<span class="or">or</span>{/if}{#each alt.split(' ') as part, j (j)}{#if isKey(part)}<kbd>{part}</kbd>{:else}<span class="mouse">{part}</span>{/if}{/each}{/each}</dt>
							<dd>{what}</dd>
						{/each}
					</dl>
				</section>
			{/each}
		</div>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 900;
		background: rgba(10, 12, 20, 0.35);
	}
	.dialog {
		position: fixed;
		z-index: 901;
		top: 70px;
		left: 50%;
		transform: translateX(-50%);
		width: min(760px, calc(100vw - 32px));
		max-height: calc(100vh - 110px);
		overflow: auto;
		background: var(--ox-float);
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius-float);
		box-shadow: var(--ox-float-shadow);
		padding: 14px 18px 18px;
	}
	.top {
		display: flex;
		align-items: center;
		margin-bottom: 10px;
	}
	h3 {
		margin: 0;
		font-size: 13.5px;
		font-weight: 600;
	}
	.x {
		margin-left: auto;
		border: none;
		background: none;
		color: var(--ox-haze);
		font-size: 16px;
		cursor: pointer;
	}
	.x:hover {
		color: var(--ox-frost);
	}
	.groups {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
		gap: 14px 28px;
	}
	h4 {
		margin: 0 0 6px;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ox-haze);
	}
	.note {
		margin-left: 8px;
		text-transform: none;
		letter-spacing: 0;
		font-weight: 400;
		color: var(--ox-text-dim);
	}
	dl {
		margin: 0;
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 5px 12px;
		align-items: baseline;
	}
	dt {
		display: flex;
		flex-wrap: wrap;
		gap: 3px;
		align-items: baseline;
		justify-content: flex-end;
		white-space: nowrap;
	}
	dd {
		margin: 0;
		color: var(--ox-frost);
	}
	kbd {
		font-family: var(--ox-font-ui);
		font-size: 11px;
		padding: 0 5px;
		border: 1px solid var(--ox-rule-strong);
		border-bottom-width: 2px;
		border-radius: 3px;
		background: var(--ox-raised);
		color: var(--ox-frost);
		line-height: 17px;
	}
	.mouse {
		color: var(--ox-haze);
		font-size: 11.5px;
	}
	.or {
		color: var(--ox-text-dim);
		font-size: 11px;
		margin: 0 2px;
	}
</style>
