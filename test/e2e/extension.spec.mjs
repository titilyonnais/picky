import { test as base, chromium, expect } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startServers } from './server.mjs';

const EXT = resolve(import.meta.dirname, '..', '..', 'src');

// Lit le format d'un fichier à ses premiers octets, et ses dimensions si c'est un PNG.
function inspect(file) {
  const b = readFileSync(file);
  const ascii = (s, e) => b.subarray(s, e).toString('latin1');
  if (ascii(1, 4) === 'PNG') return { format: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) return { format: 'jpg' };
  if (ascii(8, 12) === 'WEBP') return { format: 'webp' };
  if (ascii(4, 12) === 'ftypavif') return { format: 'avif' };
  return { format: 'inconnu' };
}

const test = base.extend({
  // Un seul navigateur pour toute la suite : les cas tournent l'un après l'autre.
  shared: [
    async ({}, use) => {
      const servers = await startServers();
      const userData = mkdtempSync(join(tmpdir(), 'picky-e2e-'));
      const context = await chromium.launchPersistentContext(userData, {
        channel: 'chromium',
        headless: true,
        acceptDownloads: true,
        viewport: { width: 1000, height: 800 },
        args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
      });

      let sw;
      for (let i = 0; !sw && i < 50; i++) {
        for (const w of context.serviceWorkers()) {
          if (await w.evaluate(() => typeof downloadImage === 'function').catch(() => false)) sw = w;
        }
        if (!sw) await new Promise((r) => setTimeout(r, 200));
      }
      if (!sw) throw new Error("Le service worker de l'extension n'a pas démarré.");

      // Espionne le nom de fichier demandé (Playwright renomme les fichiers téléchargés).
      await sw.evaluate(() => {
        const download = chrome.downloads.download.bind(chrome.downloads);
        chrome.downloads.download = (opts) => {
          self.__lastName = opts.filename ?? '(natif)';
          return download(opts);
        };
      });

      const page = await context.newPage();
      await page.goto(servers.origin);
      await page.waitForLoadState('networkidle');

      await use({ sw, page, origin: servers.origin });
      await context.close();
      servers.close();
      rmSync(userData, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],
});

// Clic droit à (x, y) puis choix d'un format, comme dans le menu.
async function grab({ sw, page, origin }, x, y, format) {
  await page.mouse.click(x, y, { button: 'right' });
  return sw.evaluate(
    async ({ format, origin }) => {
      const [tab] = await chrome.tabs.query({ url: origin + '/*' });
      try {
        await downloadImage({ frameId: 0, menuItemId: format }, tab, format);
      } catch (e) {
        return { error: e.message };
      }
      for (let i = 0; i < 100; i++) {
        const [d] = await chrome.downloads.search({ orderBy: ['-startTime'], limit: 1 });
        if (d?.state === 'complete') return { file: d.filename, name: self.__lastName };
        if (d?.state === 'interrupted') return { error: 'téléchargement interrompu : ' + d.error };
        await new Promise((r) => setTimeout(r, 100));
      }
      return { error: 'délai dépassé' };
    },
    { format, origin }
  );
}

const cases = [
  ['AVIF sous un calque transparent → PNG', 100, 75, 'png', 'photo.png', 'png'],
  ['AVIF sous un calque transparent → format d’origine', 100, 75, 'original', 'photo.avif', 'avif'],
  ['fond CSS en WebP → JPG', 320, 75, 'jpg', 'fond.jpg', 'jpg'],
  ['SVG inline → PNG', 540, 75, 'png', 'image.png', 'png'],
  ['image blob: → WebP', 100, 275, 'webp', 'image.webp', 'webp'],
  ['canvas → format d’origine', 320, 275, 'original', 'image.png', 'png'],
  ['image d’un autre domaine sans CORS → PNG', 540, 275, 'png', 'cross.png', 'png'],
  ['image protégée par le Referer → format d’origine', 100, 475, 'original', 'protege.png', 'png'],
];

for (const [label, x, y, format, name, expected] of cases) {
  test(label, async ({ shared }) => {
    const result = await grab(shared, x, y, format);
    expect(result.error).toBeUndefined();
    expect(result.name).toBe(name);
    expect(inspect(result.file).format).toBe(expected);
  });
}

test('un SVG est rastérisé en bonne définition', async ({ shared }) => {
  const result = await grab(shared, 540, 75, 'png');
  expect(inspect(result.file)).toMatchObject({ width: 1024, height: 768 });
});

test('zone sans image → message clair', async ({ shared }) => {
  const result = await grab(shared, 700, 600, 'png');
  expect(result.error).toContain('aucune image');
});
