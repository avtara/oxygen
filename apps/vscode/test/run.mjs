// Integration test in a real VS Code: node test/run.mjs [--extension <folder>]
// --extension tests another copy, e.g. a packaged .vsix unzipped (its extension/ folder)
import { runTests } from '@vscode/test-electron';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// launched from an Electron-based shell? VS Code must start as an app, not as Node
delete process.env.ELECTRON_RUN_AS_NODE;
const here = dirname(fileURLToPath(import.meta.url));
try {
	await runTests({
		extensionDevelopmentPath: process.argv.includes('--extension') ? resolve(process.argv[process.argv.indexOf('--extension') + 1]) : resolve(here, '..'),
		extensionTestsPath: resolve(here, 'suite.cjs'),
		launchArgs: [resolve(here, 'fixture'), '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
	});
} catch (e) {
	console.error('VS Code tests failed', e);
	process.exit(1);
}
