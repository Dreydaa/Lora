# État Soza V2

Journal d'avancement de la V2, mis à jour à chaque étape. Trois fichiers, trois rôles :

| Fichier | Rôle |
|---|---|
| `SozaV2.md` | Vision, décisions de conception et **liste des étapes** (to-do du plus simple au plus dur). Ne dit pas où on en est. |
| **`STATUS-V2.md`** (ce fichier) | **Où en est la V2** : ce qui est fait, mesuré, vérifié ou pas, et la suite. |
| `STATUS.md` | État de la V1 (livrée le 09/10/2026) et historique détaillé. Les travaux de la V2 s'écrivent ici, pas là-bas. |

Dernière mise à jour : 13/10/2026, étape 4 faite (en attente de validation visuelle). **Prochaine étape : 5** (recherche rapide parlée).

## Règles de travail (décidées avec l'utilisateur)

- **Du plus simple au plus dur**, un seul chantier à la fois (décision du 12/10/2026). Les gestes de la main (chantier 9) ne sont plus du surdev : ils sont l'étape 12, la dernière.
- **Mesurer avant d'optimiser**, et dire ce qui n'a pas été vérifié.
- **Une PR par étape**, vers `main`, tests passés (`npm test`, `npm run test:acceptance`, `tsc --noEmit`).
- **Un choix visuel est à l'utilisateur** : on mesure, on propose, il tranche (exemple : la réfraction du verre, étape 3).

## Avancement

| # | Étape | État | PR |
|---|---|---|---|
| 0 | Tests de cadence remis au vert, liste « non vérifié » de la V1 | **Fait**, liste non vérifiée en partie ouverte (voir plus bas) | #12 |
| 1 | Statut `Terminé`, catégorie Notion, applications inconnues | **Fait** | #13 |
| 2 | Pause de plusieurs jours visible dans le dashboard | **Fait** | #14 |
| 3 | Optimisation : cause du lag trouvée et corrigée | **Fait** | #15 |
| 4 | Lancer/fermer une app nommée + fichier de config local | **Fait** (essai manuel réussi, voir plus bas) | à ouvrir |
| 5 | Recherche rapide parlée | À faire | |
| 6 | Musique, volume système, batterie de la souris | À faire | |
| 7 | Plusieurs projets en parallèle | À faire | |
| 8 | Moteur de protocoles (2B, 7E3A, 6H9K) | À faire | |
| 9 | Voix : mot d'activation, reconnaissance et synthèse vocale, ruban réactif | À faire | |
| 10 | Agent résident en arrière-plan et widget animé | À faire | |
| 11 | « Qu'est-ce que je regarde ? » | À faire | |
| 12 | Gestes de la main | À faire | |

Les étapes 4 à 6 sont décrites comme déclenchées à la voix, mais l'écoute arrive à l'étape 9 : les tester d'abord par du texte (Telegram ou champ dans le ruban).

## Ce qui a été fait

### Étape 0 : tests (PR #12)
- Les 2 tests d'acceptation de cadence (`tests/acceptance/performance.test.ts`) lisent `REST_FPS` au lieu d'un 30 en dur. Le test de l'intro n'échouait pas : il dépassait son délai de 60 s (rendu logiciel simulé), porté à 180 s.
- **Limite** : à 60 images/s, le plafond ne se distingue plus de l'absence de plafond sur l'horloge simulée (~62 images/s) ; ces tests ne gardent que le plafond haut.

### Étape 1 : statut, catégorie, applications (PR #13)
- **`Terminé`** : `complete_project` passe l'idée en `Terminé` (`Archivée` = abandonné), le compteur « Finis » compte les `Terminé`, `archiveIdea` devient `completeIdea`, `findIdeaByTitle` ignore les deux statuts.
- **Catégorie Notion** : lue dans les bases Idées, Agenda et Jalons, envoyée par `/api/dashboard`, prioritaire sur les mots-clés pour les logos (`Autre` = pas de logo) ; écrite par `create_idea`, `add_agenda_item` et `create_milestone`. La liste `CATEGORIES` est dans `lib/types.ts`.
- **Applications inconnues** : nom et logo pour Claude, Modrinth, Valorant, Bleach Brave Souls, Affinity ; le suffixe `-win64-shipping` est retiré des noms inconnus.

### Étape 2 : pause dans le dashboard (PR #14)
- `/api/dashboard` expose `pause` (`{ start, end }` ou `null`, seulement si en cours ou à venir). Le bloc briefing annonce la pause en cours à la place du briefing, et rappelle une pause à venir.
- **Pas de persistance Notion** (décidé) : Redis suffit, une base de plus ne changerait rien à l'affichage.

### Étape 3 : optimisation (PR #15)
- **Mesure dans l'app installée** (build du 09/10, écran 240 Hz, RTX 4070 Ti SUPER, fenêtre visible au repos) : ~120 à 138 % d'un cœur et ~20 images de particules/s au lieu de 60. Rust : 0,1 %.
- **Cause** : le `backdrop-filter: url(#svg)` (réfraction) des cartes de verre, recalculé à chaque image des particules.
- **Mesures par variante** : état normal ~120 % et ~20 images/s ; réfraction sur les 4 petites cartes seulement 59 % et 60 images/s ; sans réfraction ~30 % et 60 images/s ; sans le canvas WebGL 18 %.
- **Décision de l'utilisateur** : réfraction coupée (`REFRACTIVE = false`, `glass.ts`). Réversible, le commentaire donne l'expression à remettre. Le verre perd les franges de couleur sur les bords.
- **Résultat sur le build de production neuf** : ~30 % d'un cœur et 60 images/s.
- **Volontairement laissé** (aucun gain mesurable) : découpage du chunk JS (724 ko, 205 ko compressés, app locale), calcul des particules sur GPU, retrait du paquet npm `@tauri-apps/plugin-opener` (jamais importé, absent du bundle).
- **Méthode de mesure réutilisable** : lancer l'app avec `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`, se connecter avec Playwright (`chromium.connectOverCDP("http://127.0.0.1:9222")`), injecter du CSS pour couper un élément, lire le CPU par processus. Compter les dessins WebGL en remplaçant `WebGL2RenderingContext.prototype.drawElementsInstanced` (ne poser le hook qu'une fois, sinon le compte double).

### Étape 4 : lancer et fermer une app nommée
- **Entrée de test** (choix de l'utilisateur) : une barre de commande, `Ctrl+K` pour l'ouvrir, `Échap` pour la fermer (`CommandBar.tsx`). Elle n'existe que dans l'app Tauri. Elle flotte en bas au centre sans toucher à la grille ; elle recouvre un peu le bas des cartes : **choix visuel à valider par l'utilisateur**.
- **Reconnaissance locale, sans réseau** (`src-tauri/src/apps.rs`) : un verbe (`ouvre`, `lance`, `démarre`, `ferme`, `quitte`…) puis le nom, articles et « application » ignorés (« ferme mon Spotify »).
- **Liste blanche** : `apps.json` dans le dossier de données de l'app (`%APPDATA%\com.soza.assistant\`), format `{ "blender": "C:\\...\\blender.exe" }`, créé vide au premier lancement, relu à chaque commande (pas de redémarrage). Rien d'autre ne peut être lancé ni fermé ; un nom inconnu renvoie le chemin du fichier.
- **Ouverture** : lance l'exécutable du fichier, dans son dossier. **Fermeture douce** (décidé) : `taskkill /IM exe` sans `/F`, l'application peut proposer d'enregistrer ; jamais forcée.
- **Essai dans l'app de dev** (identifiant séparé, dossier de données séparé) : ouverture, fermeture (plus aucun processus ensuite), « rien à fermer » quand elle n'est pas ouverte, refus d'une application inconnue, refus d'une phrase non reconnue : conformes. Un essai a révélé qu'un BOM UTF-8 en tête d'`apps.json` (PowerShell 5, certains éditeurs) vidait la liste : corrigé et testé.
- **Second essai, applications réelles (13/10/2026, app de dev)** : Spotify (0 → 9 processus à l'ouverture, 0 après « ferme spotify »), Bloc-notes (« Ouvre le Bloc-Notes ! » puis « ferme le bloc-notes »), table des caractères via `Ctrl+K` (barre refermée après l'envoi, `Échap` la ferme). Refus vérifiés : `explorer`, `cmd.exe`, un chemin complet, `spotify && calc`, `ferme spotify; shutdown /s` donnent tous « Je ne connais pas », et aucun `cmd.exe` n'a Soza pour parent. Aucune application déclarée = aucune action possible.
- **Non essayé** : fermeture d'une application avec un document non enregistré (Bloc-notes de Windows 11 restaure sa session, Spotify n'a rien à enregistrer) ; Blender (introuvable à l'emplacement standard) ; build de production (`build.rs` sans manifeste de commandes, donc `run_command` est autorisée comme `app_usage`, mais non rejoué dans l'app installée).
- **Limites connues** : ouvrir une application déjà ouverte en lance une seconde instance quand l'application le permet (Spotify n'en crée pas) ; fermer une application sans fenêtre échoue (taskkill demande une fermeture forcée) ; aucune application n'est encore déclarée dans l'`apps.json` réel de l'utilisateur ; non essayé dans l'app installée (build du 12/10, sans cette étape) ; le raccourci `Ctrl+K` n'est pas couvert par un test d'acceptation (navigateur sans Tauri).
- **À faire par l'utilisateur** : remplir `apps.json` avec ses applications (Blender, Spotify, etc.), puis essayer dans l'app reconstruite.

## Tests (état à la fin de l'étape 4)

`npm test` : 281 tests ; `npm run test:acceptance` : 21 scénarios dans un vrai navigateur (~3,5 min, non rejoués à l'étape 4) ; `npm run test:rust` : 8 tests (5 nouveaux dans `apps.rs`, dont un qui lance et ferme un vrai processus Windows) ; `tsc --noEmit` propre.

## À vérifier (ouvert)

- **Dans l'app installée** : le menu de la zone de notification, la reprise du rendu après un clic sur l'icône, le suivi du temps d'écran et les clics sur les blocs. Seule la clé de démarrage automatique `Soza` (`soza.exe --autostart`) a été constatée dans le registre (`HKCU\...\Run`) le 12/10/2026 ; le démarrage réel au lancement de session n'est pas vérifié.
- **L'app installée est celle du 12/10** (confirmé par l'utilisateur le 13/10/2026). Les vérifications ci-dessus peuvent donc se faire dessus ; elle ne contient pas le correctif des noms d'applications du 13/10 ni celui du « demain » du bilan (backend, à redéployer).
- **`npm run test:live` lancé le 13/10/2026** (accord de l'utilisateur) : 48/48 sur le vrai Notion, Redis et Groq, pages `[TEST]` archivées (vérifié : 0 restante). Le 1er essai a échoué : la base Idées n'avait pas le statut `Terminé` (filtre de `findIdeaByTitle` rejeté par Notion) ; l'utilisateur l'a ajouté, **à refaire si la base est recréée**. Schéma réel relu : `Catégorie` présente dans Idées, Agenda et Jalons (mêmes 15 valeurs que `CATEGORIES`), plus de `Mode`.
- **`Catégorie` vérifiée en écriture réelle le 13/10/2026** : écrite puis relue dans Idées (Blender), Agenda (Sport) et Jalons (Cinéma, accent compris), relue aussi par `getAllIdeas` ; les 3 pages de test archivées par id. Le script `test:live` ne la couvre toujours pas (test ponctuel).
- **Pas couvert** : `/api/dashboard` contre le vrai Notion. Le nettoyage du script ne lit que les 100 premières pages par base (pas de pagination) : à surveiller si les bases grossissent.
- Le test efface la vraie clé Redis `break` (`setBreak`/`clearBreak`) : relire la pause avant de le lancer et la remettre après.
- **Passe sécurité** : jamais faite sur le code réel (la commande `/security-review` du 12/10 portait sur un diff sans code). À faire sur webhook, signatures QStash et cron, `/api/dashboard`, CSP et capacités Tauri.
- **Textes réels des briefings** du matin et du soir avec le nouveau code.
- **Pause sur le vrai Redis** et rendu dans l'app, tant que le backend n'a pas été redéployé et observé.

## Données et réglages à traiter

- Les idées déjà `Archivée` mais en fait finies ne comptent pas dans « Finis » : à repasser en `Terminé` dans Notion.
- Les bases Agenda et Jalons n'ont pas de catégorie pour l'existant ; seules les nouvelles entrées créées par Soza en auront une.
- Applications sans nom : identifiées le 13/10/2026, `pioneergame` = Arc Raiders et `promethee` = Prométhée (ajoutées à `APPS`, `appUsage.ts`).
- `src-tauri/target` pèse 9,3 Go (debug 6,5 Go, release 2,8 Go). Un `cargo clean` tenté par l'utilisateur n'a pas fonctionné (cause non diagnostiquée : à relancer en lisant l'erreur, app et processus cargo fermés).
- Colonnes `Mode` des bases Notion Agenda et Progression : retirées (confirmé par l'utilisateur le 13/10/2026), le chantier 1 est entièrement terminé.
- Correctif du 13/10/2026 : le brief du matin recopiait « demain » du bilan de la veille. `BILAN_RULES` (`lib/briefing.ts`) dit maintenant que les mots relatifs du bilan sont décalés d'un jour. Non vérifié sur un vrai brief.

## Pièges rencontrés

- **Vitest sur `E:` en majuscule** : « failed to find the runner » sur tous les fichiers. Lancer les tests depuis un chemin en minuscule (`Set-Location 'e:\Programmation\Project\Soza'`). `tsc` n'est pas concerné.
- **Tests d'acceptation lents** : rendu WebGL logiciel, les scénarios d'intro approchent le délai de 60 s par défaut ; ils ont un délai de 180 s.
- **PowerShell** : `Set-Location` persiste d'un appel à l'autre et peut changer le dossier de travail de l'outil ; revenir à la racine du dépôt après un `Set-Location` ailleurs.
