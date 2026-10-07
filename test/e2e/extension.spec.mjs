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
          self.__names = [...(self.__names ?? []), self.__lastName];
          return download(opts);
        };
      });

      const page = await context.newPage();
      await page.goto(servers.origin);
      await page.waitForLoadState('networkidle');

      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: servers.origin });
      const extId = new URL(sw.url()).host;
      await use({ sw, page, context, extId, origin: servers.origin });
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

// --- Version 1.1 : confirmation, historique, réglages, Alt + clic, copie, popup

const history = (sw) => sw.evaluate(async () => (await chrome.storage.local.get('history')).history ?? []);
const setSettings = (sw, values) =>
  sw.evaluate(async (values) => {
    const { settings = {} } = await chrome.storage.sync.get('settings');
    await chrome.storage.sync.set({ settings: { ...settings, ...values } });
  }, values);

async function altClick(page, x, y) {
  await page.keyboard.down('Alt');
  await page.mouse.click(x, y);
  await page.keyboard.up('Alt');
}

async function toastText(page) {
  const toast = page.locator('#picky-toast');
  await expect(toast).toBeVisible();
  return toast.evaluate((host) => host.shadowRoot.querySelector('.box').textContent.replace(/\s+/g, ' '));
}

test('confirmation avec le nom, le format, les dimensions et le poids', async ({ shared }) => {
  const result = await grab(shared, 100, 75, 'png');
  const text = await toastText(shared.page);
  // Le message affiche le nom réel sur le disque (Playwright le remplace par un identifiant).
  expect(text).toContain('✓ ' + result.file.split(/[\\/]/).pop());
  expect(text).toMatch(/PNG · 300×200 · \d+ (o|Ko)/);
  expect(text).toContain('Afficher');
});

test('chaque téléchargement est noté dans l’historique, avec une miniature', async ({ shared }) => {
  await grab(shared, 320, 75, 'webp');
  const [last] = await history(shared.sw);
  expect(last).toMatchObject({ ext: 'webp', width: 300, height: 200 });
  expect(last.thumb).toMatch(/^data:image\/jpeg/);
  expect(last.src).toBe(shared.origin + '/fond.webp');
  expect(last.page).toBe(shared.origin + '/');
});

test('réglage « Site + date » pour le nom des fichiers', async ({ shared }) => {
  await setSettings(shared.sw, { naming: 'site' });
  const result = await grab(shared, 100, 75, 'png');
  await setSettings(shared.sw, { naming: 'original' });
  expect(result.name).toMatch(/^localhost \d{4}-\d\d-\d\d \d\d-\d\d-\d\d\.png$/);
});

test('Alt + clic télécharge au format préféré', async ({ shared }) => {
  await setSettings(shared.sw, { preferred: 'jpg' });
  const before = (await history(shared.sw)).length;
  await altClick(shared.page, 320, 75);
  await expect.poll(async () => (await history(shared.sw)).length).toBeGreaterThan(Math.min(before, 19));
  const [last] = await history(shared.sw);
  await setSettings(shared.sw, { preferred: 'png' });
  expect(last.ext).toBe('jpg');
  expect(await shared.sw.evaluate(() => self.__lastName)).toBe('fond.jpg');
});

test('Alt + clic désactivé dans les réglages : rien ne se passe', async ({ shared }) => {
  await setSettings(shared.sw, { altClick: false });
  await shared.page.waitForTimeout(200);
  const before = await shared.sw.evaluate(() => (self.__names ?? []).length);
  await altClick(shared.page, 320, 75);
  await shared.page.waitForTimeout(1500);
  await setSettings(shared.sw, { altClick: true });
  expect(await shared.sw.evaluate(() => (self.__names ?? []).length)).toBe(before);
});

test('Copier l’image met un PNG dans le presse-papiers', async ({ shared }) => {
  await shared.page.mouse.click(100, 75, { button: 'right' });
  const error = await shared.sw.evaluate(async (origin) => {
    const [tab] = await chrome.tabs.query({ url: origin + '/*' });
    try {
      await copyImage({ frameId: 0 }, tab);
    } catch (e) {
      return e.message;
    }
  }, shared.origin);
  expect(error).toBeUndefined();
  const types = await shared.page.evaluate(async () => (await navigator.clipboard.read())[0].types);
  expect(types).toContain('image/png');
  expect(await toastText(shared.page)).toContain('Image copiée');
});

test('popup : historique, images de la page et téléchargement en lot', async ({ shared }) => {
  const tabId = await shared.sw.evaluate(
    async (origin) => (await chrome.tabs.query({ url: origin + '/*' }))[0].id,
    shared.origin
  );
  const popup = await shared.context.newPage();
  await popup.setViewportSize({ width: 360, height: 580 });
  await popup.goto(`chrome-extension://${shared.extId}/popup.html?tab=${tabId}`);

  await popup.getByRole('tab', { name: 'Historique' }).click();
  await expect(popup.locator('#history-list .item').first()).toBeVisible();
  await expect(popup.locator('#history-list .item').first().locator('.meta').first()).toHaveText(/JPG · 300×200/);

  await popup.getByRole('tab', { name: 'Cette page' }).click();
  // AVIF, fond CSS, blob:, autre domaine, image protégée (le SVG et le canvas ne sont pas listés).
  await expect(popup.locator('#page-count')).toHaveText('5 images');
  const before = await shared.sw.evaluate(() => (self.__names ?? []).length);
  await popup.locator('.tile').nth(0).click();
  await popup.locator('.tile').nth(1).click();
  await expect(popup.locator('#page-download')).toHaveText('Télécharger 2 images');
  await popup.locator('#page-format').selectOption('webp');
  await popup.locator('#page-download').click();
  await expect(popup.locator('#page-status')).toHaveText('✓ 2 images téléchargées');
  const names = await shared.sw.evaluate(() => self.__names);
  expect(names.slice(before)).toEqual(['photo.webp', 'image.webp']);
  await popup.close();
});
