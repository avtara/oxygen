// dockview-core's ESM build doesn't ship its stylesheet; the UMD bundle embeds it as a string.
// This copies that CSS into src/styles/dockview.css (MIT, dockview-core).
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('dockview-core/package.json'));
const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
const src = readFileSync(join(pkgDir, 'dist/dockview-core.js'), 'utf8');
const m = /\.textContent = ("\.dv-(?:[^"\\]|\\.)*");/.exec(src);
if (!m) throw new Error('dockview CSS string not found');
const css = JSON.parse(m[1]);
writeFileSync(join(here, '../src/styles/dockview.css'), `/* dockview-core ${version} styles (MIT), extracted from dist/dockview-core.js by scripts/extract-dockview-css.mjs */\n${css}`);
console.log(`dockview.css: ${css.length} bytes`);
