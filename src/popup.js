const $ = (sel) => document.querySelector(sel);

// --- Onglets (le dernier ouvert est retenu)
const tabs = document.querySelectorAll('nav button');
function openTab(name) {
  for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.tab === name));
  for (const s of document.querySelectorAll('section')) s.hidden = s.id !== name;
  try {
    localStorage.setItem('tab', name);
  } catch {}
  if (name === 'page') loadPageImages();
}
for (const t of tabs) t.addEventListener('click', () => openTab(t.dataset.tab));

// --- Utilitaires
function formatSize(bytes) {
  if (bytes == null) return null;
  if (bytes < 1024) return bytes + ' o';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' Ko';
  return (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' Mo';
}

function timeAgo(date) {
  const s = Math.round((Date.now() - date) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  const days = Math.floor(s / 86400);
  return days === 1 ? 'hier' : `il y a ${days} jours`;
}

function hostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// --- Historique
async function renderHistory() {
  const { history = [] } = await chrome.storage.local.get('history');
  const list = $('#history-list');
  list.replaceChildren();
  $('#history-empty').hidden = history.length > 0;
  $('#history-footer').hidden = history.length === 0;

  const items = await Promise.all(
    history.map((e) => chrome.downloads.search({ id: e.id }).then(([d]) => d).catch(() => null))
  );

  history.forEach((entry, i) => {
    const li = $('#history-item').content.firstElementChild.cloneNode(true);
    const exists = items[i]?.exists && items[i]?.state === 'complete';
    li.classList.toggle('gone', !exists);
    if (entry.thumb) li.querySelector('.thumb').src = entry.thumb;
    li.querySelector('.name').textContent = entry.name;
    li.querySelector('.name').title = entry.name;
    const dims = entry.width ? `${entry.width}×${entry.height}` : null;
    li.querySelector('.meta').textContent = [entry.ext?.toUpperCase(), dims, formatSize(entry.size)]
      .filter(Boolean)
      .join(' · ');
    li.querySelector('.sub').textContent = [
      exists ? null : 'fichier supprimé ou déplacé',
      hostname(entry.page),
      timeAgo(entry.date),
    ]
      .filter(Boolean)
      .join(' · ');

    const show = li.querySelector('.show');
    show.disabled = !exists;
    show.addEventListener('click', () => chrome.downloads.show(entry.id));

    const again = li.querySelector('.again');
    const formats = li.querySelector('.formats');
    again.disabled = !entry.src;
    if (!entry.src) again.title = "Image intégrée à la page : impossible de la retrouver";
    again.addEventListener('click', () => (formats.hidden = !formats.hidden));
    for (const b of formats.querySelectorAll('button')) {
      b.addEventListener('click', async () => {
        formats.querySelector('span').textContent = 'Téléchargement…';
        const res = await chrome.runtime.sendMessage({
          type: 'redownload',
          url: entry.src,
          format: b.dataset.format,
          pageUrl: entry.page,
        });
        if (res?.error) formats.querySelector('span').textContent = 'Échec : ' + res.error;
      });
    }
    list.appendChild(li);
  });
}

$('#history-clear').addEventListener('click', () => chrome.storage.local.set({ history: [] }));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.history) renderHistory();
});

// --- Images de la page
let pageTab = null;
let pageLoaded = false;
const selected = new Set();

async function loadPageImages() {
  if (pageLoaded) return;
  pageLoaded = true;
  const forced = Number(new URLSearchParams(location.search).get('tab')); // pour les tests
  pageTab = forced
    ? await chrome.tabs.get(forced)
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

  let images = null;
  try {
    images = await chrome.tabs.sendMessage(pageTab.id, { type: 'listImages' }, { frameId: 0 });
  } catch {
    // Page interne du navigateur, ou onglet ouvert avant l'installation.
  }

  const empty = $('#page-empty');
  if (!images) {
    $('#page-count').textContent = '';
    empty.textContent = "Picky ne peut pas lire cette page. Si c'est un site normal, recharge-la.";
    empty.hidden = false;
    return;
  }
  if (images.length === 0) {
    $('#page-count').textContent = '';
    empty.textContent = 'Aucune image sur cette page.';
    empty.hidden = false;
    return;
  }

  $('#page-count').textContent = `${images.length} image${images.length > 1 ? 's' : ''}`;
  $('#page-all-label').hidden = false;
  $('#page-actions').hidden = false;
  const grid = $('#page-grid');
  for (const image of images) {
    const tile = document.createElement('button');
    tile.className = 'tile';
    tile.setAttribute('aria-pressed', 'false');
    tile.title = image.url.startsWith('data:') ? 'Image intégrée' : image.url;
    const img = document.createElement('img');
    img.src = image.url;
    img.loading = 'lazy';
    img.alt = '';
    // Site qui bloque l'aperçu : le téléchargement passera quand même par la page.
    img.onerror = () => {
      const note = document.createElement('span');
      note.className = 'noprev';
      note.textContent = 'Aperçu indisponible';
      img.replaceWith(note);
    };
    const dims = document.createElement('span');
    dims.className = 'dims';
    dims.textContent = `${image.width}×${image.height}`;
    const tick = document.createElement('span');
    tick.className = 'tick';
    tile.append(img, dims, tick);
    tile.addEventListener('click', () => {
      if (selected.has(image.url)) selected.delete(image.url);
      else selected.add(image.url);
      tile.setAttribute('aria-pressed', String(selected.has(image.url)));
      updateSelection(images.length);
    });
    tile.dataset.url = image.url;
    grid.appendChild(tile);
  }

  $('#page-all').addEventListener('change', (e) => {
    selected.clear();
    for (const tile of grid.children) {
      if (e.target.checked) selected.add(tile.dataset.url);
      tile.setAttribute('aria-pressed', String(e.target.checked));
    }
    updateSelection(images.length);
  });
}

function updateSelection(total) {
  const n = selected.size;
  const button = $('#page-download');
  button.disabled = n === 0;
  button.textContent = n === 0 ? 'Télécharger' : `Télécharger ${n} image${n > 1 ? 's' : ''}`;
  $('#page-all').checked = n === total;
  $('#page-all').indeterminate = n > 0 && n < total;
}

$('#page-download').addEventListener('click', async () => {
  const button = $('#page-download');
  const status = $('#page-status');
  const urls = [...selected];
  button.disabled = true;
  status.hidden = false;
  status.textContent = `Téléchargement de ${urls.length} image${urls.length > 1 ? 's' : ''}…`;
  const { ok, failed } = await chrome.runtime.sendMessage({
    type: 'bulk',
    urls,
    format: $('#page-format').value,
    tabId: pageTab.id,
  });
  status.textContent =
    `✓ ${ok} image${ok > 1 ? 's' : ''} téléchargée${ok > 1 ? 's' : ''}` +
    (failed ? ` · ${failed} impossible${failed > 1 ? 's' : ''} à récupérer` : '');
  button.disabled = false;
});

// --- Réglages (enregistrés à chaque changement)
async function saveSetting(key, value) {
  const settings = await getSettings();
  settings[key] = value;
  await chrome.storage.sync.set({ settings });
}

async function renderSettings() {
  const s = await getSettings();
  $('#page-format').value = s.preferred;

  for (const b of document.querySelectorAll('#set-preferred button')) {
    b.setAttribute('aria-pressed', String(b.dataset.value === s.preferred));
    b.onclick = async () => {
      await saveSetting('preferred', b.dataset.value);
      renderSettings();
    };
  }

  const quality = $('#set-quality');
  quality.value = s.quality;
  $('#set-quality-value').textContent = s.quality + ' %';
  quality.oninput = () => ($('#set-quality-value').textContent = quality.value + ' %');
  quality.onchange = () => saveSetting('quality', Number(quality.value));

  $('#set-naming').value = s.naming;
  $('#set-naming').onchange = (e) => saveSetting('naming', e.target.value);

  for (const key of ['saveAs', 'altClick', 'confirm']) {
    const box = $('#set-' + key);
    box.checked = s[key];
    box.onchange = () => saveSetting(key, box.checked);
  }
}

// --- Démarrage
renderHistory();
renderSettings();
let initial = 'history';
try {
  initial = localStorage.getItem('tab') || 'history';
} catch {}
openTab(initial);
