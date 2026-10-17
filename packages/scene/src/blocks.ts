import type { BlockProvider } from 'wintersky';

/** Collision box in block-local units: [minX, minY, minZ, maxX, maxY, maxZ] */
export type Box = readonly [number, number, number, number, number, number];

export interface BlockState {
	name: string;
	/** Block states that change the shape (e.g. `minecraft:vertical_half`, `top_slot_bit`) */
	states?: Record<string, string | number | boolean>;
}

const FULL: Box[] = [[0, 0, 0, 1, 1, 1]];
const NONE: Box[] = [];

/** Blocks with no collision box: particles pass through them (t17: water, short grass) */
const PASSABLE = [
	/^air$/, /^cave_air$/, /^void_air$/, /water$/, /lava$/, /^short_grass$/, /^tall_grass$/, /^grass$/, /^fern$/, /^large_fern$/, /^dead_bush$/,
	/_flower$/, /^(dandelion|poppy|blue_orchid|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|torchflower|sunflower|lilac|rose_bush|peony)$/,
	/_tulip$/, /_sapling$/, /torch$/, /^redstone_wire$/, /_button$/, /^lever$/, /_pressure_plate$/, /^tripwire/, /^vine$/, /^cave_vines/, /^seagrass$/, /^kelp/,
	/^sugar_cane$/, /^wheat$/, /^carrots$/, /^potatoes$/, /^beetroot$/, /^sweet_berry_bush$/, /_mushroom$/, /^fire$/, /^soul_fire$/, /^light_block/, /^structure_void$/,
	/_sign$/, /_banner$/, /^rail$/, /_rail$/, /^cobweb$/, /^web$/, /^nether_sprouts$/, /_roots$/, /^hanging_roots$/, /^glow_lichen$/, /^sculk_vein$/,
];

const SHAPES: [RegExp, (s: Record<string, unknown>) => Box[]][] = [
	[/_slab$/, (s) => (s['minecraft:vertical_half'] === 'top' || s.top_slot_bit === true || s.top_slot_bit === 1 ? [[0, 0.5, 0, 1, 1, 1]] : [[0, 0, 0, 1, 0.5, 1]])],
	[/^(snow_layer|snow_layer_block)$/, (s) => [[0, 0, 0, 1, Math.max(0, ((Number(s.height ?? 0) as number) + 1) / 8 - 0.125), 1]]],
	[/_carpet$|^carpet$|^moss_carpet$/, () => [[0, 0, 0, 1, 1 / 16, 1]]],
	[/_fence$|^fence$/, () => [[0.375, 0, 0.375, 0.625, 1.5, 0.625]]],
	[/_fence_gate$/, (s) => (s.open_bit ? NONE : [[0, 0, 0.375, 1, 1.5, 0.625]])],
	[/_wall$/, () => [[0.25, 0, 0.25, 0.75, 1.5, 0.75]]],
	[/_pane$|^glass_pane$|^iron_bars$/, () => [[0.4375, 0, 0.4375, 0.5625, 1, 0.5625]]],
	[/^(chest|trapped_chest|ender_chest)$/, () => [[0.0625, 0, 0.0625, 0.9375, 0.875, 0.9375]]],
	[/^(enchanting_table)$/, () => [[0, 0, 0, 1, 0.75, 1]]],
	[/_bed$|^bed$/, () => [[0, 0, 0, 1, 0.5625, 1]]],
	[/^(farmland|dirt_path|grass_path)$/, () => [[0, 0, 0, 1, 0.9375, 1]]],
	[/^soul_sand$/, () => [[0, 0, 0, 1, 0.875, 1]]],
	[/^(cake)$/, () => [[0.0625, 0, 0.0625, 0.9375, 0.5, 0.9375]]],
	[/_trapdoor$/, (s) => (s.open_bit ? NONE : s.upside_down_bit ? [[0, 0.8125, 0, 1, 1, 1]] : [[0, 0, 0, 1, 0.1875, 1]])],
	[/^(daylight_detector|daylight_detector_inverted)$/, () => [[0, 0, 0, 1, 0.375, 1]]],
	[/_stairs$/, (s) =>
		s.upside_down_bit
			? [
					[0, 0.5, 0, 1, 1, 1],
					[0, 0, 0, 1, 0.5, 0.5],
				]
			: [
					[0, 0, 0, 1, 0.5, 1],
					[0, 0.5, 0.5, 1, 1, 1],
				],
	],
	[/^(lantern|soul_lantern)$/, () => [[0.3125, 0, 0.3125, 0.6875, 0.5625, 0.6875]]],
	[/^(flower_pot)$/, () => [[0.3125, 0, 0.3125, 0.6875, 0.375, 0.6875]]],
	[/^(hopper)$/, () => [[0, 0.625, 0, 1, 1, 1]]],
	[/^(anvil|chipped_anvil|damaged_anvil)$/, () => [[0.125, 0, 0, 0.875, 1, 1]]],
	[/^(lectern)$/, () => [[0, 0, 0, 1, 0.9, 1]]],
	[/^(composter|cauldron)$/, () => FULL],
	[/^(scaffolding)$/, () => [[0, 0.875, 0, 1, 1, 1]]],
];

/** Collision boxes for a block id and its states. Full cube unless the game uses something else. */
export function collisionBoxes(id: string, states: Record<string, unknown> = {}): Box[] {
	const name = id.replace(/^minecraft:/, '');
	if (PASSABLE.some((r) => r.test(name))) return NONE;
	for (const [re, shape] of SHAPES) if (re.test(name)) return shape(states);
	return FULL;
}

/** Rough display color for a block (Oxygen draws blocks as tinted boxes, not with game textures) */
export function blockColor(id: string): number {
	const n = id.replace(/^minecraft:/, '');
	const table: [RegExp, number][] = [
		[/water/, 0x3f76e4],
		[/lava/, 0xe0640f],
		[/grass_block|^grass$/, 0x5f9f3a],
		[/leaves/, 0x3f7f2a],
		[/dirt|podzol|mud$/, 0x7a5636],
		[/sand(stone)?$/, 0xd8c98e],
		[/snow|powder_snow/, 0xeef3f8],
		[/ice/, 0x9cc1f2],
		[/glass/, 0xb8d8e8],
		[/log|wood|planks|fence|door|stairs$/, 0x9a7446],
		[/netherrack|nether_brick/, 0x6e3333],
		[/obsidian/, 0x251c33],
		[/deepslate|blackstone|basalt/, 0x4a4a52],
		[/stone|cobble|andesite|tuff|gravel|slab/, 0x8a8a8a],
		[/diorite|quartz|calcite/, 0xd8d6d0],
		[/granite|terracotta/, 0x9a6a55],
		[/gold/, 0xe8c547],
		[/iron/, 0xd8d8d8],
		[/diamond/, 0x5fd8d0],
		[/copper/, 0xc06a4a],
	];
	for (const [re, c] of table) if (re.test(n)) return c;
	let h = 0;
	for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) | 0;
	const hue = ((h >>> 0) % 360) / 360;
	const c = (1 - Math.abs(2 * 0.45 - 1)) * 0.35;
	const x = c * (1 - Math.abs(((hue * 6) % 2) - 1));
	const m = 0.45 - c / 2;
	const [r, g, b] = hue < 1 / 6 ? [c, x, 0] : hue < 2 / 6 ? [x, c, 0] : hue < 3 / 6 ? [0, c, x] : hue < 4 / 6 ? [0, x, c] : hue < 5 / 6 ? [x, 0, c] : [c, 0, x];
	return (Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255);
}

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

/**
 * A sparse block world for the preview: collision (with real collision boxes), Kill/Only-in-blocks
 * tests and drawing. Implements wintersky's BlockProvider.
 */
export class BlockWorld implements BlockProvider {
	private blocks = new Map<string, BlockState>();
	version = 0;

	get size(): number {
		return this.blocks.size;
	}

	set(x: number, y: number, z: number, block: BlockState | string | null): void {
		const k = key(x, y, z);
		if (block === null || block === 'minecraft:air') this.blocks.delete(k);
		else this.blocks.set(k, typeof block === 'string' ? { name: normalize(block) } : { ...block, name: normalize(block.name) });
		this.version++;
	}

	get(x: number, y: number, z: number): BlockState | null {
		return this.blocks.get(key(x, y, z)) ?? null;
	}

	clear(): void {
		this.blocks.clear();
		this.version++;
	}

	*entries(): Generator<[number, number, number, BlockState]> {
		for (const [k, b] of this.blocks) {
			const [x, y, z] = k.split(',').map(Number);
			yield [x, y, z, b];
		}
	}

	// ---- BlockProvider

	getBlock(x: number, y: number, z: number): string {
		return this.blocks.get(key(x, y, z))?.name ?? 'minecraft:air';
	}

	isSolid(id: string): boolean {
		return collisionBoxes(id).length > 0;
	}

	getCollisionBoxes(id: string, x: number, y: number, z: number): readonly (readonly number[])[] {
		return collisionBoxes(id, this.blocks.get(key(x, y, z))?.states ?? {});
	}

	/** Compact form for saving: palette + [x, y, z, paletteIndex] entries */
	toJSON(): { palette: BlockState[]; blocks: number[] } {
		const palette: BlockState[] = [];
		const index = new Map<string, number>();
		const blocks: number[] = [];
		for (const [x, y, z, b] of this.entries()) {
			const id = JSON.stringify(b);
			let i = index.get(id);
			if (i === undefined) {
				i = palette.push(b) - 1;
				index.set(id, i);
			}
			blocks.push(x, y, z, i);
		}
		return { palette, blocks };
	}

	static fromJSON(data: { palette?: BlockState[]; blocks?: number[] } | null | undefined): BlockWorld {
		const w = new BlockWorld();
		const p = data?.palette ?? [];
		const b = data?.blocks ?? [];
		for (let i = 0; i + 3 < b.length; i += 4) if (p[b[i + 3]]) w.set(b[i], b[i + 1], b[i + 2], p[b[i + 3]]);
		return w;
	}
}

function normalize(id: string): string {
	return id.includes(':') ? id : `minecraft:${id}`;
}
