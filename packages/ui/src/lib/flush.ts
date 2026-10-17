/**
 * Editors debounce their writes to the document. Before undo, save or anything else that reads the
 * document, flush every pending edit so the document is current.
 */
const pending = new Set<() => void>();

export function registerFlush(fn: () => void): () => void {
	pending.add(fn);
	return () => pending.delete(fn);
}

export function flushEdits(): void {
	for (const fn of [...pending]) fn();
}
