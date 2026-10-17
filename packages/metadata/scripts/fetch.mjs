// Fetches Mojang's generated Bedrock metadata (Molang queries, particle JSON schemas, doc modules)
// from a pinned commit of Mojang/bedrock-samples and derives the compact data Oxygen ships with.
// The upstream files are covered by the Minecraft EULA, so they are fetched at build time into
// `cache/` and `generated/` (both git-ignored) instead of being committed.
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const COMMIT = '46ba6ea985fb5a92d79a9419198f10dda14c199d'; // bedrock-samples, game 1.26.50.4 (2026-09-16)
const RAW = `https://raw.githubusercontent.com/Mojang/bedrock-samples/${COMMIT}/`;
const CACHE = join(ROOT, 'cache');
const OUT = join(ROOT, 'generated');

const DOC_MODULES = ['molang', 'particles', 'color-grading-and-tonemapping', 'lighting', 'texture-sets'];
const SCHEMA_PREFIXES = ['metadata/json_schemas/client/particles/', 'metadata/json_schemas/client_server/common/'];

async function exists(p) {
	try {
		await access(p);
		return true;
	} catch {
		return false;
	}
}

async function get(path, json = true) {
	const cached = join(CACHE, path);
	if (await exists(cached)) {
		const text = await readFile(cached, 'utf8');
		return json ? JSON.parse(text) : text;
	}
	const res = await fetch(RAW + encodeURI(path));
	if (!res.ok) throw new Error(`fetch ${path}: HTTP ${res.status}`);
	const text = await res.text();
	await mkdir(dirname(cached), { recursive: true });
	await writeFile(cached, text);
	return json ? JSON.parse(text) : text;
}

async function listTree() {
	const cached = join(CACHE, 'tree.json');
	if (await exists(cached)) return JSON.parse(await readFile(cached, 'utf8'));
	const headers = { 'User-Agent': 'oxygen-metadata' };
	if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
	const res = await fetch(`https://api.github.com/repos/Mojang/bedrock-samples/git/trees/${COMMIT}?recursive=1`, { headers });
	if (!res.ok) throw new Error(`tree: HTTP ${res.status}`);
	const tree = await res.json();
	await mkdir(CACHE, { recursive: true });
	await writeFile(cached, JSON.stringify(tree));
	return tree;
}

/** Queries that only make sense on an emitter attached to an actor (entity), vs. world/camera/time queries. */
const WORLD_SAFE = new Set([
	'query.distance_from_camera', 'query.camera_distance_range_lerp', 'query.lod_index', 'query.camera_rotation',
	'query.rotation_to_camera', 'query.total_particle_count', 'query.effect_particle_count', 'query.effect_emitter_count',
	'query.total_emitter_count', 'query.time_of_day', 'query.moon_phase', 'query.moon_brightness', 'query.day',
	'query.time_stamp', 'query.delta_time', 'query.frame_alpha', 'query.last_frame_time', 'query.average_frame_time',
	'query.maximum_frame_time', 'query.minimum_frame_time', 'query.noise', 'query.in_range', 'query.all', 'query.any',
	'query.approx_eq', 'query.heightmap', 'query.above_top_solid', 'query.has_biome_tag', 'query.get_level_seed_based_fraction',
	'query.surface_particle_color', 'query.surface_particle_texture_coordinate', 'query.surface_particle_texture_size',
	'query.debug_output', 'query.log', 'query.is_in_ui', 'query.position', 'query.position_delta',
]);

/** Parse "`math.clamp(value, min, max)`" style doc headings into a signature. */
function parseMathHeading(name) {
	const m = /^`?(math\.\w+)(?:\(([^)]*)\))?`?$/.exec(name.trim());
	if (!m) return null;
	return { name: m[1], params: m[2] ? m[2].split(',').map((s) => s.trim()).filter(Boolean) : [] };
}

function walk(node, visit) {
	if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
	else if (node && typeof node === 'object') {
		visit(node);
		for (const v of Object.values(node)) walk(v, visit);
	}
}

async function main() {
	if (process.argv.includes('--if-missing') && (await exists(join(OUT, 'molang-metadata.json')))) return;

	const queriesModule = await get('metadata/molang_modules/mojang-molang-queries.json');
	const docs = {};
	for (const id of DOC_MODULES) docs[id] = await get(`metadata/doc_modules/${id}.json`);

	// Math signatures + descriptions from the Molang doc module (richer than the query module)
	const mathDocs = new Map();
	walk(docs.molang, (n) => {
		if (typeof n.name !== 'string' || !n.name.replace(/`/g, '').startsWith('math.')) return;
		const sig = parseMathHeading(n.name);
		if (sig && sig.name !== 'math.function_name') {
			mathDocs.set(sig.name, { params: sig.params, description: (n.description || []).join(' ').trim() });
		}
	});

	const math = queriesModule.math_functions.map((f) => {
		const doc = mathDocs.get(f.name);
		return {
			name: f.name,
			params: doc?.params ?? [],
			minArgs: f.min_args ?? 0,
			maxArgs: f.max_args ?? f.min_args ?? 0,
			description: doc?.description || f.description,
		};
	});

	const queries = queriesModule.queries.map((q) => {
		const range = q.version_ranges?.[0] ?? {};
		const last = q.version_ranges?.[q.version_ranges.length - 1] ?? {};
		return {
			name: q.name,
			minArgs: q.min_args ?? 0,
			maxArgs: q.max_args ?? null,
			returnType: q.return_type ?? 'float',
			description: q.description ?? '',
			firstVersion: range.first_version ?? '0.0.0',
			lastVersion: last.last_version ?? null,
			sets: [...new Set((q.version_ranges ?? []).flatMap((r) => r.query_sets ?? []))],
			context: WORLD_SAFE.has(q.name) ? 'any' : 'entity',
		};
	});

	await mkdir(OUT, { recursive: true });
	await writeFile(
		join(OUT, 'molang-metadata.json'),
		JSON.stringify({ source: `Mojang/bedrock-samples@${COMMIT}`, game: '1.26.50.4', math, queries }, null, '\t'),
	);
	for (const id of DOC_MODULES) await writeFile(join(OUT, `docs-${id}.json`), JSON.stringify(docs[id]));

	// Particle JSON schemas (+ shared common types they reference), keyed by repo path
	const tree = await listTree();
	const schemaPaths = tree.tree
		.filter((e) => e.type === 'blob' && SCHEMA_PREFIXES.some((p) => e.path.startsWith(p)) && e.path.endsWith('.json'))
		.map((e) => e.path);
	const schemas = {};
	for (const p of schemaPaths) schemas[p.replace('metadata/json_schemas/', '')] = await get(p);
	await writeFile(join(OUT, 'particle-schemas.json'), JSON.stringify(schemas));

	// Vanilla particle corpus (tests only — stays in the git-ignored cache)
	const vanilla = tree.tree.filter((e) => e.type === 'blob' && e.path.startsWith('resource_pack/particles/') && e.path.endsWith('.json'));
	for (const e of vanilla) await get(e.path, false);

	console.log(`metadata: ${queries.length} queries, ${math.length} math functions, ${schemaPaths.length} schema files, ${vanilla.length} vanilla particles`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
