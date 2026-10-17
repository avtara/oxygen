<script lang="ts">
	import { setContext, type Component } from 'svelte';
	import type { Workspace } from '../../state/workspace.svelte';

	/** One dock panel. A panel that throws shows its error instead of taking the whole app down. */
	interface Props {
		component: Component<{ workspace: Workspace }>;
		workspace: Workspace;
		title: string;
	}

	let { component: Panel, workspace, title }: Props = $props();
	// anything inside a panel can reach the workspace (open another panel, show a message)
	// svelte-ignore state_referenced_locally
	setContext('oxygen.workspace', workspace);
</script>

<svelte:boundary onerror={(e) => console.error(`Oxygen: the ${title} panel failed`, e)}>
	<Panel {workspace} />
	{#snippet failed(error, reset)}
		<div class="failed" role="alert">
			<strong>The {title} panel ran into a problem.</strong>
			<p class="ox-code">{error instanceof Error ? error.message : String(error)}</p>
			<p>The rest of Oxygen keeps working, and your file is unchanged.</p>
			<button onclick={reset}>Reload panel</button>
		</div>
	{/snippet}
</svelte:boundary>

<style>
	.failed {
		padding: 14px;
		color: var(--ox-haze);
		display: flex;
		flex-direction: column;
		gap: 6px;
		align-items: flex-start;
	}
	strong {
		color: var(--ox-frost);
		font-weight: 600;
	}
	p {
		margin: 0;
	}
	.ox-code {
		color: var(--ox-error);
		white-space: pre-wrap;
		word-break: break-word;
	}
	button {
		margin-top: 4px;
		height: 24px;
		padding: 0 10px;
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
		background: none;
		cursor: pointer;
	}
	button:hover {
		background: var(--ox-hover);
	}
</style>
