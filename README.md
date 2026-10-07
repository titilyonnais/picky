# Picky

Clic droit sur n'importe quelle image, sur n'importe quel site, et tu la télécharges dans le
format que tu veux : **PNG**, **JPG**, **WebP**, ou **telle quelle**.

Extension Chromium (Manifest V3) : Brave, Chrome, Edge, Opera…

## Pourquoi

Le « Enregistrer l'image sous… » du navigateur lâche souvent :

- l'image est cachée sous un calque transparent (Instagram et compagnie) ;
- c'est une image de fond CSS, un SVG, un canvas ou une image `blob:` ;
- le site bloque le téléchargement direct (anti-hotlink) ;
- l'image est en `.avif` ou `.webp` alors que tu veux un PNG ou un JPG.

Picky cherche l'image sous ton curseur, quelle que soit la façon dont elle est affichée, la
récupère et la convertit directement dans le navigateur. Rien n'est envoyé ailleurs.

## Formats

| Choix | Ce que tu obtiens |
| --- | --- |
| **PNG** | Qualité maximale, transparence gardée. |
| **JPG** | Fichier léger, zones transparentes remplies de blanc. |
| **WebP** | Fichier léger, transparence gardée. |
| **Format d'origine** | Le fichier exact envoyé par le site, sans conversion (seul choix qui garde un GIF animé). |

## Installation

1. Télécharge le code (**Code → Download ZIP**) et décompresse-le, ou clone le dépôt.
2. Ouvre `brave://extensions` (ou `chrome://extensions`).
3. Active le **Mode développeur** (en haut à droite).
4. Clique sur **Charger l'extension non empaquetée** et choisis le dossier **`src`**.

## Développement

```bash
npm install
npx playwright install chromium
npm test
```

Les tests chargent l'extension dans un vrai Chromium et vérifient chaque cas difficile :
AVIF sous un calque, fond CSS, SVG, `blob:`, canvas, image d'un autre domaine, image
protégée par le Referer.

Les icônes se régénèrent avec `npm run icons` (Windows, PowerShell 7).

## Licence

[MIT](LICENSE)
