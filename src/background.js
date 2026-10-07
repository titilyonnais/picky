const FORMATS = {
  png: 'en PNG',
  jpg: 'en JPG',
  webp: 'en WebP',
  original: "Format d'origine",
};

const CONTEXTS = ['page', 'image', 'link', 'video', 'audio', 'frame', 'selection', 'editable'];

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: 'dl', title: "Télécharger l'image", contexts: CONTEXTS });
  for (const [id, title] of Object.entries(FORMATS)) {
    chrome.contextMenus.create({ id, parentId: 'dl', title, contexts: CONTEXTS });
  }

  // Les onglets déjà ouverts n'ont pas encore le script : on l'injecte.
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file:///*'] });
  for (const tab of tabs) {
    chrome.scripting
      .executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content.js'] })
      .catch(() => {});
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const format = String(info.menuItemId);
  if (!(format in FORMATS)) return;
  try {
    await downloadImage(info, tab, format);
  } catch (err) {
    notify(tab, 'Téléchargement impossible : ' + (err.message || err));
  }
});

async function downloadImage(info, tab, format) {
  const frameId = info.frameId ?? 0;
  const url = await findTarget(info, tab, frameId);
  if (!url) throw new Error('aucune image trouvée à cet endroit.');

  const res = await processImage(url, format, tab, frameId);
  if (res.error) {
    // Dernier recours pour le format d'origine : le téléchargeur natif du navigateur.
    if (format === 'original' && /^https?:/.test(url)) {
      await chrome.downloads.download({ url, conflictAction: 'uniquify' });
      return;
    }
    throw new Error(res.error);
  }
  await save(res.blobUrl, baseName(url) + '.' + res.ext);
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

async function processImage(url, format, tab, frameId) {
  await ensureOffscreen();
  let res = await chrome.runtime.sendMessage({ target: 'offscreen', url, format });
  if (res?.error && /^https?:/.test(url) && tab?.id >= 0) {
    // Certains sites refusent les requêtes « extérieures » : on réessaie depuis la page.
    const page = await chrome.tabs
      .sendMessage(tab.id, { type: 'pageFetch', url }, { frameId })
      .catch(() => null);
    if (page?.dataUrl) {
      res = await chrome.runtime.sendMessage({ target: 'offscreen', url: page.dataUrl, format });
    }
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

async function save(url, filename) {
  try {
    await chrome.downloads.download({ url, filename, conflictAction: 'uniquify' });
  } catch {
    // Nom refusé par le système (nom réservé sous Windows, etc.).
    const ext = filename.split('.').pop();
    await chrome.downloads.download({ url, filename: 'image.' + ext, conflictAction: 'uniquify' });
  }
}

function notify(tab, text) {
  if (tab?.id >= 0) {
    chrome.tabs.sendMessage(tab.id, { type: 'toast', text }, { frameId: 0 }).catch(() => {});
  }
}
