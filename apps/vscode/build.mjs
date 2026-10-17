// Builds the extension host (esbuild → dist/extension.js) and the webview (Vite → dist/webview).
import { svelte } from '@sveltejs/vite-plugin-svelte';
import * as esbuild from 'esbuild';
import { copyFileSync, cpSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as viteBuild } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

rmSync(resolve(here, 'dist'), { recursive: true, force: true });
// the packaged extension carries the license text (GPL)
copyFileSync(resolve(here, '../../LICENSE'), resolve(here, 'LICENSE'));
// the vanilla sprites wintersky bundles, for effects that use the game's own textures
cpSync(resolve(here, '../../vendor/wintersky/assets'), resolve(here, 'dist/vanilla'), { recursive: true });
// the example effects (Oxygen: Open example…, and the editor's Examples menu)
cpSync(resolve(here, '../../packages/ui/static/examples'), resolve(here, 'dist/examples'), { recursive: true });

const extension = {
	entryPoints: [resolve(here, 'src/extension.ts')],
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: 'node20',
	outfile: resolve(here, 'dist/extension.js'),
	external: ['vscode'],
	// prefer ESM builds: jsonc-parser's UMD build hides its requires from the bundler
	mainFields: ['module', 'main'],
	sourcemap: true,
	logLevel: 'info',
};

if (watch) {
	const ctx = await esbuild.context(extension);
	await ctx.watch();
} else await esbuild.build(extension);

await viteBuild({
	root: resolve(here, 'webview'),
	base: './',
	configFile: false,
	plugins: [svelte()],
	logLevel: 'warn',
	build: {
		outDir: resolve(here, 'dist/webview'),
		emptyOutDir: true,
		target: 'es2022',
		chunkSizeWarningLimit: 5000,
		watch: watch ? {} : null,
		rollupOptions: {
			output: {
				entryFileNames: 'index.js',
				assetFileNames: (info) => (info.names?.[0]?.endsWith('.css') ? 'index.css' : 'assets/[name]-[hash][extname]'),
				codeSplitting: false,
			},
		},
	},
});
console.log('webview built');
