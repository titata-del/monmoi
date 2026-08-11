# Luma — Beauty Mirror V1

Première base PWA mobile du projet.

## Onglets
- Miroir : caméra + landmarks esthétiques + consultation des zones du visage
- Analyse : morphologie, sourcils recommandés, colorimétrie, yeux/contraste
- Essayer : structure prête pour sourcils, yeux, blush, bronzer, lèvres et teint
- Conseils : mood du jour + recommandations personnalisées
- Profil : analyse, colorimétrie, réglages/confidentialité

`Mes looks` et `Historique` ont volontairement été retirés de cette V1.

## Mise en ligne GitHub Pages
1. Créer un dépôt GitHub public.
2. Envoyer tous les fichiers de ce dossier à la racine du dépôt.
3. GitHub > Settings > Pages.
4. Source : Deploy from a branch.
5. Branch : main / root.
6. Ouvrir l'URL HTTPS fournie par GitHub Pages.

La caméra nécessite HTTPS. GitHub Pages convient.

## Important
Les landmarks utilisent MediaPipe chargé depuis un CDN. Si MediaPipe ne se charge pas, l'interface reste utilisable mais sans points faciaux automatiques.


## Verrouillage
Cette version inclut un écran de déverrouillage à 6 chiffres inspiré d'iOS. Code configuré : 071079. Il s'agit d'un verrou d'interface côté navigateur et non d'une authentification serveur.
