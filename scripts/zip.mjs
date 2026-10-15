// Emballe src/ dans release/picky-v<version>.zip (manifest.json à la racine du zip).
// Usage : node scripts/zip.mjs [étiquette]   (par défaut : HEAD et la version de package.json)
// Le zip vient de Git : seul le code enregistré est publié, jamais une modification locale.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const ref = process.argv[2] ?? 'HEAD';
const manifest = JSON.parse(execFileSync('git', ['show', `${ref}:src/manifest.json`], { cwd: root, encoding: 'utf8' }));

mkdirSync(join(root, 'release'), { recursive: true });
const name = `picky-v${manifest.version}.zip`;
const out = join(root, 'release', name);
execFileSync('git', ['archive', '--format=zip', '-9', '-o', out, `${ref}:src`], { cwd: root });
console.log(`✓ release/${name} (${Math.round(statSync(out).size / 1024)} Ko)`);
