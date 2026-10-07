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

## Clic droit → Picky

| Choix | Ce que tu obtiens |
| --- | --- |
| **PNG** | Qualité maximale, transparence gardée. |
| **JPG** | Fichier léger, zones transparentes remplies de blanc. |
| **WebP** | Fichier léger, transparence gardée. |
| **Tel quel (AVIF)** | Le fichier exact envoyé par le site, sans conversion. Le format réel s'affiche entre parenthèses quand Picky peut le deviner. C'est le seul choix qui garde un GIF animé. |
| **Enregistrer sous…** | Choisis le nom et le dossier (dans ton format préféré). |
| **Copier l'image** | Dans le presse-papiers, prête à coller (Discord, Word…). |

Après chaque téléchargement, un petit message confirme le nom, le format, les dimensions et le
poids du fichier, avec un bouton **Afficher** qui ouvre le dossier.

**Raccourci :** <kbd>Alt</kbd> + clic sur une image la télécharge directement dans ton format
préféré.

## Le menu de l'icône

- **Historique** : les 20 derniers téléchargements, avec miniature, format, dimensions, poids et
  site d'origine. On peut ouvrir le dossier ou retélécharger dans un autre format.
- **Cette page** : toutes les images de l'onglet en grille ; coche celles que tu veux et
  télécharge-les d'un coup.
- **Réglages** : format préféré, qualité JPG / WebP, nom des fichiers (nom d'origine, avec la
  date, ou site + date), toujours demander où enregistrer, Alt + clic, message de confirmation.

## Installation

1. Télécharge le code (**Code → Download ZIP**) et décompresse-le, ou clone le dépôt.
2. Ouvre `brave://extensions` (ou `chrome://extensions`).
3. Active le **Mode développeur** (en haut à droite).
4. Clique sur **Charger l'extension non empaquetée** et choisis le dossier **`src`**.

Pour mettre à jour : remplace les fichiers, puis clique sur ↻ sur la carte de Picky dans
`brave://extensions`.

## Développement

```bash
npm install
npx playwright install chromium
npm test
```

Les tests chargent l'extension dans un vrai Chromium et vérifient chaque cas difficile
(AVIF sous un calque, fond CSS, SVG, `blob:`, canvas, image d'un autre domaine, image protégée
par le Referer), ainsi que la confirmation, l'historique, les réglages, Alt + clic, la copie et
le popup.

Les icônes se régénèrent avec `npm run icons` (Windows, PowerShell 7).

## Licence

[MIT](LICENSE)
