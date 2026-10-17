import molang from '../generated/molang-metadata.json';

export interface MathFunctionInfo {
	name: string;
	params: string[];
	minArgs: number;
	maxArgs: number;
	description: string;
}

export interface QueryInfo {
	name: string;
	minArgs: number;
	maxArgs: number | null;
	returnType: string;
	description: string;
	firstVersion: string;
	lastVersion: string | null;
	sets: string[];
	/** 'any' = usable by world-spawned emitters; 'entity' = needs an emitter attached to an actor */
	context: 'any' | 'entity';
}

export interface MolangMetadata {
	source: string;
	game: string;
	math: MathFunctionInfo[];
	queries: QueryInfo[];
}

export const molangMetadata = molang as MolangMetadata;

const queryIndex = new Map(molangMetadata.queries.map((q) => [q.name, q]));
const mathIndex = new Map(molangMetadata.math.map((m) => [m.name, m]));

/** Look up a query by full or short name (`q.position` / `query.position`). */
export function getQuery(name: string): QueryInfo | undefined {
	const lower = name.toLowerCase();
	return queryIndex.get(lower.startsWith('q.') ? 'query.' + lower.slice(2) : lower);
}

export function getMathFunction(name: string): MathFunctionInfo | undefined {
	return mathIndex.get(name.toLowerCase());
}

/** Query registry for particle Molang: unknown queries are load errors in-game (the field is dropped). */
export function queryExists(name: string): boolean {
	return getQuery(name) !== undefined;
}
