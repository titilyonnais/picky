// Partagé entre le service worker et le popup.

const DEFAULT_SETTINGS = {
  preferred: 'png', // format de l'Alt + clic et de « Enregistrer sous… »
  quality: 92, // qualité JPG / WebP, en %
  saveAs: false, // toujours demander où enregistrer
  naming: 'original', // original | date | site
  altClick: true,
  confirm: true, // message de confirmation après un téléchargement
};

const FORMAT_NAMES = { png: 'PNG', jpg: 'JPG', webp: 'WebP', original: 'Tel quel' };

async function getSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}
