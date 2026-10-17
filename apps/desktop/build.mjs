// Builds the Electron main + preload (esbuild, CJS) and the renderer (Vite) into dist/.
import { svelte } from '@sveltejs/vite-plugin-svelte';
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as viteBuild } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
rmSync(resolve(here, 'dist'), { recursive: true, force: true });

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], mainFields: ['module', 'main'], sourcemap: true, logLevel: 'warning' };
await esbuild.build({ ...common, entryPoints: [resolve(here, 'src/main.ts')], outfile: resolve(here, 'dist/main.cjs') });
await esbuild.build({ ...common, entryPoints: [resolve(here, 'src/preload.ts')], outfile: resolve(here, 'dist/preload.cjs') });

mkdirSync(resolve(here, 'dist/examples'), { recursive: true });
cpSync(resolve(here, '../../vendor/wintersky/assets'), resolve(here, 'dist/vanilla'), { recursive: true });
cpSync(resolve(here, '../../packages/ui/static/examples'), resolve(here, 'dist/examples'), { recursive: true });

await viteBuild({
	root: resolve(here, 'renderer'),
	base: './',
	configFile: false,
	plugins: [svelte()],
	logLevel: 'warn',
	build: {
		outDir: resolve(here, 'dist/renderer'),
		emptyOutDir: true,
		target: 'es2022',
		chunkSizeWarningLimit: 5000,
		modulePreload: false,
	},
});
console.log('desktop built');
