/**
 * Little-endian NBT (Bedrock): used by level.dat and .mcstructure files.
 * Values keep their tag type so files round-trip byte-for-byte where possible.
 */
export type NbtTag =
	| { type: 'byte'; value: number }
	| { type: 'short'; value: number }
	| { type: 'int'; value: number }
	| { type: 'long'; value: bigint }
	| { type: 'float'; value: number }
	| { type: 'double'; value: number }
	| { type: 'byteArray'; value: Int8Array }
	| { type: 'string'; value: string }
	| { type: 'list'; elementType: NbtTagType; value: NbtTag[] }
	| { type: 'compound'; value: Record<string, NbtTag> }
	| { type: 'intArray'; value: Int32Array }
	| { type: 'longArray'; value: BigInt64Array };

export type NbtTagType = NbtTag['type'] | 'end';

const TYPE_IDS: Record<NbtTagType, number> = {
	end: 0,
	byte: 1,
	short: 2,
	int: 3,
	long: 4,
	float: 5,
	double: 6,
	byteArray: 7,
	string: 8,
	list: 9,
	compound: 10,
	intArray: 11,
	longArray: 12,
};
const TYPE_NAMES = Object.fromEntries(Object.entries(TYPE_IDS).map(([k, v]) => [v, k])) as Record<number, NbtTagType>;

class Reader {
	pos = 0;
	private view: DataView;
	private decoder = new TextDecoder();
	constructor(private bytes: Uint8Array) {
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	}
	u8() {
		return this.view.getUint8(this.pos++);
	}
	i8() {
		return this.view.getInt8(this.pos++);
	}
	i16() {
		const v = this.view.getInt16(this.pos, true);
		this.pos += 2;
		return v;
	}
	u16() {
		const v = this.view.getUint16(this.pos, true);
		this.pos += 2;
		return v;
	}
	i32() {
		const v = this.view.getInt32(this.pos, true);
		this.pos += 4;
		return v;
	}
	i64() {
		const v = this.view.getBigInt64(this.pos, true);
		this.pos += 8;
		return v;
	}
	f32() {
		const v = this.view.getFloat32(this.pos, true);
		this.pos += 4;
		return v;
	}
	f64() {
		const v = this.view.getFloat64(this.pos, true);
		this.pos += 8;
		return v;
	}
	str() {
		const len = this.u16();
		const s = this.decoder.decode(this.bytes.subarray(this.pos, this.pos + len));
		this.pos += len;
		return s;
	}
	payload(type: NbtTagType): NbtTag {
		switch (type) {
			case 'byte':
				return { type, value: this.i8() };
			case 'short':
				return { type, value: this.i16() };
			case 'int':
				return { type, value: this.i32() };
			case 'long':
				return { type, value: this.i64() };
			case 'float':
				return { type, value: this.f32() };
			case 'double':
				return { type, value: this.f64() };
			case 'byteArray': {
				const n = this.i32();
				const v = new Int8Array(this.bytes.buffer.slice(this.bytes.byteOffset + this.pos, this.bytes.byteOffset + this.pos + n));
				this.pos += n;
				return { type, value: v };
			}
			case 'string':
				return { type, value: this.str() };
			case 'list': {
				const elementType = TYPE_NAMES[this.u8()];
				const n = this.i32();
				const value: NbtTag[] = [];
				for (let i = 0; i < n; i++) value.push(this.payload(elementType));
				return { type, elementType, value };
			}
			case 'compound': {
				const value: Record<string, NbtTag> = {};
				for (;;) {
					const t = TYPE_NAMES[this.u8()];
					if (t === 'end' || t === undefined) break;
					const name = this.str();
					value[name] = this.payload(t);
				}
				return { type, value };
			}
			case 'intArray': {
				const n = this.i32();
				const v = new Int32Array(n);
				for (let i = 0; i < n; i++) v[i] = this.i32();
				return { type, value: v };
			}
			case 'longArray': {
				const n = this.i32();
				const v = new BigInt64Array(n);
				for (let i = 0; i < n; i++) v[i] = this.i64();
				return { type, value: v };
			}
		}
		throw new Error(`Unknown NBT tag type ${type}`);
	}
}

class Writer {
	private chunks: Uint8Array[] = [];
	private encoder = new TextEncoder();
	private push(n: number, fn: (v: DataView) => void) {
		const b = new Uint8Array(n);
		fn(new DataView(b.buffer));
		this.chunks.push(b);
	}
	u8(v: number) {
		this.push(1, (d) => d.setUint8(0, v));
	}
	i8(v: number) {
		this.push(1, (d) => d.setInt8(0, v));
	}
	i16(v: number) {
		this.push(2, (d) => d.setInt16(0, v, true));
	}
	u16(v: number) {
		this.push(2, (d) => d.setUint16(0, v, true));
	}
	i32(v: number) {
		this.push(4, (d) => d.setInt32(0, v, true));
	}
	i64(v: bigint) {
		this.push(8, (d) => d.setBigInt64(0, v, true));
	}
	f32(v: number) {
		this.push(4, (d) => d.setFloat32(0, v, true));
	}
	f64(v: number) {
		this.push(8, (d) => d.setFloat64(0, v, true));
	}
	str(s: string) {
		const b = this.encoder.encode(s);
		this.u16(b.length);
		this.chunks.push(b);
	}
	payload(tag: NbtTag) {
		switch (tag.type) {
			case 'byte':
				return this.i8(tag.value);
			case 'short':
				return this.i16(tag.value);
			case 'int':
				return this.i32(tag.value);
			case 'long':
				return this.i64(tag.value);
			case 'float':
				return this.f32(tag.value);
			case 'double':
				return this.f64(tag.value);
			case 'byteArray':
				this.i32(tag.value.length);
				this.chunks.push(new Uint8Array(tag.value.buffer.slice(0)));
				return;
			case 'string':
				return this.str(tag.value);
			case 'list':
				this.u8(TYPE_IDS[tag.elementType]);
				this.i32(tag.value.length);
				for (const v of tag.value) this.payload(v);
				return;
			case 'compound':
				for (const [k, v] of Object.entries(tag.value)) {
					this.u8(TYPE_IDS[v.type]);
					this.str(k);
					this.payload(v);
				}
				this.u8(0);
				return;
			case 'intArray':
				this.i32(tag.value.length);
				for (const v of tag.value) this.i32(v);
				return;
			case 'longArray':
				this.i32(tag.value.length);
				for (const v of tag.value) this.i64(v);
				return;
		}
	}
	bytes(): Uint8Array {
		const n = this.chunks.reduce((s, c) => s + c.length, 0);
		const out = new Uint8Array(n);
		let o = 0;
		for (const c of this.chunks) {
			out.set(c, o);
			o += c.length;
		}
		return out;
	}
}

export interface NamedTag {
	name: string;
	tag: NbtTag;
}

/** Read a root tag (type byte + name + payload) */
export function readNbt(bytes: Uint8Array, offset = 0): NamedTag & { end: number } {
	const r = new Reader(bytes);
	r.pos = offset;
	const type = TYPE_NAMES[r.u8()];
	const name = r.str();
	const tag = r.payload(type);
	return { name, tag, end: r.pos };
}

export function writeNbt(root: NamedTag): Uint8Array {
	const w = new Writer();
	w.u8(TYPE_IDS[root.tag.type]);
	w.str(root.name);
	w.payload(root.tag);
	return w.bytes();
}

/** level.dat: 8-byte header (storage version, payload length) + LE NBT */
export function readLevelDat(bytes: Uint8Array): { version: number; root: NamedTag } {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const version = view.getInt32(0, true);
	const root = readNbt(bytes, 8);
	return { version, root: { name: root.name, tag: root.tag } };
}

export function writeLevelDat(version: number, root: NamedTag): Uint8Array {
	const body = writeNbt(root);
	const out = new Uint8Array(body.length + 8);
	const view = new DataView(out.buffer);
	view.setInt32(0, version, true);
	view.setInt32(4, body.length, true);
	out.set(body, 8);
	return out;
}

/** Convert a tag tree to plain JS (for inspection / JSON) */
export function toPlain(tag: NbtTag): unknown {
	switch (tag.type) {
		case 'compound':
			return Object.fromEntries(Object.entries(tag.value).map(([k, v]) => [k, toPlain(v)]));
		case 'list':
			return tag.value.map(toPlain);
		case 'long':
			return tag.value.toString();
		case 'byteArray':
		case 'intArray':
			return Array.from(tag.value as ArrayLike<number>);
		case 'longArray':
			return Array.from(tag.value, (x) => x.toString());
		default:
			return tag.value;
	}
}
