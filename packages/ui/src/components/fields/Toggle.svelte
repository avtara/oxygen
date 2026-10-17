<script lang="ts">
	interface Props {
		checked: boolean;
		label: string;
		onchange: (value: boolean) => void;
		disabled?: boolean;
	}

	let { checked, label, onchange, disabled = false }: Props = $props();
</script>

<button class="toggle" role="switch" aria-checked={checked} aria-label={label} {disabled} onclick={() => onchange(!checked)}>
	<span class="knob"></span>
</button>

<style>
	.toggle {
		width: 30px;
		height: 16px;
		border-radius: 8px;
		border: 1px solid var(--ox-rule-strong);
		background: var(--ox-input);
		padding: 0;
		position: relative;
		cursor: pointer;
		flex: none;
		transition: background 0.12s;
	}
	.knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--ox-haze);
		transition: transform 0.12s, background 0.12s;
	}
	.toggle[aria-checked='true'] {
		background: rgba(147, 189, 245, 0.25);
		border-color: var(--ox-lox);
	}
	.toggle[aria-checked='true'] .knob {
		transform: translateX(14px);
		background: var(--ox-lox);
	}
	.toggle:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
