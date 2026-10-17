import { readNbt, toPlain } from './nbt';
import { BlockWorld, type BlockState } from './blocks';

export interface StructureInfo {
	size: [number, number, number];
	blockCount: number;
	/** names in the palette, for display */
	palette: string[];
}

/**
 * Read a Bedrock .mcstructure (little-endian NBT) into a block world, placed with its origin at `at`.
 * Only the primary block layer is used; the waterlog layer adds water where the primary block is air.
 */
export function readMcstructure(bytes: Uint8Array, world = new BlockWorld(), at: [number, number, number] = [0, 0, 0]): { world: BlockWorld; info: StructureInfo } {
	const root = toPlain(readNbt(bytes).tag) as {
		size?: number[];
		structure?: {
			block_indices?: number[][] | Int32Array[];
			palette?: { default?: { block_palette?: { name: string; states?: Record<string, unknown> }[] } };
		};
	};
	const size = (root.size ?? [0, 0, 0]).map(Number) as [number, number, number];
	const layers = root.structure?.block_indices ?? [];
	const palette = root.structure?.palette?.default?.block_palette ?? [];
	const primary = layers[0] ?? [];
	const water = layers[1] ?? [];
	let count = 0;
	// indices run with Z fastest, then Y, then X
	let i = 0;
	for (let x = 0; x < size[0]; x++) {
		for (let y = 0; y < size[1]; y++) {
			for (let z = 0; z < size[2]; z++, i++) {
				const pi = Number(primary[i] ?? -1);
				const wi = Number(water[i] ?? -1);
				const block = pi >= 0 ? palette[pi] : undefined;
				const name = block?.name ?? '';
				if (block && name !== 'minecraft:air' && name !== 'minecraft:structure_void') {
					world.set(at[0] + x, at[1] + y, at[2] + z, { name, states: (block.states ?? {}) as BlockState['states'] });
					count++;
				} else if (wi >= 0 && palette[wi]) {
					world.set(at[0] + x, at[1] + y, at[2] + z, { name: palette[wi].name });
					count++;
				}
			}
		}
	}
	return { world, info: { size, blockCount: count, palette: palette.map((p) => p.name) } };
}
