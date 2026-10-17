import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import schemas from '@oxygen/metadata/generated/particle-schemas.json';
import { formatPath, type JsonDocument } from './document';

export interface SchemaProblem {
	path: string;
	message: string;
	offset: number;
	length: number;
}

let validator: ValidateFunction | null = null;

function getValidator(): ValidateFunction {
	if (validator) return validator;
	const ajv = new Ajv({ strict: false, allErrors: true, validateSchema: false });
	const all = schemas as Record<string, { $id?: string }>;
	for (const s of Object.values(all)) if (s.$id) ajv.addSchema(s);
	const root = Object.values(all).find((s) => s.$id?.endsWith('/client/particles/1.21.10/Particle%20Effect%20Data.json'));
	if (!root?.$id) throw new Error('Particle schema missing from metadata');
	validator = ajv.getSchema(root.$id)!;
	return validator;
}

function pointerToPath(pointer: string): (string | number)[] {
	if (!pointer) return [];
	return pointer
		.slice(1)
		.split('/')
		.map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
		.map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}

function describe(e: ErrorObject): string {
	switch (e.keyword) {
		case 'required':
			return `Missing "${(e.params as { missingProperty: string }).missingProperty}"`;
		case 'type':
			return `Expected ${(e.params as { type: string }).type}`;
		case 'minItems':
		case 'maxItems':
			return `Expected ${(e.params as { limit: number }).limit} items`;
		case 'enum':
			return `Expected one of ${(e.params as { allowedValues: unknown[] }).allowedValues.map((v) => JSON.stringify(v)).join(', ')}`;
		default:
			return e.message ?? 'Invalid value';
	}
}

/**
 * Validate `particle_effect` against Mojang's published schema. Results are hints: the game is more lenient
 * than the schema in places (unknown keys are ignored), so Oxygen reports these as warnings.
 */
export function validateEffect(doc: JsonDocument): SchemaProblem[] {
	const value = doc.value as { particle_effect?: unknown } | undefined;
	if (!value || typeof value !== 'object' || !value.particle_effect) return [];
	const validate = getValidator();
	if (validate(value.particle_effect)) return [];
	const out: SchemaProblem[] = [];
	const seen = new Set<string>();
	for (const e of validate.errors ?? []) {
		// oneOf/anyOf produce a cascade; keep the most specific message per location
		if (e.keyword === 'oneOf' || e.keyword === 'anyOf' || e.keyword === 'if') continue;
		const path = ['particle_effect', ...pointerToPath(e.instancePath)];
		const key = `${formatPath(path)}|${e.keyword}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const range = doc.range(path) ?? { offset: 0, length: 0 };
		out.push({ path: formatPath(path), message: describe(e), ...range });
	}
	return out;
}
