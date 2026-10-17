<script lang="ts">
	import type { Workspace } from '../../state/workspace.svelte';
	import { closeEffect, save } from '../../lib/actions';
	import GameMenu from './GameMenu.svelte';
	import MenuBar from './MenuBar.svelte';
	import logoDark from '../../assets/logo-dark.png?inline';
	import logoLight from '../../assets/logo-light.png?inline';

	interface Props {
		workspace: Workspace;
		panels: Record<string, { title: string }>;
	}

	let { workspace, panels }: Props = $props();
</script>

<!-- in the desktop app the menu row is the window's title bar: it drags the window, and the window's own buttons
     draw over its end (the titlebar-area-* insets leave them room) -->
<header class="top" class:integrated={workspace.host.kind === 'desktop'}>
	<!-- the menu row, then the open effects on a row of their own -->
	<div class="menurow">
		<div class="brand">
			<!-- rendered by tools/logo.mjs; the light one shows in VS Code's light themes -->
			<img class="logo dark" src={logoDark} alt="Oxygen" />
			<img class="logo light" src={logoLight} alt="Oxygen" />
		</div>
		<MenuBar {workspace} {panels} />
		<span class="spacer"></span>
		<div class="actions">
			<button class="btn ghost" title="Commands (Ctrl+K)" onclick={() => (workspace.paletteOpen = true)}>Commands <kbd>Ctrl K</kbd></button>
			{#if workspace.host.game}<GameMenu {workspace} game={workspace.host.game} />{/if}
			<button class="btn primary" title="Save (Ctrl+S)" disabled={!workspace.active} onclick={() => save(workspace)}>Save</button>
		</div>
	</div>

	<!-- VS Code has its own editor tabs: one effect per Oxygen editor there -->
	{#if workspace.host.kind !== 'vscode'}
	<div class="tabs" role="tablist" aria-label="Open effects">
		{#each workspace.sessions as s (s.id)}
			<div class="tab" class:active={s.id === workspace.activeId} role="tab" aria-selected={s.id === workspace.activeId}>
				<button class="tab-name" onclick={() => (workspace.activeId = s.id)} title={s.file.name}>{s.file.name}</button>
				{#if s.dirty}<span class="dirty" aria-label="unsaved changes"></span>{/if}
				<button class="tab-close" aria-label="Close {s.file.name}" onclick={() => closeEffect(workspace, s.id)}>
					<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" stroke-width="1.3" /></svg>
				</button>
			</div>
		{/each}
		<button class="new" aria-label="New effect" title="New effect (Ctrl+Alt+N)" onclick={() => workspace.newEffect()}>
			<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1.5v7M1.5 5h7" stroke="currentColor" stroke-width="1.3" /></svg>
		</button>
	</div>
	{/if}
</header>

<style>
	.top {
		display: flex;
		flex-direction: column;
		background: var(--ox-bg);
		flex: none;
	}
	.menurow {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 32px;
		padding: 0 8px 0 10px;
		border-bottom: 1px solid var(--ox-rule);
	}
	.integrated .menurow {
		-webkit-app-region: drag;
		padding-left: calc(10px + env(titlebar-area-x, 0px));
		padding-right: calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 8px);
	}
	.integrated .menurow :global(:is(button, a, input, select, [role='menu'], [role='dialog'])) {
		-webkit-app-region: no-drag;
	}
	.spacer {
		flex: 1;
	}
	.brand {
		display: flex;
		align-items: center;
		height: 100%;
		margin-left: -4px;
		padding-right: 2px;
	}
	.logo {
		display: block;
		height: 32px;
		width: auto;
		user-select: none;
		-webkit-user-drag: none;
	}
	.logo.light,
	:global(body.ox-follow-vscode.vscode-light) .logo.dark {
		display: none;
	}
	:global(body.ox-follow-vscode.vscode-light) .logo.light {
		display: block;
	}
	.tabs {
		display: flex;
		align-items: stretch;
		height: 30px;
		min-width: 0;
		padding: 0 4px;
		overflow-x: auto;
		scrollbar-width: none;
		border-bottom: 1px solid var(--ox-rule);
	}
	.tab {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 0 4px 0 10px;
		color: var(--ox-haze);
		border-bottom: 2px solid transparent;
		max-width: 220px;
	}
	.tab.active {
		color: var(--ox-frost);
		border-bottom-color: var(--ox-lox);
		background: var(--ox-panel);
	}
	.tab:hover {
		color: var(--ox-frost);
	}
	.tab-name {
		border: none;
		background: none;
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		padding: 0;
	}
	.dirty {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
		flex: none;
	}
	.tab-close,
	.new {
		width: 20px;
		height: 20px;
		border: none;
		background: none;
		border-radius: var(--ox-radius);
		cursor: pointer;
		display: grid;
		place-items: center;
		color: var(--ox-haze);
		padding: 0;
		flex: none;
	}
	.tab-close svg,
	.new svg {
		width: 10px;
		height: 10px;
	}
	.tab-close {
		opacity: 0;
	}
	.tab:hover .tab-close,
	.tab.active .tab-close,
	.tab-close:focus-visible {
		opacity: 1;
	}
	.tab-close:hover,
	.new:hover {
		background: var(--ox-hover);
		color: var(--ox-frost);
	}
	.new {
		align-self: center;
		margin-left: 4px;
	}
	.actions {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.btn {
		height: 26px;
		padding: 0 12px;
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
		background: none;
		cursor: pointer;
		color: var(--ox-frost);
	}
	.btn:hover:not(:disabled) {
		background: var(--ox-hover);
	}
	.btn.ghost {
		border-color: transparent;
		color: var(--ox-haze);
	}
	.btn.ghost kbd {
		font: inherit;
		font-size: 11px;
		color: var(--ox-text-dim);
		margin-left: 4px;
	}
	.btn.primary {
		background: var(--ox-lox);
		border-color: var(--ox-lox);
		color: #10131c;
		font-weight: 600;
	}
	.btn.primary:hover:not(:disabled) {
		background: #a6c9f7;
	}
	.btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
