// Runs commands in a connected Minecraft without typing them in chat (chat autocomplete garbles typed commands).
// Start it, run `/connect localhost:19131` in the game once, then:
//   curl "http://127.0.0.1:19140/cmd?line=time%20set%20noon"     → {"statusCode":0,"statusMessage":"..."}
//   curl "http://127.0.0.1:19140/cmd?line=…&v=42"                 → a newer command parser (exact tp, execute … run)
//   curl "http://127.0.0.1:19140/status"                          → {"connected":true}
// npx tsx tools/game-bridge.ts [--port 19131] [--http 19140]
import { createServer } from 'node:http';
import { ConnectServer } from '../packages/gamelink/src/connect';

const args = process.argv.slice(2);
const opt = (k: string, d: number) => {
	const i = args.indexOf(k);
	return i >= 0 ? Number(args[i + 1]) : d;
};
const game = new ConnectServer(opt('--port', 19131));
game.onStatus = (c) => console.log(c ? 'game connected' : 'game disconnected');
const port = await game.start();
if (port === null) throw new Error(`can't listen for the game: ${game.error}`);

createServer(async (req, res) => {
	const url = new URL(req.url ?? '/', 'http://x');
	const reply = (code: number, body: unknown) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body));
	if (url.pathname === '/status') return reply(200, { connected: game.connected });
	if (url.pathname === '/cmd') {
		const line = (url.searchParams.get('line') ?? '').replace(/^\//, '');
		try {
			reply(200, await game.command(line, 5000, Number(url.searchParams.get('v') ?? 1)));
		} catch (e) {
			reply(503, { error: (e as Error).message });
		}
		return;
	}
	reply(404, { error: 'use /cmd?line=… or /status' });
}).listen(opt('--http', 19140), '127.0.0.1', () => console.log(`bridge on http://127.0.0.1:${opt('--http', 19140)}; run /connect localhost:${port} in the game`));
