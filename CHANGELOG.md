# Changelog

## 1.1.0 — 2026-10-07

Plus clair, plus transparent, et un menu dans l'icône.

- **Clic droit** : chaque format dit à quoi il sert ; « Format d'origine » devient
  « Tel quel (AVIF) — le fichier du site, sans conversion », avec le format réel quand il
  se devine ; nouveaux choix **Enregistrer sous…** et **Copier l'image**.
- **Confirmation** après chaque téléchargement : nom réel du fichier, format, dimensions,
  poids, et bouton **Afficher** dans le dossier.
- **Alt + clic** sur une image : téléchargement direct au format préféré.
- **Menu de l'icône** :
  - Historique des 20 derniers téléchargements (miniature, infos, site, retéléchargement dans
    un autre format) ;
  - Cette page : toutes les images de l'onglet, à cocher et télécharger en lot ;
  - Réglages : format préféré, qualité JPG / WebP, nom des fichiers, toujours demander où
    enregistrer, Alt + clic, message de confirmation.
- **Plus rapide** : encodage synchrone, environ 80 ms par image au lieu de 1 à 2 s (Chrome
  ralentit les tâches asynchrones des documents cachés).
- Un canvas illisible laisse la place à l'image située en dessous.
- Annuler « Enregistrer sous… » n'affiche plus rien et ne retente plus avec un autre nom.
- Tests : confirmation, historique, nom « site + date », Alt + clic (activé / désactivé),
  copie, popup et téléchargement en lot.

## 1.0.0 — 2026-10-07

Première version.

- Clic droit → **Télécharger l'image** → PNG, JPG, WebP ou format d'origine.
- Trouve l'image sous le curseur même cachée sous un calque, en fond CSS, en SVG, en canvas
  ou en `blob:`.
- Récupère les images d'autres domaines et réessaie depuis la page quand le site bloque le
  téléchargement direct.
- Conversion dans le navigateur ; JPG sur fond blanc, SVG rastérisé en 1024 px minimum.
- Message d'erreur discret en bas de la page si aucune image n'est trouvée.
