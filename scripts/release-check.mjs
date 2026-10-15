// Vérifie qu'une version est prête à publier : même version dans package.json, le manifeste
// et l'étiquette Git, et une section dans le CHANGELOG.
// Avec --notes [version], écrit les notes de la Release (section du CHANGELOG + installation).
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(join(root, file), 'utf8');

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function changelogSection(version) {
  const section = read('CHANGELOG.md')
    .split(/^## /m)
    .find((chunk) => chunk.startsWith(version + ' '));
  return section?.slice(section.indexOf('\n') + 1).trim();
}

const notesIndex = process.argv.indexOf('--notes');
if (notesIndex !== -1) {
  const version = process.argv[notesIndex + 1] ?? JSON.parse(read('package.json')).version;
  const notes = changelogSection(version);
  if (!notes) fail(`aucune section « ## ${version} » dans CHANGELOG.md.`);
  console.log(`${notes}

### Installation

1. Télécharge **picky-v${version}.zip** ci-dessous et décompresse-le.
2. Ouvre \`brave://extensions\` (ou \`chrome://extensions\`) et active le **Mode développeur**.
3. Clique sur **Charger l'extension non empaquetée** et choisis le dossier décompressé.

Pour mettre à jour : décompresse la nouvelle version au même endroit, puis clique sur ↻ sur la
carte de Picky.`);
  process.exit(0);
}

const pkg = JSON.parse(read('package.json')).version;
const manifest = JSON.parse(read('src/manifest.json')).version;
if (pkg !== manifest) fail(`package.json (${pkg}) et src/manifest.json (${manifest}) n'ont pas la même version.`);

const tag = process.env.GITHUB_REF_NAME;
if (tag?.startsWith('v') && tag !== `v${pkg}`) fail(`l'étiquette ${tag} ne correspond pas à la version ${pkg}.`);

if (!changelogSection(pkg)) fail(`aucune section « ## ${pkg} » dans CHANGELOG.md.`);
console.log(`✓ version ${pkg} prête à publier`);
