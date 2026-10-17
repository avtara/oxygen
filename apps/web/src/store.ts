/**
 * What the web app keeps between visits, in IndexedDB: documents saved into the browser (where the File System
 * Access API is missing, as in Firefox and Safari), and file handles picked through it (Chromium), so Recent and
 * the files open last time still work after a reload.
 */

export interface StoredFile {
	id: string;
	name: string;
	/** saved into the browser: the text itself */
	text?: string;
	/** picked from disk: the handle (structured-cloneable in Chromium) */
	handle?: unknown;
	/** last opened or saved, for Recent */
	used: number;
}

const DB = 'oxygen';
const STORE = 'files';

let db: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
	db ??= new Promise((resolve, reject) => {
		const r = indexedDB.open(DB, 1);
		r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
		r.onsuccess = () => resolve(r.result);
		r.onerror = () => reject(r.error);
	});
	return db;
}

function request<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	return open().then(
		(d) =>
			new Promise<T>((resolve, reject) => {
				const r = run(d.transaction(STORE, mode).objectStore(STORE));
				r.onsuccess = () => resolve(r.result);
				r.onerror = () => reject(r.error);
			}),
	);
}

export const getStored = (id: string) => request<StoredFile | undefined>('readonly', (s) => s.get(id)).catch(() => undefined);
export const putStored = (f: StoredFile) => request('readwrite', (s) => s.put(f)).then(() => undefined);
export const allStored = () => request<StoredFile[]>('readonly', (s) => s.getAll()).catch(() => [] as StoredFile[]);

/** Mark a stored file as just used (Recent sorts by it) */
export async function touchStored(id: string): Promise<void> {
	const f = await getStored(id);
	if (f) await putStored({ ...f, used: Date.now() }).catch(() => {});
}
