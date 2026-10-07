// Trouve l'image située sous le curseur, même si elle est cachée sous un calque
// transparent, en fond CSS, en SVG, etc. Affiche aussi les messages de Picky.
(() => {
  if (window.__pickyInjected) return;
  window.__pickyInjected = true;

  let lastPoint = null;
  let altClick = true;

  chrome.storage.sync.get('settings', ({ settings }) => {
    if (settings && 'altClick' in settings) altClick = settings.altClick;
  });
  chrome.storage.onChanged.addListener((changes) => {
    const s = changes.settings?.newValue;
    if (s && 'altClick' in s) altClick = s.altClick;
  });

  // Dès l'appui sur le bouton droit, on annonce le format de l'image pour que le menu
  // affiche « Tel quel (AVIF) » (le menu peut s'ouvrir avant : c'est du mieux possible).
  window.addEventListener(
    'mousedown',
    (e) => {
      if (e.button !== 2) return;
      lastPoint = { x: e.clientX, y: e.clientY };
      const found = findAt(lastPoint);
      chrome.runtime.sendMessage({ type: 'peek', ext: found ? guessExt(found) : null }).catch(() => {});
    },
    true
  );

  window.addEventListener(
    'contextmenu',
    (e) => {
      lastPoint = { x: e.clientX, y: e.clientY };
    },
    true
  );

  window.addEventListener(
    'click',
    (e) => {
      if (!e.altKey || e.button !== 0 || !altClick) return;
      const point = { x: e.clientX, y: e.clientY };
      if (!findAt(point)) return;
      // Empêche aussi le « Alt + clic = télécharger le lien » du navigateur.
      e.preventDefault();
      e.stopPropagation();
      resolveAt(point).then((url) => url && chrome.runtime.sendMessage({ type: 'altClick', url }));
    },
    true
  );

  function deepElementsAt(x, y, root = document, seen = new Set()) {
    const out = [];
    for (const el of root.elementsFromPoint(x, y)) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (el.shadowRoot) out.push(...deepElementsAt(x, y, el.shadowRoot, seen));
      out.push(el);
    }
    return out;
  }

  function cssUrl(value) {
    if (!value || value === 'none') return null;
    const m = value.match(/url\(\s*(['"]?)(.*?)\1\s*\)/);
    return m ? m[2] : null;
  }


  // Renvoie { url } ou { canvas } ou { svg }, sans rien sérialiser (appelé à chaque clic droit).
  function imageFromElement(el) {
    const tag = el.tagName?.toLowerCase();

    if (tag === 'img' && (el.currentSrc || el.src)) return { url: el.currentSrc || el.src };
    if (tag === 'picture') {
      const img = el.querySelector('img');
      if (img) return { url: img.currentSrc || img.src };
    }
    if (tag === 'input' && el.type === 'image') return { url: el.src };
    if (tag === 'video' && el.poster) return { url: el.poster };
    if (tag === 'canvas' && el.width && el.height) return { canvas: el };
    if (tag === 'image' && el instanceof SVGElement) {
      const href = el.href?.baseVal || el.getAttribute('href');
      if (href) return { url: new URL(href, document.baseURI).href };
    }
    if (el instanceof SVGElement) {
      let svg = el.ownerSVGElement || el;
      while (svg.ownerSVGElement) svg = svg.ownerSVGElement;
      if (svg instanceof SVGSVGElement) return { svg };
    }

    for (const pseudo of [null, '::before', '::after']) {
      const url = cssUrl(getComputedStyle(el, pseudo).backgroundImage);
      if (url) return { url };
    }
    return null;
  }

  // Candidats du dessus vers le dessous (un canvas illisible laisse sa place au suivant).
  function candidatesAt(point) {
    if (!point) return [];
    return deepElementsAt(point.x, point.y).map(imageFromElement).filter(Boolean);
  }

  function findAt(point) {
    return candidatesAt(point)[0] ?? null;
  }

  async function resolveAt(point) {
    for (const found of candidatesAt(point)) {
      try {
        return await resolveUrl(found);
      } catch {
        // Canvas « tainted » : on passe au candidat d'en dessous.
      }
    }
    return null;
  }

  const KNOWN_EXT = { jpeg: 'jpg', jpg: 'jpg', png: 'png', gif: 'gif', webp: 'webp', avif: 'avif', svg: 'svg', bmp: 'bmp', ico: 'ico' };

  // Devine le format sans télécharger : type d'un data:, extension ou paramètre de l'adresse.
  function guessExt(found) {
    if (found.canvas) return 'png';
    if (found.svg) return 'svg';
    const url = found.url;
    const data = url.match(/^data:image\/([\w+.-]+)/i);
    if (data) return KNOWN_EXT[data[1].toLowerCase().replace('+xml', '')] ?? null;
    try {
      const u = new URL(url);
      const ext = u.pathname.match(/\.(\w{3,4})$/)?.[1]?.toLowerCase();
      if (KNOWN_EXT[ext]) return KNOWN_EXT[ext];
      const param = (u.searchParams.get('format') || u.searchParams.get('fm') || '').toLowerCase();
      return KNOWN_EXT[param] ?? null;
    } catch {
      return null;
    }
  }

  function svgToDataUrl(svg) {
    const clone = svg.cloneNode(true);
    const rect = svg.getBoundingClientRect();
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (!clone.getAttribute('width')) clone.setAttribute('width', Math.round(rect.width));
    if (!clone.getAttribute('height')) clone.setAttribute('height', Math.round(rect.height));
    const xml = new XMLSerializer().serializeToString(clone);
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  }

  // Transforme le résultat de findAt en adresse téléchargeable par l'extension.
  async function resolveUrl(found) {
    if (found.canvas) return found.canvas.toDataURL('image/png');
    if (found.svg) return svgToDataUrl(found.svg);
    if (found.url.startsWith('blob:')) {
      // Une adresse blob: n'existe que dans la page : on en fait un data:.
      return fetchAsDataUrl(found.url).catch(() => found.url);
    }
    return found.url;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  // Récupère l'image depuis la page elle-même (cookies, referer, URLs blob:).
  async function fetchAsDataUrl(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return blobToDataUrl(await res.blob());
  }

  // Toutes les images visibles de la page, pour l'onglet « Images de la page ».
  async function listImages() {
    const seen = new Map();
    const add = (url, width, height) => {
      if (!url || url.startsWith('about:') || seen.has(url)) return;
      if (width < 48 || height < 48) return; // icônes et pixels espions
      seen.set(url, { url, width: Math.round(width), height: Math.round(height) });
    };
    for (const img of document.images) {
      add(img.currentSrc || img.src, img.naturalWidth, img.naturalHeight);
    }
    for (const video of document.querySelectorAll('video[poster]')) {
      add(video.poster, video.clientWidth, video.clientHeight);
    }
    let scanned = 0;
    for (const el of document.querySelectorAll('body *')) {
      if (++scanned > 5000) break;
      const url = cssUrl(getComputedStyle(el).backgroundImage);
      if (url) add(url, el.clientWidth, el.clientHeight);
    }
    const list = [...seen.values()].slice(0, 300);
    for (const item of list) {
      if (item.url.startsWith('blob:')) item.url = await fetchAsDataUrl(item.url).catch(() => item.url);
    }
    return list;
  }

  const KB = 1024;
  function formatSize(bytes) {
    if (bytes == null) return '';
    if (bytes < KB) return bytes + ' o';
    if (bytes < KB * KB) return Math.round(bytes / KB) + ' Ko';
    return (bytes / KB / KB).toFixed(1).replace('.', ',') + ' Mo';
  }

  let currentToast = null;
  function toast({ ok, title, detail, downloadId }) {
    currentToast?.remove();
    const host = document.createElement('div');
    host.id = 'picky-toast';
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:16px;bottom:16px;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .box { font: 13px/1.4 system-ui, sans-serif; color: #f9fafb; background: ${ok ? '#111827' : '#b91c1c'};
               padding: 12px 14px; border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.35);
               max-width: 340px; display: flex; gap: 12px; align-items: center;
               animation: in .18s ease-out; }
        @keyframes in { from { opacity: 0; transform: translateY(8px); } }
        .text { min-width: 0; }
        .title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .detail { color: ${ok ? '#9ca3af' : '#fecaca'}; font-size: 12px; margin-top: 2px; }
        button { all: unset; cursor: pointer; font-weight: 600; color: #93c5fd; white-space: nowrap; }
        button:hover { text-decoration: underline; }
      </style>
      <div class="box">
        <div class="text"><div class="title"></div><div class="detail"></div></div>
      </div>`;
    root.querySelector('.title').textContent = title;
    root.querySelector('.detail').textContent = detail ?? '';
    if (!detail) root.querySelector('.detail').remove();
    if (downloadId != null) {
      const button = document.createElement('button');
      button.textContent = 'Afficher';
      button.title = 'Afficher dans le dossier';
      button.onclick = () => chrome.runtime.sendMessage({ type: 'showDownload', id: downloadId });
      root.querySelector('.box').appendChild(button);
    }
    document.documentElement.appendChild(host);
    currentToast = host;

    let timer;
    const arm = () => (timer = setTimeout(() => host.remove(), ok ? 5000 : 6000));
    host.addEventListener('mouseenter', () => clearTimeout(timer));
    host.addEventListener('mouseleave', arm);
    arm();
  }

  async function copyImage(dataUrl) {
    const blob = await (await fetch(dataUrl)).blob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'getTarget') {
      resolveAt(lastPoint).then(sendResponse, () => sendResponse(null));
      return true;
    }
    if (msg.type === 'pageFetch') {
      fetchAsDataUrl(msg.url).then(
        (dataUrl) => sendResponse({ dataUrl }),
        (err) => sendResponse({ error: String(err) })
      );
      return true;
    }
    if (msg.type === 'listImages') {
      listImages().then(sendResponse, () => sendResponse([]));
      return true;
    }
    if (msg.type === 'copy') {
      copyImage(msg.dataUrl).then(
        () => sendResponse({ ok: true }),
        (err) => sendResponse({ error: err.message || String(err) })
      );
      return true;
    }
    if (msg.type === 'toast') {
      toast({ ...msg, detail: msg.detail ?? formatDetail(msg.info) });
    }
  });

  function formatDetail(info) {
    if (!info) return null;
    const parts = [info.ext?.toUpperCase()];
    if (info.width) parts.push(`${info.width}×${info.height}`);
    if (info.size != null) parts.push(formatSize(info.size));
    return parts.filter(Boolean).join(' · ');
  }
})();
