importScripts('shared.js');

const CONTEXTS = ['page', 'image', 'link', 'video', 'audio', 'frame', 'selection', 'editable'];
const CONVERSIONS = {
  png: 'PNG — qualité maximale, garde la transparence',
  jpg: 'JPG — fichier léger, fond blanc',
  webp: 'WebP — léger, garde la transparence',
};
const originalTitle = (ext) =>
  `Tel quel${ext ? ` (${ext.toUpperCase()})` : ''} — le fichier du site, sans conversion`;
const saveAsTitle = (format) => `Enregistrer sous… (${FORMAT_NAMES[format]})`;

async function createMenus() {
  await chrome.contextMenus.removeAll();
  const { preferred } = await getSettings();
  const add = (props) => chrome.contextMenus.create({ contexts: CONTEXTS, ...props });
  add({ id: 'picky', title: "Picky — télécharger l'image" });
  for (const [id, title] of Object.entries(CONVERSIONS)) add({ id, parentId: 'picky', title });
  add({ id: 'original', parentId: 'picky', title: originalTitle(null) });
  add({ id: 'sep', parentId: 'picky', type: 'separator' });
  add({ id: 'saveas', parentId: 'picky', title: saveAsTitle(preferred) });
  add({ id: 'copy', parentId: 'picky', title: "Copier l'image" });
}

chrome.runtime.onInstalled.addListener(async () => {
  await createMenus();

  // Les onglets déjà ouverts n'ont pas encore le script : on l'injecte.
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file:///*'] });
  for (const tab of tabs) {
    chrome.scripting
      .executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content.js'] })
      .catch(() => {});
  }
});

chrome.storage.onChanged.addListener((changes) => {
  const preferred = changes.settings?.newValue?.preferred;
  if (preferred) chrome.contextMenus.update('saveas', { title: saveAsTitle(preferred) }).catch(() => {});
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const id = String(info.menuItemId);
  try {
    if (id === 'copy') return await copyImage(info, tab);
    if (id === 'saveas') {
      const { preferred } = await getSettings();
      return await downloadImage(info, tab, preferred, { saveAs: true });
    }
    if (id in CONVERSIONS || id === 'original') await downloadImage(info, tab, id);
  } catch (err) {
    notifyError(tab, err);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'peek') {
    chrome.contextMenus.update('original', { title: originalTitle(msg.ext) }).catch(() => {});
  } else if (msg.type === 'altClick') {
    getSettings()
      .then(({ preferred }) =>
        grab({ url: msg.url, format: preferred, tab: sender.tab, frameId: sender.frameId })
      )
      .catch((err) => notifyError(sender.tab, err));
  } else if (msg.type === 'showDownload') {
    chrome.downloads.show(msg.id);
  } else if (msg.type === 'bulk') {
    bulkDownload(msg).then(sendResponse);
    return true;
  } else if (msg.type === 'redownload') {
    grab({ url: msg.url, format: msg.format, pageUrl: msg.pageUrl, silent: true }).then(
      () => sendResponse({ ok: true }),
      (err) => sendResponse({ error: err.message || String(err) })
    );
    return true;
  }
});

async function downloadImage(info, tab, format, { saveAs } = {}) {
  const frameId = info.frameId ?? 0;
  const url = await findTarget(info, tab, frameId);
  if (!url) throw new Error('aucune image trouvée à cet endroit.');
  return grab({ url, format, tab, frameId, saveAs });
}

// Récupère, convertit, enregistre, note dans l'historique et confirme.
async function grab({ url, format, tab, frameId = 0, saveAs, silent, pageUrl = tab?.url }) {
  const settings = await getSettings();
  saveAs ??= settings.saveAs;
  const res = await processImage(url, format, tab, frameId, { quality: settings.quality / 100 });

  let downloadId;
  let info = res.info;
  if (res.error) {
    // Dernier recours pour le format d'origine : le téléchargeur natif du navigateur.
    if (format !== 'original' || !/^https?:/.test(url)) throw new Error(res.error);
    downloadId = await chrome.downloads.download({ url, saveAs, conflictAction: 'uniquify' });
    info = {};
  } else {
    downloadId = await save(res.blobUrl, makeName(url, info.ext, settings.naming, pageUrl), saveAs);
  }
  if (downloadId == null) return null;

  const item = await waitForDownload(downloadId);
  if (item.state !== 'complete') {
    if (item.error === 'USER_CANCELED') return null;
    throw new Error(`le téléchargement a été interrompu (${item.error}).`);
  }
  const name = item.filename.split(/[\\/]/).pop();
  info.ext ??= name.split('.').pop().toLowerCase();
  info.size ??= item.fileSize;

  await addHistory({
    id: downloadId,
    name,
    ...info,
    src: /^https?:/.test(url) ? url : null,
    page: pageUrl ?? null,
    date: Date.now(),
  });
  if (!silent && settings.confirm) {
    notify(tab, { ok: true, title: `✓ ${name}`, info, downloadId });
  }
  return { downloadId, name };
}

async function copyImage(info, tab) {
  const frameId = info.frameId ?? 0;
  const url = await findTarget(info, tab, frameId);
  if (!url) throw new Error('aucune image trouvée à cet endroit.');
  const res = await processImage(url, 'png', tab, frameId, { as: 'dataUrl' });
  if (res.error) throw new Error(res.error);
  const copied = await chrome.tabs
    .sendMessage(tab.id, { type: 'copy', dataUrl: res.dataUrl }, { frameId })
    .catch((err) => ({ error: err.message }));
  if (copied?.error) throw new Error("le navigateur a refusé l'accès au presse-papiers.");
  notify(tab, { ok: true, title: '✓ Image copiée', info: { ...res.info, size: null } });
}

async function bulkDownload({ urls, format, tabId }) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  let ok = 0;
  for (const url of urls) {
    try {
      if (await grab({ url, format, tab, saveAs: false, silent: true })) ok++;
    } catch {
      // On compte les échecs sans arrêter le lot.
    }
  }
  return { ok, failed: urls.length - ok };
}

async function findTarget(info, tab, frameId) {
  if (tab?.id >= 0) {
    try {
      const url = await chrome.tabs.sendMessage(tab.id, { type: 'getTarget' }, { frameId });
      if (url) return url;
    } catch {
      // Page où le script ne tourne pas (chrome://, boutique d'extensions…).
    }
  }
  return info.srcUrl || null;
}

async function processImage(url, format, tab, frameId, options = {}) {
  await ensureOffscreen();
  const ask = (u) => chrome.runtime.sendMessage({ target: 'offscreen', url: u, format, ...options });
  let res = await ask(url);
  if (res?.error && /^https?:/.test(url) && tab?.id >= 0) {
    // Certains sites refusent les requêtes « extérieures » : on réessaie depuis la page.
    const page = await chrome.tabs
      .sendMessage(tab.id, { type: 'pageFetch', url }, { frameId })
      .catch(() => null);
    if (page?.dataUrl) res = await ask(page.dataUrl);
  }
  return res || { error: 'erreur inconnue.' };
}

let creatingOffscreen = null;
async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length) return;
  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Décoder et convertir les images avant de les télécharger.',
    })
    .finally(() => (creatingOffscreen = null));
  await creatingOffscreen;
}

function baseName(url) {
  if (!/^(https?|file):/.test(url)) return 'image';
  try {
    const segment = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    const name = decodeURIComponent(segment)
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_')
      .replace(/^[.\s_]+|[.\s_]+$/g, '')
      .slice(0, 100);
    return name || 'image';
  } catch {
    return 'image';
  }
}

function makeName(url, ext, naming, pageUrl) {
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date();
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  let name = baseName(url);
  if (naming === 'date') name = `${name} ${date}`;
  if (naming === 'site') {
    let site = '';
    try {
      site = new URL(pageUrl).hostname.replace(/^www\./, '');
    } catch {}
    name = `${site || name} ${date}`;
  }
  return `${name}.${ext}`;
}

async function save(url, filename, saveAs) {
  try {
    return await chrome.downloads.download({ url, filename, saveAs, conflictAction: 'uniquify' });
  } catch (err) {
    if (!/filename/i.test(err.message)) throw err;
    // Nom refusé par le système (nom réservé sous Windows, etc.).
    const ext = filename.split('.').pop();
    return chrome.downloads.download({ url, filename: 'image.' + ext, saveAs, conflictAction: 'uniquify' });
  }
}

function waitForDownload(id) {
  return new Promise((resolve) => {
    const finish = (item) => {
      if (item?.state !== 'complete' && item?.state !== 'interrupted') return;
      chrome.downloads.onChanged.removeListener(onChanged);
      resolve(item);
    };
    const onChanged = async (delta) => {
      if (delta.id === id && delta.state) finish((await chrome.downloads.search({ id }))[0]);
    };
    chrome.downloads.onChanged.addListener(onChanged);
    chrome.downloads.search({ id }).then(([item]) => finish(item));
  });
}

async function addHistory(entry) {
  const { history = [] } = await chrome.storage.local.get('history');
  history.unshift(entry);
  await chrome.storage.local.set({ history: history.slice(0, 20) });
}

function notify(tab, payload) {
  if (tab?.id >= 0) {
    chrome.tabs.sendMessage(tab.id, { type: 'toast', ...payload }, { frameId: 0 }).catch(() => {});
  }
}

function notifyError(tab, err) {
  const reason = String(err?.message || err);
  notify(tab, {
    ok: false,
    title: "Picky n'a pas pu récupérer l'image",
    detail: reason.charAt(0).toUpperCase() + reason.slice(1),
  });
}
