<script module lang="ts">
	import type { RGBA } from '../../lib/color';

	/** colors picked lately, shared by every picker (kept between visits) */
	let recent = $state<RGBA[]>(
		(() => {
			try {
				const v = JSON.parse(localStorage.getItem('oxygen.recentColors') ?? '[]');
				return Array.isArray(v) ? v.filter((c) => Array.isArray(c) && c.length === 4).slice(0, 12) : [];
			} catch {
				return [];
			}
		})(),
	);

	function remember(c: RGBA) {
		const key = (x: RGBA) => x.map((n) => Math.round(n * 255)).join(',');
		recent = [c, ...recent.filter((x) => key(x) !== key(c))].slice(0, 12);
		try {
			localStorage.setItem('oxygen.recentColors', JSON.stringify(recent));
		} catch {
			// storage unavailable: the list lasts this session
		}
	}
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import { hsvToRgb, parseColorInput, rgbToHsv, toCss } from '../../lib/color';

	/**
	 * A color swatch that opens a picker: saturation/value square, hue and alpha sliders, hex and recent colors.
	 * `oninput` follows every move; `onchange` fires once when a pick is done.
	 */
	interface Props {
		value: RGBA;
		label: string;
		alpha?: boolean;
		oninput?: (c: RGBA) => void;
		onchange: (c: RGBA) => void;
	}

	let { value, label, alpha = true, oninput, onchange }: Props = $props();

	let open = $state(false);
	let swatch = $state<HTMLButtonElement>();
	let pop = $state<HTMLDivElement>();
	let at = $state({ left: 0, top: 0 });
	// hue and saturation are kept here, so greys and black don't lose them while dragging
	let hsv = $state<[number, number, number]>([0, 0, 1]);
	let a = $state(1);
	let hexText = $state('');
	/** the color while the picker is open */
	const current = $derived([...hsvToRgb(hsv[0], hsv[1], hsv[2]), alpha ? a : 1] as RGBA);
	const hex = (c: RGBA) =>
		'#' +
		c
			.slice(0, alpha && c[3] < 0.999 ? 4 : 3)
			.map((n) => Math.round(Math.min(1, Math.max(0, n)) * 255).toString(16).padStart(2, '0'))
			.join('')
			.toUpperCase();

	async function show() {
		const [h, s, v] = rgbToHsv(value[0], value[1], value[2]);
		hsv = [s === 0 || v === 0 ? hsv[0] : h, v === 0 ? hsv[1] : s, v];
		a = value[3];
		hexText = hex(value);
		open = true;
		await tick();
		const r = swatch!.getBoundingClientRect();
		const ph = pop?.offsetHeight ?? 300;
		const pw = pop?.offsetWidth ?? 232;
		const below = r.bottom + 4 + ph <= window.innerHeight;
		at = { left: Math.min(window.innerWidth - pw - 6, Math.max(6, r.left)), top: below ? r.bottom + 4 : Math.max(6, r.top - ph - 4) };
	}

	function close(commit = true) {
		if (!open) return;
		open = false;
		if (commit) {
			remember(current);
			onchange(current);
		}
	}

	function emit() {
		hexText = hex(current);
		oninput?.(current);
	}

	/** drag inside an element: `f` gets the pointer as 0–1 across and down */
	function track(e: PointerEvent, f: (x: number, y: number) => void) {
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		const at = (ev: PointerEvent) => {
			const r = el.getBoundingClientRect();
			f(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
			emit();
		};
		at(e);
		const move = (ev: PointerEvent) => at(ev);
		const up = () => {
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', up);
			el.removeEventListener('pointercancel', up);
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', up);
		el.addEventListener('pointercancel', up);
	}

	function setHex(text: string) {
		// CSS order here (alpha last), like every other color picker
		const p = parseColorInput(text, true);
		if (!p) {
			hexText = hex(current);
			return;
		}
		const [h, s, v] = rgbToHsv(p.rgba[0], p.rgba[1], p.rgba[2]);
		hsv = [s === 0 ? hsv[0] : h, s, v];
		a = alpha ? p.rgba[3] : 1;
		emit();
	}

	function pick(c: RGBA) {
		const [h, s, v] = rgbToHsv(c[0], c[1], c[2]);
		hsv = [s === 0 ? hsv[0] : h, s, v];
		a = alpha ? c[3] : 1;
		emit();
	}

	$effect(() => {
		if (!open) return;
		const away = (e: PointerEvent) => {
			if (!pop?.contains(e.target as Node) && !swatch?.contains(e.target as Node)) close();
		};
		window.addEventListener('pointerdown', away, true);
		return () => window.removeEventListener('pointerdown', away, true);
	});
</script>

<button bind:this={swatch} class="swatch" aria-label={label} aria-expanded={open} title={hex(value)} onclick={() => (open ? close() : void show())}>
	<span style:background={toCss(value)}></span>
</button>

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		bind:this={pop}
		class="pop"
		role="dialog"
		aria-label={label}
		tabindex="-1"
		style:left="{at.left}px"
		style:top="{at.top}px"
		onkeydown={(e) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				close();
				swatch?.focus();
			} else if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'INPUT') close();
		}}
	>
		<div
			class="sv"
			role="slider"
			tabindex="0"
			aria-label="Saturation and brightness"
			aria-valuenow={Math.round(hsv[1] * 100)}
			style:--hue="hsl({hsv[0]} 100% 50%)"
			onpointerdown={(e) => track(e, (x, y) => (hsv = [hsv[0], x, 1 - y]))}
		>
			<span class="thumb" style:left="{hsv[1] * 100}%" style:top="{(1 - hsv[2]) * 100}%" style:background={toCss([...current.slice(0, 3), 1] as RGBA)}></span>
		</div>
		<div class="bar hue" role="slider" tabindex="0" aria-label="Hue" aria-valuenow={Math.round(hsv[0])} aria-valuemin={0} aria-valuemax={360} onpointerdown={(e) => track(e, (x) => (hsv = [Math.min(359.9, x * 360), hsv[1], hsv[2]]))}>
			<span class="knob" style:left="{(hsv[0] / 360) * 100}%"></span>
		</div>
		{#if alpha}
			<div class="bar alpha" role="slider" tabindex="0" aria-label="Alpha" aria-valuenow={Math.round(a * 255)} aria-valuemin={0} aria-valuemax={255} style:--solid={toCss([...current.slice(0, 3), 1] as RGBA)} onpointerdown={(e) => track(e, (x) => (a = Math.round(x * 255) / 255))}>
				<span class="knob" style:left="{a * 100}%"></span>
			</div>
		{/if}
		<div class="row">
			<span class="now"><span style:background={toCss(current)}></span></span>
			<input class="hex ox-num" aria-label="Hex color" value={hexText} spellcheck="false" onchange={(e) => setHex(e.currentTarget.value)} onkeydown={(e) => e.key === 'Enter' && setHex(e.currentTarget.value)} />
			{#if alpha}<span class="dim ox-num" title="Alpha, 0–255">α {Math.round(a * 255)}</span>{/if}
		</div>
		{#if recent.length}
			<div class="recent" aria-label="Recent colors">
				{#each recent as c, i (i)}
					<button class="chip" title={hex(c)} aria-label="Use {hex(c)}" onclick={() => pick(c)}><span style:background={toCss(c)}></span></button>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.swatch,
	.now,
	.chip {
		position: relative;
		display: inline-block;
		padding: 0;
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
		background: repeating-conic-gradient(#3a3f4f 0 25%, #2c303d 0 50%) 0 0 / 8px 8px;
		overflow: hidden;
		flex: none;
	}
	.swatch {
		width: 28px;
		height: 22px;
		cursor: pointer;
	}
	.swatch > span,
	.now > span,
	.chip > span {
		position: absolute;
		inset: 0;
	}
	.pop {
		position: fixed;
		z-index: 300;
		width: 220px;
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		background: var(--ox-float);
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius-float);
		box-shadow: var(--ox-float-shadow);
	}
	.sv {
		position: relative;
		height: 140px;
		border-radius: var(--ox-radius);
		background:
			linear-gradient(to top, #000, transparent),
			linear-gradient(to right, #fff, var(--hue));
		cursor: crosshair;
		touch-action: none;
	}
	.thumb {
		position: absolute;
		width: 12px;
		height: 12px;
		margin: -6px 0 0 -6px;
		border: 2px solid #fff;
		border-radius: 50%;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
		pointer-events: none;
	}
	.bar {
		position: relative;
		height: 12px;
		border-radius: 6px;
		cursor: pointer;
		touch-action: none;
	}
	.hue {
		background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
	}
	.alpha {
		background:
			linear-gradient(to right, transparent, var(--solid)),
			repeating-conic-gradient(#3a3f4f 0 25%, #2c303d 0 50%) 0 0 / 8px 8px;
	}
	.knob {
		position: absolute;
		top: -2px;
		width: 8px;
		height: 16px;
		margin-left: -4px;
		border: 2px solid #fff;
		border-radius: 3px;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
		pointer-events: none;
	}
	.sv:focus-visible,
	.bar:focus-visible {
		outline: 2px solid var(--ox-lox);
		outline-offset: 1px;
	}
	.row {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.now {
		width: 26px;
		height: 22px;
	}
	.hex {
		flex: 1;
		min-width: 0;
		height: 22px;
		background: var(--ox-input);
		border: 1px solid transparent;
		border-radius: var(--ox-radius);
		padding: 0 6px;
		outline: none;
	}
	.hex:focus {
		border-color: var(--ox-lox);
	}
	.dim {
		color: var(--ox-text-dim);
		font-size: 11px;
		white-space: nowrap;
	}
	.recent {
		display: grid;
		grid-template-columns: repeat(8, 1fr);
		gap: 4px;
	}
	.chip {
		height: 18px;
		cursor: pointer;
	}
</style>
