import type { EffectDefinition, EventNode } from 'wintersky';
import { analyzeEffect } from '@oxygen/effect';
import { analyze, parse } from 'molangjs';
import { molangText } from './molang-text';

/**
 * The event wiring of an effect and everything it spawns, as a layered graph: effect cards list what fires
 * events (creation, expiry, timeline, travel, collision), event cards list what an event does in the order the
 * game runs it, and spawned effects become cards of their own. Each effect appears once, so shared children and
 * effects that spawn themselves show as edges back to the same card.
 */

export const CARD_W = 236;
export const HEAD_H = 26;
export const ROW_H = 21;
const PAD_B = 6;
const GAP_X = 92;
const GAP_Y = 14;
const MARGIN = 12;

export interface GraphRow {
	kind: 'trigger' | 'expression' | 'sound' | 'spawn' | 'note';
	/** Position inside the event: sequence steps (`2`) and random options (`40%`), outermost first */
	where: string;
	text: string;
	/** JSON path to select, from the document root */
	path: string | null;
	/** the game skips this part (why) */
	ignored?: string;
	/** something to know about what it does in-game */
	warn?: string;
}

export type CardStatus = 'root' | 'ok' | 'missing' | 'unfired' | 'deep';

export interface GraphCard {
	id: string;
	kind: 'effect' | 'event';
	/** Identifier of the effect this card belongs to (an effect card's own identifier) */
	effect: string;
	/** Event name (event cards) or identifier (effect cards) */
	name: string;
	status: CardStatus;
	rows: GraphRow[];
	layer: number;
	x: number;
	y: number;
	h: number;
}

/** Where a temp read by a child's pre-effect gets its value */
export type TempSource = 'event' | 'maybe' | 'elsewhere' | 'nowhere';

export interface GraphEdge {
	from: string;
	/** Row of the source card the edge leaves from */
	row: number;
	to: string;
	kind: 'fires' | 'spawns';
	/** Spawns: temps the child's pre-effect reads (temps are global, so they leak into it) */
	temps: { name: string; from: TempSource }[];
	/** Spawns: variables the child reads that neither the pre-effect nor the child sets */
	needs: string[];
	/** Spawn type (`emitter_bound`, …) */
	spawnType: string | null;
	/** Goes to a card at the same or an earlier layer (a cycle or a shared child) */
	back: boolean;
}

export interface EventGraph {
	cards: GraphCard[];
	edges: GraphEdge[];
	width: number;
	height: number;
}

export interface Trigger {
	label: string;
	path: string;
	events: string[];
}

const EMITTER_EVENTS = 'particle_effect/components/minecraft:emitter_lifetime_events';
const PARTICLE_EVENTS = 'particle_effect/components/minecraft:particle_lifetime_events';
const COLLISION = 'particle_effect/components/minecraft:particle_motion_collision';

const num = (n: number) => String(+n.toFixed(3));

/** What fires events in an effect, in the order the game checks them within a frame */
export function eventTriggers(d: EffectDefinition): Trigger[] {
	const out: Trigger[] = [];
	const e = d.emitter.events;
	if (e.creation.length) out.push({ label: 'Emitter created', path: `${EMITTER_EVENTS}/creation_event`, events: e.creation });
	for (const t of e.timeline) out.push({ label: `Emitter at ${num(t.at)} s`, path: `${EMITTER_EVENTS}/timeline`, events: t.events });
	for (const t of e.travelDistance) out.push({ label: `After ${num(t.at)} blocks travelled`, path: `${EMITTER_EVENTS}/travel_distance_events`, events: t.events });
	for (const t of e.loopingTravelDistance) out.push({ label: `Every ${num(t.at)} blocks travelled`, path: `${EMITTER_EVENTS}/looping_travel_distance_events`, events: t.events });
	if (e.expiration.length) out.push({ label: 'Emitter expires', path: `${EMITTER_EVENTS}/expiration_event`, events: e.expiration });
	const p = d.particle.events;
	if (p.creation.length) out.push({ label: 'Particle created', path: `${PARTICLE_EVENTS}/creation_event`, events: p.creation });
	for (const t of p.timeline) out.push({ label: `Particle at ${num(t.at)} s`, path: `${PARTICLE_EVENTS}/timeline`, events: t.events });
	for (const c of d.particle.collision?.events ?? []) out.push({ label: `Particle hits a block at ≥ ${num(c.minSpeed)} m/s`, path: `${COLLISION}/events`, events: [c.event] });
	if (p.expiration.length) out.push({ label: 'Particle expires', path: `${PARTICLE_EVENTS}/expiration_event`, events: p.expiration });
	return out;
}

function uses(src: string) {
	if (!src.trim()) return null;
	try {
		return analyze(parse(src).program, { context: 'particle' });
	} catch {
		return null;
	}
}

interface Action {
	row: GraphRow;
	spawn?: { effect: string; type: string; preEffect: string; temps: { name: string; from: TempSource }[]; sets: Set<string> };
}

/** The game's chance of picking each option (t50, t51): proportional; all weights 0 → always the first */
export function randomShares(weights: number[]): number[] {
	const total = weights.reduce((s, w) => s + w, 0);
	return weights.map((w, i) => (total > 0 ? w / total : i === 0 ? 1 : 0));
}

const IGNORED = 'The game ignores this: the step has a sequence or random choice, so only those run';
const AT_ORIGIN = "Fired when a particle is created: with /particle or a script, in-game this lands at the particle's offset from its emitter taken as a world position (near the world origin), not at the particle";
const SINGLE_AT_ORIGIN = "A single-particle spawn: with /particle or a script, in-game it appears at the world origin, not where the event fired. Type 'emitter' appears there.";

/**
 * An event's actions in the order the game runs them (measured, t48–t53): a step with a sequence or a random
 * choice runs its sequence, then one option, and ignores its own expression, sound and spawn (listed, marked
 * ignored); a plain step spawns first, then runs its expression. Temps written on the way are tracked so a
 * spawn knows which of its pre-effect's temp reads come from this event (random options only maybe).
 */
function eventActions(node: EventNode, tempsElsewhere: Set<string>, fromParticleCreation = false): Action[] {
	const out: Action[] = [];
	const text = (n: EventNode) => molangText(n.expression!.raw).replace(/\s+/g, ' ').trim() || '(empty)';
	const walk = (n: EventNode, where: string[], written: Map<string, 'event' | 'maybe'>, maybe: boolean) => {
		const label = where.join(' › ');
		if (n.sequence || n.randomize) {
			n.sequence?.forEach((s, i) => walk(s, [...where, String(i + 1)], written, maybe));
			if (n.randomize?.length) {
				const shares = randomShares(n.randomize.map((o) => o.weight));
				const after = new Map(written);
				n.randomize.forEach((o, i) => {
					const own = new Map(written);
					walk(o.node, [...where, `${+(shares[i] * 100).toFixed(shares[i] > 0 && shares[i] < 0.1 ? 1 : 0)}%`], own, true);
					for (const k of own.keys()) if (!written.has(k)) after.set(k, 'maybe');
				});
				for (const [k, v] of after) written.set(k, v);
			}
			if (n.particleEffect) out.push({ row: { kind: 'spawn', where: label, text: n.particleEffect.effect || '(no effect)', path: `${n.path}/particle_effect`, ignored: IGNORED } });
			if (n.expression) out.push({ row: { kind: 'expression', where: label, text: text(n), path: n.expression.path, ignored: IGNORED } });
			if (n.sound) out.push({ row: { kind: 'sound', where: label, text: n.sound.event || '(no sound event)', path: `${n.path}/sound_effect`, ignored: IGNORED } });
			return;
		}
		if (n.particleEffect) {
			const pe = n.particleEffect;
			const pre = pe.preEffect ? molangText(pe.preEffect.raw) : '';
			const a = uses(pre);
			const temps = [...new Set((a?.reads ?? []).filter((r) => r.ns === 'temp').map((r) => r.name))].map((name) => ({
				name,
				from: (written.get(name) ?? (tempsElsewhere.has(name) ? 'elsewhere' : 'nowhere')) as TempSource,
			}));
			const sets = new Set((a?.writes ?? []).filter((w) => w.ns === 'variable').map((w) => w.name));
			out.push({
				row: { kind: 'spawn', where: label, text: pe.effect || '(no effect)', path: `${n.path}/particle_effect`, warn: pe.type === 'particle' || pe.type === 'particle_with_velocity' ? SINGLE_AT_ORIGIN : fromParticleCreation ? AT_ORIGIN : undefined },
				spawn: { effect: pe.effect, type: pe.type, preEffect: pre, temps, sets },
			});
		}
		// after the spawn: the child doesn't see what this expression sets
		if (n.expression) {
			out.push({ row: { kind: 'expression', where: label, text: text(n), path: n.expression.path } });
			for (const w of uses(molangText(n.expression.raw))?.writes ?? []) if (w.ns === 'temp' && !written.has(w.name)) written.set(w.name, maybe ? 'maybe' : 'event');
		}
		if (n.sound) out.push({ row: { kind: 'sound', where: label, text: n.sound.event || '(no sound event)', path: `${n.path}/sound_effect` } });
	};
	walk(node, [], new Map(), false);
	return out;
}

const analyses = new WeakMap<EffectDefinition, ReturnType<typeof analyzeEffect>>();
function analysisOf(def: EffectDefinition) {
	let a = analyses.get(def);
	if (!a) analyses.set(def, (a = analyzeEffect(def)));
	return a;
}

/** Variables an effect reads unguarded but never sets itself: whoever spawns it has to (pre-effect) */
function requiredInputs(def: EffectDefinition): string[] {
	const a = analysisOf(def);
	const required = new Set<string>();
	for (const f of a.fields) for (const r of f.analysis?.reads ?? []) if (r.ns === 'variable' && !r.guarded) required.add(r.name);
	return a.variables.filter((v) => !v.builtin && !v.writes.length && !v.curve && required.has(v.name)).map((v) => v.name);
}

function tempWrites(def: EffectDefinition): Set<string> {
	const out = new Set<string>();
	for (const f of analysisOf(def).fields) for (const w of f.analysis?.writes ?? []) if (w.ns === 'temp') out.add(w.name);
	return out;
}

export function eventGraph(root: EffectDefinition, resolve: (id: string) => EffectDefinition | null, maxEffects = 24): EventGraph {
	const cards = new Map<string, GraphCard>();
	const edges: GraphEdge[] = [];
	const defs = new Map<string, EffectDefinition | null>([[root.identifier, root]]);
	const actions = new Map<string, Action[]>();
	const queue: GraphCard[] = [];
	let effects = 0;

	const card = (c: Omit<GraphCard, 'x' | 'y' | 'h'>): GraphCard => {
		const full = { ...c, x: 0, y: 0, h: 0 };
		cards.set(c.id, full);
		queue.push(full);
		return full;
	};
	const effectCard = (id: string, layer: number): GraphCard => {
		const key = `fx:${id}`;
		const existing = cards.get(key);
		if (existing) return existing;
		if (!defs.has(id)) defs.set(id, id ? resolve(id) : null);
		const def = defs.get(id) ?? null;
		const deep = effects >= maxEffects;
		effects++;
		const rows: GraphRow[] = [];
		if (!def) rows.push({ kind: 'note', where: '', text: id ? 'Not found in this pack: the game spawns nothing' : 'No effect named', path: null });
		else if (deep) rows.push({ kind: 'note', where: '', text: 'Open it to see its events', path: null });
		else {
			for (const t of eventTriggers(def)) rows.push({ kind: 'trigger', where: '', text: t.label, path: t.path });
			if (!rows.length) rows.push({ kind: 'note', where: '', text: def.events.size ? 'Nothing fires its events' : 'No events', path: null });
		}
		return card({ id: key, kind: 'effect', effect: id, name: id, status: id === root.identifier && layer === 0 ? 'root' : !def ? 'missing' : deep ? 'deep' : 'ok', rows, layer });
	};
	const eventCard = (effect: string, name: string, layer: number, fired: boolean): GraphCard => {
		const key = `ev:${effect}#${name}`;
		const existing = cards.get(key);
		if (existing) return existing;
		const def = defs.get(effect)!;
		const node = def.events.get(name);
		const list = node ? eventActions(node, tempWrites(def), def.particle.events.creation.includes(name)) : [];
		actions.set(key, list);
		const rows = list.map((a) => a.row);
		if (!node) rows.push({ kind: 'note', where: '', text: 'Not defined: firing it only logs an error', path: null });
		else if (!rows.length) rows.push({ kind: 'note', where: '', text: 'Does nothing', path: node.path });
		return card({ id: key, kind: 'event', effect, name, status: !node ? 'missing' : fired ? 'ok' : 'unfired', rows, layer });
	};

	effectCard(root.identifier, 0);
	while (queue.length) {
		const c = queue.shift()!;
		if (c.kind === 'effect') {
			const def = defs.get(c.effect);
			if (!def || c.status === 'deep' || c.status === 'missing') continue;
			const fired = new Set<string>();
			eventTriggers(def).forEach((t, i) => {
				for (const name of t.events) {
					fired.add(name);
					const ev = eventCard(c.effect, name, c.layer + 1, true);
					edges.push({ from: c.id, row: i, to: ev.id, kind: 'fires', temps: [], needs: [], spawnType: null, back: false });
				}
			});
			for (const name of def.events.keys()) if (!fired.has(name)) eventCard(c.effect, name, c.layer + 1, false);
		} else {
			(actions.get(c.id) ?? []).forEach((a, i) => {
				if (!a.spawn || !a.spawn.effect) return;
				const target = effectCard(a.spawn.effect, c.layer + 1);
				const def = defs.get(a.spawn.effect);
				const needs = def ? requiredInputs(def).filter((v) => !a.spawn!.sets.has(v)) : [];
				edges.push({ from: c.id, row: i, to: target.id, kind: 'spawns', temps: a.spawn.temps, needs, spawnType: a.spawn.type, back: target.layer <= c.layer });
			});
		}
	}

	// layout: layers left to right; each card as close to the row that leads to it as the stack allows
	const all = [...cards.values()];
	for (const c of all) c.h = HEAD_H + Math.max(1, c.rows.length) * ROW_H + PAD_B;
	const layers = Math.max(...all.map((c) => c.layer)) + 1;
	const bottom = new Array<number>(layers).fill(MARGIN);
	const incoming = new Map<string, GraphEdge>();
	for (const e of edges) if (!e.back && !incoming.has(e.to)) incoming.set(e.to, e);
	for (let l = 0; l < layers; l++) {
		for (const c of all) {
			if (c.layer !== l) continue;
			c.x = MARGIN + l * (CARD_W + GAP_X);
			const e = incoming.get(c.id);
			const src = e ? cards.get(e.from) : null;
			const want = src ? src.y + HEAD_H + e!.row * ROW_H + ROW_H / 2 - HEAD_H / 2 : MARGIN;
			c.y = Math.max(want, bottom[l]);
			bottom[l] = c.y + c.h + GAP_Y;
		}
	}
	return {
		cards: all,
		edges,
		width: MARGIN * 2 + layers * CARD_W + (layers - 1) * GAP_X,
		height: Math.max(...bottom) - GAP_Y + MARGIN,
	};
}
