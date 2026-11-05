# Interface Løra

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
- **Briefing** du matin ou du soir selon l'heure (les heures viennent des réglages Notion) : texte court généré par Løra. Pendant une pause de plusieurs jours, la carte annonce la pause en cours à la place du briefing (les crons sont suspendus) et rappelle une pause à venir.
- **Calendrier** : vue Mois par défaut, bascule Semaine, navigation, clic sur un jour pour son détail (Échap pour fermer). Pastilles-logo par tâche, points colorés par type (Perso, Shift, Jalon, retard).

## Interactions
- **Prochain jalon** (clic) : une carte s'ajoute sous les petits blocs avec la ligne du temps des jalons (validé vert, en retard rouge, en cours cyan, à faire gris), centrée sur « Aujourd'hui ».
- **Écran** (clic) : la même carte affiche les applications les plus utilisées, aujourd'hui ou sur 7 jours. Cliquer sur l'autre bloc change le contenu sans refermer. ✕ ou Échap referme et le bento revient à l'identique.
- Les animations respectent `prefers-reduced-motion`.

## Barre de commande (`Ctrl+K`)
Disponible seulement dans l'app Tauri, sans réseau. `Ctrl+K` l'ouvre, `Échap` la ferme, elle se referme après l'envoi. Elle flotte en bas au centre sans toucher à la grille et recouvre un peu le bas des cartes (position validée par l'utilisateur le 13/10/2026). Commandes reconnues (`CommandBar.tsx`, puis `run_command` côté Rust) :
- applications de la liste blanche `apps.json` : `ouvre`, `lance`, `démarre` + le nom ; `ferme`, `quitte` + le nom (fermeture douce, jamais forcée) ;
- volume : `volume` (dit le niveau), `volume 30`, `monte le son` / `baisse le volume` (de 10 points), `coupe le son` (ou `mute`), `remets le son` ;
- musique : `pause`, `reprends` ou `mets de la musique`, `musique suivante`, `morceau précédent`, `mets <titre>` (morceau Spotify, demande `spotify.json`) ;
- `batterie de la souris`.
Un nom inconnu ou une phrase non reconnue est refusé, rien n'est exécuté. Le détail et les limites : `docs/ai/STATUS-V2.md`, étapes 4 et 6.

**Voix (04/11/2026).** Chaque réponse est dite à voix haute avec la voix de Løra : Piper, en local, modèle affiné sur la voix d'un proche avec son accord, lancé à la première phrase et gardé en mémoire 10 minutes ; la voix de Windows prend le relais si les fichiers de Piper manquent. Les guillemets et signes de mise en forme ne sont pas lus. Réglages dans `voice.json` (dossier de données de l'app) : `volume` (0 à 1) et `english` (les noms d'applications dits avec l'accent anglais). `voice.log` garde ce qui a été dit et les phonèmes, les 30 derniers WAV sont dans `voice/history/`. Détail, limites et installation : `docs/ai/STATUS-V2.md`, étape 9.

## Zone de notification
Fermer la fenêtre la masque. Clic gauche sur l'icône : afficher. Clic droit : Afficher Løra / Quitter. Au démarrage de Windows (app installée), Løra se lance fenêtre masquée.

## Sources de données
| Bloc | Source |
|---|---|
| Projets, jalons, agenda, compteurs | Notion, via `/api/dashboard` |
| Briefings | Texte généré par les crons du matin et du soir, gardé dans Redis |
| Veille | Flux RSS (TechCrunch, Vogue) |
| Météo | Open-Meteo, appelée directement par l'app |
| Écran | Suivi local dans l'app Tauri (`usage.json`), rien n'est envoyé en ligne |
| Barre `Ctrl+K` | Fichiers locaux de l'app (`apps.json`, `spotify.json`), commandes Windows ; rien n'est envoyé à Løra |

Si le backend est injoignable, le dashboard garde des données d'exemple (`mockData.ts`). Hors de l'app Tauri (navigateur), le bloc Écran affiche « — ».

## Hors périmètre
Pas de quiz, d'onglets, de mode ACTIF/PAUSE ni de dégradation visuelle après un jalon manqué (abandonnée le 08/10/2026). L'avatar vocal du ruban est prévu en V2 (`docs/ai/LoraV2.md`).
