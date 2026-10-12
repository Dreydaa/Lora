# Interface Soza

L'app Tauri s'ouvre sur une intro en particules, puis sur un dashboard « liquid glass » : neuf cartes de verre posées sur un fond bleu uni où le ruban de Möbius en particules continue de tourner. Tout se pilote par la conversation Telegram ; le dashboard ne fait que lire (Notion, météo, flux RSS) et mesurer le temps d'écran.

## Fenêtre et fond
- Fenêtre fixe de 1440×1024, centrée, non redimensionnable. La mise en page se met à l'échelle avec `--u` (1 = maquette Figma).
- Fond : aplat `#2757D0`. Particules blanches en billes fil de fer, ruban de Möbius qui tourne en permanence derrière les cartes.
- Intro (~8 s) : les particules entrent par la droite, bouclent, puis forment le ruban ; les cartes apparaissent ensuite en cascade. `?skip` (ou `prefers-reduced-motion`) saute l'animation.
- Verre : flou, reflet spéculaire, grain. La réfraction par les bords est **coupée depuis le 12/10/2026** (`REFRACTIVE = false` dans `src/features/glass/glass.ts`) : elle causait le lag (120 % d'un cœur et 20 images/s, contre 30 % et 60 images/s sans elle). Réversible, le commentaire du code donne l'expression à remettre. Les cartes remplies ont une teinte sombre pour garder le texte lisible sur les rayons clairs. Le verre demande WebView2 / Chromium.

## Disposition (deux colonnes, 736 / 544)
Colonne gauche, de haut en bas :
- **Projets en cours** : logo, titre, aperçu des notes, taille, ancienneté, progression des jalons liés et prochain jalon.
- **Quatre petits blocs** : Météo, Prochain jalon, Écran, compteurs de projets (Finis, En cours, Brutes).
- **Veille** : deux colonnes Tech et Fashion, chaque titre est un lien vers l'article (ouvert dans le navigateur par défaut).

Colonne droite :
- **Briefing** du matin ou du soir selon l'heure (les heures viennent des réglages Notion) : texte court généré par Soza.
- **Calendrier** : vue Mois par défaut, bascule Semaine, navigation, clic sur un jour pour son détail (Échap pour fermer). Pastilles-logo par tâche, points colorés par type (Perso, Shift, Jalon, retard).

## Interactions
- **Prochain jalon** (clic) : une carte s'ajoute sous les petits blocs avec la ligne du temps des jalons (validé vert, en retard rouge, en cours cyan, à faire gris), centrée sur « Aujourd'hui ».
- **Écran** (clic) : la même carte affiche les applications les plus utilisées, aujourd'hui ou sur 7 jours. Cliquer sur l'autre bloc change le contenu sans refermer. ✕ ou Échap referme et le bento revient à l'identique.
- Les animations respectent `prefers-reduced-motion`.

## Zone de notification
Fermer la fenêtre la masque. Clic gauche sur l'icône : afficher. Clic droit : Afficher Soza / Quitter. Au démarrage de Windows (app installée), Soza se lance fenêtre masquée.

## Sources de données
| Bloc | Source |
|---|---|
| Projets, jalons, agenda, compteurs | Notion, via `/api/dashboard` |
| Briefings | Texte généré par les crons du matin et du soir, gardé dans Redis |
| Veille | Flux RSS (TechCrunch, Vogue) |
| Météo | Open-Meteo, appelée directement par l'app |
| Écran | Suivi local dans l'app Tauri (`usage.json`), rien n'est envoyé en ligne |

Si le backend est injoignable, le dashboard garde des données d'exemple (`mockData.ts`). Hors de l'app Tauri (navigateur), le bloc Écran affiche « — ».

## Hors périmètre
Pas de quiz, d'onglets, de mode ACTIF/PAUSE ni de dégradation visuelle après un jalon manqué (abandonnée le 08/10/2026). L'avatar vocal du ruban est prévu en V2 (`docs/ai/SozaV2.md`).
