// Document caché : télécharge l'image (sans restriction CORS grâce aux
// host_permissions), la décode et la ré-encode dans le format demandé.

const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
const EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/tiff': 'tiff',
  'image/heic': 'heic',
  'image/jxl': 'jxl',
};

async function sniffMime(blob) {
  const b = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
  const ascii = (start, end) => String.fromCharCode(...b.slice(start, end));
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 3) === 'GIF') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (brand.startsWith('hei') || brand.startsWith('mif')) return 'image/heic';
  }
  if (ascii(0, 2) === 'BM') return 'image/bmp';
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'image/x-icon';
  const head = new TextDecoder().decode(await blob.slice(0, 1024).arrayBuffer());
  if (/<svg[\s>]/i.test(head)) return 'image/svg+xml';
  return blob.type.split(';')[0] || '';
}

async function decode(blob, mime) {
  if (mime !== 'image/svg+xml') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Format que createImageBitmap ne sait pas lire : on tente via <img>.
    }
  }
  const typed = mime ? new Blob([blob], { type: mime }) : blob;
  const url = URL.createObjectURL(typed);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    let w = img.naturalWidth || 1024;
    let h = img.naturalHeight || 1024;
    // Un SVG est vectoriel : on le rastérise en bonne définition.
    if (mime === 'image/svg+xml' && Math.max(w, h) < 1024) {
      const scale = 1024 / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    const out = canvas(w, h);
    out.getContext('2d').drawImage(img, 0, 0, w, h);
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Encodage synchrone avec toDataURL : convertToBlob est asynchrone et Chrome ralentit
// les tâches des documents cachés (environ 1 s de perdue par image).
function canvas(width, height) {
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  return el;
}

function dataUrlToBlob(dataUrl) {
  const [head, base64] = dataUrl.split(',');
  const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
  return new Blob([bytes], { type: head.slice(5, head.indexOf(';')) });
}

function draw(source, format) {
  const out = canvas(source.width, source.height);
  const ctx = out.getContext('2d');
  if (format === 'jpg') {
    // Le JPG ne gère pas la transparence : fond blanc plutôt que noir.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out.width, out.height);
  }
  ctx.drawImage(source, 0, 0);
  return out;
}

// Petite miniature JPEG pour l'historique.
function thumbnail(source) {
  const scale = Math.min(1, 96 / Math.max(source.width, source.height));
  const thumb = canvas(Math.max(1, Math.round(source.width * scale)), Math.max(1, Math.round(source.height * scale)));
  const ctx = thumb.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, thumb.width, thumb.height);
  ctx.drawImage(source, 0, 0, thumb.width, thumb.height);
  return thumb.toDataURL('image/jpeg', 0.7);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function process({ url, format, quality = 0.92 }) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`le site a refusé (erreur ${res.status}).`);
  const blob = await res.blob();
  const mime = await sniffMime(blob);

  let source = null;
  try {
    source = await decode(blob, mime);
  } catch {
    if (format !== 'original') throw new Error("ce fichier n'est pas une image lisible.");
  }

  let out = blob;
  let ext = format;
  if (format === 'original') {
    ext = EXT_BY_MIME[mime];
    if (!ext) throw new Error("ce fichier n'est pas une image reconnue.");
  } else {
    out = dataUrlToBlob(draw(source, format).toDataURL(MIME[format], quality));
  }

  const info = { ext, size: out.size };
  // Un SVG gardé tel quel n'a pas de taille en pixels.
  if (source && !(format === 'original' && ext === 'svg')) {
    info.width = source.width;
    info.height = source.height;
  }
    if (source) {
    try {
      info.thumb = thumbnail(source);
    } catch {}
  }
  source?.close?.();
  return { blob: out, info };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;
  process(msg).then(
    async ({ blob, info }) => {
      if (msg.as === 'dataUrl') return sendResponse({ dataUrl: await blobToDataUrl(blob), info });
      const blobUrl = URL.createObjectURL(blob);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5 * 60 * 1000);
      sendResponse({ blobUrl, info });
    },
    (err) => sendResponse({ error: err.message || String(err) })
  );
  return true;
});