#!/usr/bin/env node
// Minimal client for the BedrockMCP server injected into Minecraft (http://127.0.0.1:18081/mcp).
// Usage:
//   node tools/bedrock-mcp.mjs state
//   node tools/bedrock-mcp.mjs screenshot out.png [width] [height]
//   node tools/bedrock-mcp.mjs chat "/time set noon"
//   node tools/bedrock-mcp.mjs key escape
//   node tools/bedrock-mcp.mjs call <tool> '<json args>'
//   node tools/bedrock-mcp.mjs tools
import { writeFileSync } from 'node:fs';

const URL = process.env.BEDROCK_MCP_URL ?? 'http://127.0.0.1:18081/mcp';
let id = 0;
let session = null;

async function rpc(method, params, notify = false) {
	const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
	if (session) headers['Mcp-Session-Id'] = session;
	const res = await fetch(URL, {
		method: 'POST',
		headers,
		body: JSON.stringify(notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++id, method, params }),
	});
	const sid = res.headers.get('mcp-session-id');
	if (sid) session = sid;
	const text = await res.text();
	if (notify || !text.trim()) return null;
	// server may answer with SSE framing
	const json = text.startsWith('{') ? JSON.parse(text) : JSON.parse(text.split('\n').find((l) => l.startsWith('data:')).slice(5));
	if (json.error) throw new Error(JSON.stringify(json.error));
	return json.result;
}

async function call(name, args = {}) {
	return rpc('tools/call', { name, arguments: args });
}

function printContent(result, imageOut) {
	for (const c of result.content ?? []) {
		if (c.type === 'text') console.log(c.text);
		else if (c.type === 'image') {
			if (imageOut) {
				writeFileSync(imageOut, Buffer.from(c.data, 'base64'));
				console.log(`saved ${imageOut}`);
			} else console.log(`[image ${c.mimeType}, ${c.data.length} b64 chars]`);
		}
	}
	if (result.isError) process.exitCode = 1;
}

const [cmd, ...rest] = process.argv.slice(2);
await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'oxygen-tools', version: '0' } });
await rpc('notifications/initialized', {}, true);
switch (cmd) {
	case 'tools': {
		const r = await rpc('tools/list', {});
		for (const t of r.tools) console.log(`${t.name}: ${t.description}`);
		break;
	}
	case 'state':
		printContent(await call('state'));
		break;
	case 'screenshot': {
		const [out = 'screenshot.png', w, h] = rest;
		printContent(await call('screenshot', { width: w ? Number(w) : 1280, height: h ? Number(h) : 720 }), out);
		break;
	}
	case 'chat':
		printContent(await call('chat', { message: rest.join(' ') }));
		break;
	case 'key':
		printContent(await call('key', { key: rest[0], action: rest[1] ?? 'press' }));
		break;
	case 'call':
		printContent(await call(rest[0], rest[1] ? JSON.parse(rest[1]) : {}), rest[2]);
		break;
	default:
		console.error('commands: tools | state | screenshot <out> [w h] | chat <msg> | key <name> | call <tool> <json> [imageOut]');
		process.exitCode = 2;
}
