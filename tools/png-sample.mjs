// Mean colour of small boxes in a PNG screenshot (8-bit RGB/RGBA, not interlaced).
// node tools/png-sample.mjs <file.png> <x,y> [x,y …] [--box 7]   → one "x,y r g b" line per point
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const args = process.argv.slice(2);
const boxAt = args.indexOf('--box');
const box = boxAt >= 0 ? Number(args[boxAt + 1]) : 7;
const [file, ...rest] = boxAt >= 0 ? args.filter((_, i) => i !== boxAt && i !== boxAt + 1) : args;
const points = rest.map((p) => p.split(',').map(Number));

const data = readFileSync(file);
let pos = 8;
let width = 0;
let height = 0;
let channels = 4;
const idat = [];
while (pos < data.length) {
	const len = data.readUInt32BE(pos);
	const type = data.toString('ascii', pos + 4, pos + 8);
	const body = data.subarray(pos + 8, pos + 8 + len);
	if (type === 'IHDR') {
		width = body.readUInt32BE(0);
		height = body.readUInt32BE(4);
		if (body[8] !== 8 || body[12] !== 0) throw new Error('only 8-bit, non-interlaced PNGs');
		channels = { 2: 3, 6: 4 }[body[9]];
		if (!channels) throw new Error('only RGB or RGBA PNGs');
	} else if (type === 'IDAT') idat.push(body);
	pos += 12 + len;
}
const raw = inflateSync(Buffer.concat(idat));
const stride = width * channels;
const px = new Uint8Array(height * stride);
for (let y = 0; y < height; y++) {
	const f = raw[y * (stride + 1)];
	const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
	const out = px.subarray(y * stride, (y + 1) * stride);
	const prev = y ? px.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
	for (let x = 0; x < stride; x++) {
		const a = x >= channels ? out[x - channels] : 0;
		const b = prev[x];
		const c = x >= channels ? prev[x - channels] : 0;
		let v = src[x];
		if (f === 1) v += a;
		else if (f === 2) v += b;
		else if (f === 3) v += (a + b) >> 1;
		else if (f === 4) {
			const p = a + b - c;
			const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
			v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
		}
		out[x] = v & 255;
	}
}
for (const [cx, cy] of points) {
	const sum = [0, 0, 0];
	let n = 0;
	const h = Math.floor(box / 2);
	for (let y = cy - h; y <= cy + h; y++)
		for (let x = cx - h; x <= cx + h; x++) {
			if (x < 0 || y < 0 || x >= width || y >= height) continue;
			const o = y * stride + x * channels;
			sum[0] += px[o];
			sum[1] += px[o + 1];
			sum[2] += px[o + 2];
			n++;
		}
	console.log(`${cx},${cy} ${sum.map((s) => Math.round(s / Math.max(1, n))).join(' ')}`);
}
