// Mémorise l'image située sous le curseur au moment du clic droit,
// même si elle est cachée sous un calque transparent, en fond CSS, en SVG, etc.
(() => {
  if (window.__imgDlInjected) return;
  window.__imgDlInjected = true;

  let lastPoint = null;

  window.addEventListener(
    'contextmenu',
    (e) => {
      lastPoint = { x: e.clientX, y: e.clientY };
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

  function svgToDataUrl(svg) {
    const clone = svg.cloneNode(true);
    const rect = svg.getBoundingClientRect();
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (!clone.getAttribute('width')) clone.setAttribute('width', Math.round(rect.width));
    if (!clone.getAttribute('height')) clone.setAttribute('height', Math.round(rect.height));
    const xml = new XMLSerializer().serializeToString(clone);
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  }

  function imageFromElement(el) {
    const tag = el.tagName?.toLowerCase();

    if (tag === 'img') return el.currentSrc || el.src;
    if (tag === 'picture') {
      const img = el.querySelector('img');
      if (img) return img.currentSrc || img.src;
    }
    if (tag === 'input' && el.type === 'image') return el.src;
    if (tag === 'video' && el.poster) return el.poster;
    if (tag === 'canvas') {
      try {
        return el.toDataURL('image/png');
      } catch {
        // Canvas « tainted » : on continue à chercher en dessous.
      }
    }
    if (tag === 'image' && el instanceof SVGElement) {
      const href = el.href?.baseVal || el.getAttribute('href');
      if (href) return new URL(href, document.baseURI).href;
    }
    if (el instanceof SVGElement) {
      let svg = el.ownerSVGElement || el;
      while (svg.ownerSVGElement) svg = svg.ownerSVGElement;
      if (svg instanceof SVGSVGElement) return svgToDataUrl(svg);
    }

    for (const pseudo of [null, '::before', '::after']) {
      const url = cssUrl(getComputedStyle(el, pseudo).backgroundImage);
      if (url) return url;
    }
    return null;
  }

  function findImage() {
    if (!lastPoint) return null;
    for (const el of deepElementsAt(lastPoint.x, lastPoint.y)) {
      const url = imageFromElement(el);
      if (url) return url;
    }
    return null;
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

  function toast(text) {
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:16px;bottom:16px;';
    const box = document.createElement('div');
    box.textContent = text;
    box.style.cssText =
      'font:14px/1.4 system-ui,sans-serif;color:#fff;background:#b91c1c;padding:10px 14px;' +
      'border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:360px;';
    host.attachShadow({ mode: 'closed' }).appendChild(box);
    document.documentElement.appendChild(host);
    setTimeout(() => host.remove(), 4000);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'getTarget') {
      const url = findImage();
      if (url?.startsWith('blob:')) {
        fetchAsDataUrl(url).then(sendResponse, () => sendResponse(url));
        return true;
      }
      sendResponse(url);
    } else if (msg.type === 'pageFetch') {
      fetchAsDataUrl(msg.url).then(
        (dataUrl) => sendResponse({ dataUrl }),
        (err) => sendResponse({ error: String(err) })
      );
      return true;
    } else if (msg.type === 'toast') {
      toast(msg.text);
    }
  });
})();
