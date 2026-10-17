// The desktop app's deploy-to-game loop, end to end, with Minecraft running (the "Oxygen Test Lab" world open):
// opens the firework example inside a copy of the generated test pack (same folder name and UUID, so the world
// already has it active), waits for the game to /connect, presses "Deploy and spawn" in the Game menu, and saves a
// screenshot of the game. Puts the real test pack back afterwards.
//   node tools/game-loop-test.mjs [--packaged path/to/Oxygen.exe]
// While it waits, run /connect localhost:<port> in the game (it prints the port).
import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

delete process.env.ELECTRON_RUN_AS_NODE;
const args = process.argv.slice(2);
const packaged = args.includes('--packaged') ? resolve(args[args.indexOf('--packaged') + 1]) : null;
const out = resolve('test-results', 'ingame');
const mcp = (...a) => execFileSync(process.execPath, ['tools/bedrock-mcp.mjs', ...a], { encoding: 'utf8' }).trim();

let failures = 0;
const check = (ok, what) => {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
	if (!ok) failures++;
};

const dir = mkdtempSync(join(tmpdir(), 'oxygen-loop-'));
const pack = join(dir, 'oxygen_testpack_rp');
cpSync(resolve('packages/testpack/out/oxygen_testpack_rp'), pack, { recursive: true });
for (const f of ['firework', 'firework_spark']) cpSync(resolve(`packages/ui/static/examples/${f}.particle.json`), join(pack, 'particles', `${f}.particle.json`));
const file = join(pack, 'particles', 'firework.particle.json');

const appDir = resolve('apps/desktop');
const app = await electron.launch({
	...(packaged ? { executablePath: packaged, args: [file] } : { args: [appDir, file] }),
	cwd: appDir,
	env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0', OXYGEN_USER_DATA: join(dir, 'profile') },
});
try {
	const page = await app.firstWindow();
	await page.waitForFunction(() => window.oxygen?.active?.def?.identifier === 'oxygen:firework', null, { timeout: 20000 });
	const status = await page.evaluate(() => window.oxygenDesktop.gameStatus());
	console.log(`info run /connect localhost:${status.port} in the game (waiting up to 90 s)`);
	// a stale connection from an earlier session can come and go at once: wait for one that stays
	const connected = () => page.waitForFunction(async () => (await window.oxygenDesktop.gameStatus()).connected, null, { timeout: 90000, polling: 500 });
	await connected();
	await new Promise((r) => setTimeout(r, 2000));
	await connected();
	check(true, 'the game connected');

	// somewhere open, at noon, so the burst shows against the sky
	// near the test rows (chunks loaded), looking up where the rocket climbs to and bursts
	await page.evaluate(() => window.oxygenDesktop.command('tp @s 0 -55 -10 facing 0 -38 -6'));
	await page.evaluate(() => window.oxygenDesktop.command('time set noon'));

	await page.locator('.wrap > .btn:has-text("Game")').click();
	await page.locator('button:has-text("Deploy and spawn")').click();
	// the note says what happened; a reload takes the world a few seconds
	const note = await page
		.waitForFunction(() => { const t = document.querySelector('.menu .note')?.textContent?.trim(); return t && !t.startsWith('Waiting') ? t : null; }, null, { timeout: 45000 })
		.then((h) => h.jsonValue())
		.catch(() => null);
	console.log(`info the Game menu said: ${note}`);
	check(!!note && /Deployed/.test(note) && /Request to create oxygen:firework|Spawned oxygen:firework/.test(note), 'deploy and spawn report success');
	await new Promise((r) => setTimeout(r, 1300));
	console.log(mcp('screenshot', join(out, 'game-loop.png'), '1280', '720').split('\n')[0]);
	// spawn again once the reload has surely settled, for a second look
	await new Promise((r) => setTimeout(r, 6000));
	await page.locator('button:has-text("Spawn again")').click();
	await new Promise((r) => setTimeout(r, 1400));
	console.log(mcp('screenshot', join(out, 'game-loop-again.png'), '1280', '720').split('\n')[0]);
} finally {
	await app.close();
	// the real test pack back into the game
	execFileSync(process.execPath, ['--import', 'tsx', '-e', "const d = await import('./packages/testpack/src/deploy.ts'); d.deployPacks('packages/testpack/out');"], { stdio: 'inherit' });
	rmSync(dir, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
