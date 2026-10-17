import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';

export interface CommandResult {
	statusCode: number;
	statusMessage: string;
}

/**
 * The server Minecraft joins when a player runs `/connect localhost:<port>`. Oxygen sends commands through it
 * (spawn the effect at the player, reload packs) and hears chat messages.
 */
export class ConnectServer {
	private wss: WebSocketServer | null = null;
	private socket: WebSocket | null = null;
	private pending = new Map<string, (r: CommandResult) => void>();
	onStatus: (connected: boolean) => void = () => {};
	onChat: (sender: string, message: string) => void = () => {};

	/** The port being listened on: the requested one, or the next free one if it was taken */
	port: number;
	/** Set when no port could be opened (status reports carry it) */
	error: string | null = null;

	constructor(
		port = 19131,
		/** how many ports after `port` to try when it's taken (another Oxygen, another tool) */
		private readonly tries = 10,
	) {
		this.port = port;
	}

	get connected(): boolean {
		return !!this.socket;
	}

	/**
	 * Listen for `/connect`. A taken port (another Oxygen window, another tool) moves on to the next one instead
	 * of failing; resolves with the port in use, or null when none could be opened (see `error`).
	 */
	async start(): Promise<number | null> {
		if (this.wss) return this.port;
		const first = this.port;
		for (let port = first; port < first + this.tries; port++) {
			const wss = new WebSocketServer({ port, host: '127.0.0.1' });
			const ok = await new Promise<boolean | Error>((resolve) => {
				wss.once('listening', () => resolve(true));
				wss.once('error', (e: NodeJS.ErrnoException) => resolve(e.code === 'EADDRINUSE' ? false : e));
			});
			if (ok === true) {
				this.port = port;
				this.error = null;
				this.attach(wss);
				return port;
			}
			wss.close();
			if (ok instanceof Error) {
				this.error = ok.message;
				return null;
			}
		}
		this.error = `Ports ${first}–${first + this.tries - 1} are all in use`;
		return null;
	}

	private attach(wss: WebSocketServer) {
		this.wss = wss;
		// errors after listening (rare) must not take the app down
		wss.on('error', (e) => {
			this.error = e.message;
			this.onStatus(false);
		});
		wss.on('connection', (ws) => {
			this.socket?.close();
			this.socket = ws;
			this.onStatus(true);
			this.subscribe('PlayerMessage');
			ws.on('message', (data) => this.receive(String(data)));
			ws.on('close', () => {
				if (this.socket === ws) {
					this.socket = null;
					this.onStatus(false);
				}
			});
		});
	}

	stop(): void {
		this.socket?.close();
		this.wss?.close();
		this.wss = null;
		this.socket = null;
	}

	private send(purpose: string, body: object): string {
		const requestId = randomUUID();
		this.socket?.send(JSON.stringify({ header: { requestId, messagePurpose: purpose, version: 1, messageType: 'commandRequest' }, body }));
		return requestId;
	}

	private subscribe(eventName: string) {
		this.send('subscribe', { eventName });
	}

	/**
	 * Run a command as the connected player (without the leading slash). `version` picks the command parser: 1 is the
	 * old one (no `execute … run`, and teleports snap to the block: tp 2.6 -55.3 0 lands at 2.5 -56 0.5)
	 */
	command(commandLine: string, timeoutMs = 5000, version = 1): Promise<CommandResult> {
		if (!this.socket) return Promise.reject(new Error('Minecraft is not connected. Run /connect localhost:' + this.port + ' in the game.'));
		const id = this.send('commandRequest', { version, commandLine, origin: { type: 'player' } });
		return new Promise((resolve, reject) => {
			const t = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`No answer to /${commandLine}`));
			}, timeoutMs);
			this.pending.set(id, (r) => {
				clearTimeout(t);
				resolve(r);
			});
		});
	}

	private receive(text: string) {
		let msg: { header?: { requestId?: string; messagePurpose?: string; eventName?: string }; body?: Record<string, unknown> };
		try {
			msg = JSON.parse(text);
		} catch {
			return;
		}
		const id = msg.header?.requestId;
		if (msg.header?.messagePurpose === 'commandResponse' && id && this.pending.has(id)) {
			this.pending.get(id)!({ statusCode: Number(msg.body?.statusCode ?? 0), statusMessage: String(msg.body?.statusMessage ?? '') });
			this.pending.delete(id);
		} else if (msg.header?.messagePurpose === 'event' && msg.header.eventName === 'PlayerMessage') {
			this.onChat(String(msg.body?.sender ?? ''), String(msg.body?.message ?? ''));
		}
	}
}
