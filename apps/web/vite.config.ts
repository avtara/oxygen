import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [svelte()],
	// relative asset paths: the app works from any folder (GitHub Pages serves it under /<repo>/)
	base: './',
	// strictPort: say "port in use" rather than falling back to 5179+, which Windows often reserves (Hyper-V/WSL)
	server: { port: 5178, strictPort: true, fs: { allow: ['../..'] } },
	build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
	optimizeDeps: { exclude: ['@oxygen/ui'] },
});
