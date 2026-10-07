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
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function convert(blob, mime, format) {
  let bitmap;
  try {
    bitmap = await decode(blob, mime);
  } catch {
    throw new Error("Ce fichier n'est pas une image lisible.");
  }
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (format === 'jpg') {
    // Le JPG ne gère pas la transparence : fond blanc plutôt que noir.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return canvas.convertToBlob({ type: MIME[format], quality: 0.92 });
}

async function process(url, format) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const blob = await res.blob();
  const mime = await sniffMime(blob);

  if (format === 'original') {
    const ext = EXT_BY_MIME[mime];
    if (!ext) throw new Error("Ce fichier n'est pas une image reconnue.");
    return { blob, ext };
  }
  return { blob: await convert(blob, mime, format), ext: format };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;
  process(msg.url, msg.format).then(
    ({ blob, ext }) => {
      const blobUrl = URL.createObjectURL(blob);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5 * 60 * 1000);
      sendResponse({ blobUrl, ext });
    },
    (err) => sendResponse({ error: err.message || String(err) })
  );
  return true;
});
