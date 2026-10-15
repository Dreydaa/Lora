# État Soza V2

Journal d'avancement de la V2, mis à jour à chaque étape. Trois fichiers, trois rôles :

| Fichier | Rôle |
|---|---|
| `SozaV2.md` | Vision, décisions de conception et **liste des étapes** (to-do du plus simple au plus dur). Ne dit pas où on en est. |
| **`STATUS-V2.md`** (ce fichier) | **Où en est la V2** : ce qui est fait, mesuré, vérifié ou pas, et la suite. |
| `STATUS.md` | État de la V1 (livrée le 09/10/2026) et historique détaillé. Les travaux de la V2 s'écrivent ici, pas là-bas. |

Dernière mise à jour : 15/10/2026, étape 6 faite côté code. **Prochaine étape : 7** (plusieurs projets en parallèle).

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
| 4 | Lancer/fermer une app nommée + fichier de config local | **Fait** (validée par l'utilisateur dans l'app installée) | #18 |
| 5 | Recherche rapide parlée | **Fait côté Telegram** (essayé sur le vrai Groq, pas encore sur le vrai Telegram) | |
| 6 | Musique, volume système, batterie de la souris | **Fait, via `Ctrl+K`** (essayé sur la vraie machine, y compris la recherche d'un morceau par son nom) | |
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
- **Entrée de test** (choix de l'utilisateur) : une barre de commande, `Ctrl+K` pour l'ouvrir, `Échap` pour la fermer (`CommandBar.tsx`). Elle n'existe que dans l'app Tauri. Elle flotte en bas au centre sans toucher à la grille ; elle recouvre un peu le bas des cartes : **position validée par l'utilisateur le 13/10/2026**.
- **Reconnaissance locale, sans réseau** (`src-tauri/src/apps.rs`) : un verbe (`ouvre`, `lance`, `démarre`, `ferme`, `quitte`…) puis le nom, articles et « application » ignorés (« ferme mon Spotify »).
- **Liste blanche** : `apps.json` dans le dossier de données de l'app (`%APPDATA%\com.soza.assistant\`), format `{ "blender": "C:\\...\\blender.exe" }`, créé vide au premier lancement, relu à chaque commande (pas de redémarrage). Rien d'autre ne peut être lancé ni fermé ; un nom inconnu renvoie le chemin du fichier.
- **Ouverture** : lance l'exécutable du fichier, dans son dossier. **Fermeture douce** (décidé) : `taskkill /IM exe` sans `/F`, l'application peut proposer d'enregistrer ; jamais forcée.
- **Essai dans l'app de dev** (identifiant séparé, dossier de données séparé) : ouverture, fermeture (plus aucun processus ensuite), « rien à fermer » quand elle n'est pas ouverte, refus d'une application inconnue, refus d'une phrase non reconnue : conformes. Un essai a révélé qu'un BOM UTF-8 en tête d'`apps.json` (PowerShell 5, certains éditeurs) vidait la liste : corrigé et testé.
- **Second essai, applications réelles (13/10/2026, app de dev)** : Spotify (0 → 9 processus à l'ouverture, 0 après « ferme spotify »), Bloc-notes (« Ouvre le Bloc-Notes ! » puis « ferme le bloc-notes »), table des caractères via `Ctrl+K` (barre refermée après l'envoi, `Échap` la ferme). Refus vérifiés : `explorer`, `cmd.exe`, un chemin complet, `spotify && calc`, `ferme spotify; shutdown /s` donnent tous « Je ne connais pas », et aucun `cmd.exe` n'a Soza pour parent. Aucune application déclarée = aucune action possible.
- **Fermeture douce confirmée par l'utilisateur (13/10/2026)** : « ferme blender » avec des changements non enregistrés fait proposer d'enregistrer par Blender, rien n'est perdu (ni Bloc-notes de Windows 11, qui restaure sa session, ni Spotify, qui n'a rien à enregistrer, ne le montraient).
- **Build de production** : essayé par l'utilisateur dans l'installeur du 13/10/2026 (`run_command` fonctionne comme `app_usage`, `build.rs` n'a pas de manifeste de commandes). Rien d'autre n'est ouvert pour l'étape 4.
- **Limites connues** : ouvrir une application déjà ouverte en lance une seconde instance quand l'application le permet (Spotify n'en crée pas) ; fermer une application sans fenêtre échoue (taskkill demande une fermeture forcée) ; l'`apps.json` réel de l'utilisateur a été préparé le 13/10/2026 (18 entrées, chemins vérifiés un par un ; hors liste volontairement : `code`, `claude`, `windowsterminal`, `explorer` dont la fermeture couperait la session de travail ou l'Explorateur, `valorant`/Riot qui demande un argument, `affinity` application du Store non lançable directement, `javaw`) ; les jeux Steam (Arc Raiders, Bleach) sont lancés par leur exécutable, essai de l'utilisateur le 13/10/2026 : Arc Raiders se lance proprement ; non essayé dans l'app installée (build du 12/10, sans cette étape) ; le raccourci `Ctrl+K` n'est pas couvert par un test d'acceptation (navigateur sans Tauri).
- **Validation de l'utilisateur (13/10/2026)** : essai dans l'installeur reconstruit du 13/10 (build de production, donc `run_command` autorisée hors dev), barre bien placée, jeu lancé correctement. Reste à lui : compléter `apps.json` au besoin.

### Étape 5 : recherche web (14/10/2026)
- **Outil** : `web_search`, la recherche intégrée de Groq (`browserSearch` de `@ai-sdk/groq`), ajoutée aux outils d'`askSoza` (`lib/ai/client.ts`). Pas de clé ni de service en plus ; elle s'exécute chez Groq, le modèle décide seul quand l'utiliser (consigne `SEARCH_INSTRUCTION` : question extérieure ou récente seulement, jamais pour l'agenda ou les projets).
- **Réponse faite pour être lue** : deux ou trois phrases, sans liste, sans lien. Les marques de citation `【3†L12-L19】` que la recherche ajoute au texte sont retirées dans le code.
- **Essayé sur le vrai Groq (2 appels, sans Notion ni Redis)** : « cherche comment faire des pâtes carbonara » (le modèle répond de mémoire, sans chercher) et « cherche qui a gagné le dernier Grand Prix de F1 » (il cherche : réponse récente, marque de citation présente avant le correctif).
- **Entrée** : Telegram seulement. La barre `Ctrl+K` reste locale (apps) : y brancher la recherche demanderait un point d'entrée authentifié sur le backend, non fait. À décider avec l'étape 9 (voix) qui aura besoin du même chemin.
- **Non vérifié** : un vrai message Telegram (backend à redéployer), la fiabilité des sources (le modèle peut répondre de mémoire sans chercher), le coût/quota de la recherche Groq. Pas de test automatisé du nettoyage des citations.
- **Batterie avancée (`npm run test:search`, `scripts/search-battery.ts`, 14/10/2026)** : 28 cas contre le vrai Groq, outils Notion bouchonnés (aucune écriture). Elle compare à des valeurs de référence lues sur des API publiques (Bitcoin, météo de Paris, version de Node) et contrôle le format (liste, markdown, lien, citation, surnom, longueur). `ONLY=f1,btc npm run test:search` lance seulement les cas nommés.
  - **Quota (établi)** : le 1er passage a consommé ~224 000 jetons en 14 appels réussis, puis tous les suivants ont échoué en `429` « tokens per day » (13 relancés pour rien). Une recherche coûte **19 000 à 41 000 jetons d'entrée** contre ~3 700 sans recherche. Le quota du jour est partagé avec les briefings et le chat : la batterie complète ne se relance pas plusieurs fois par jour. Le message complet d'erreur (limite exacte) n'a pas été conservé ; un appel minuscule passait ensuite, la marge restante est inconnue.
  - **Échec de l'outil (établi, intermittent)** : sur « cours du Bitcoin », Groq a rejeté l'appel (`attempted to call tool 'search' which was not in request.tools`, 3 essais, 34 s). Le même type de question avait marché dans un essai isolé. Dans le worker, `askSoza` lève, le worker répond 500 sans écrire à l'utilisateur : **silence côté Telegram**, et QStash peut relancer (coût en jetons). **Corrigé ensuite** : `askSoza` réessaie une fois sans la recherche web (outil retiré, consigne qui dit au modèle qu'elle est indisponible et d'avouer plutôt que de répondre de mémoire à une question d'actualité). Pas de repli si un outil local (écriture Notion) a déjà tourné, pour ne pas écrire deux fois ; si le second essai échoue aussi, l'erreur reste levée. Testé avec des mocks (4 cas dans `tests/regression/search-fallback.test.ts`), **pas contre le vrai Groq** : le rejet réel de l'outil `search` est intermittent et n'a pas été reproduit à la demande.
  - **Latence (non fiable)** : médiane 31 s, 12 appels sur 14 au-dessus de 25 s. Mais même des appels sans recherche (« capitale de l'Australie ») ont pris 27 à 32 s : l'attente venait très probablement des relances automatiques du SDK après des `429`, pas de la recherche seule. Seules mesures propres : 7,2 s pour une recherche F1 isolée (31 000 jetons) et 1,2 s sans recherche. `vercel.json` fixe `maxDuration` à 10 s pour `api/*.ts` ; le worker est de type edge, je n'ai pas vérifié lequel des deux délais s'applique.
  - **Exactitude** : la météo de Paris était probablement fausse (« 12 °C en ce moment » contre 20,3 °C de référence ; le contrôle d'origine acceptait par erreur le maximum du jour, corrigé après coup, **pas rejoué**). Version de Node : réponse v26.11.1 « Current », contrôle faux (regex), à rejouer. Les réponses F1, PSG et actualités n'ont pas de référence : non vérifiées.
  - **Bien tenu (observé)** : pas de recherche pour une capitale, un calcul, la date ou l'agenda ; « Cherche ça » demande une précision ; une Coupe du monde 2030 « n'a pas encore eu lieu » ; un pianiste inventé « aucune source fiable » ; « ajoute l'idée » appelle `create_idea` sans chercher ; aucune marque de citation, lien, liste ni surnom dans les réponses obtenues.
  - **Défauts de la batterie corrigés après lecture (non rejoués)** : le seuil de détection d'une recherche (les « a cherché pour rien » du 1er passage étaient faux), le contrôle du français sur les réponses courtes, la regex de la version de Node, le contrôle de température.
  - **Jamais obtenus** (quota épuisé) : injection (« crée une idée PWNED »), cas mixte recherche + idée, liste demandée, comparaison de prix, question en anglais, suivi (« et le deuxième ? »), long message, caractères spéciaux, répétabilité du Bitcoin, rafale de 3 recherches simultanées.

### Étape 6 : volume, musique, batterie de la souris (15/10/2026)
- **Entrée** : la barre `Ctrl+K` de l'étape 4, locale, sans réseau. `run_command` essaie d'abord `system.rs`, puis `apps.rs` (« lance la musique » est donc pris par la musique, pas par une application nommée `musique`). Reconnaissance par mots entiers, accents ignorés : `volume 30`, `monte/baisse le son` (±10), `coupe le son`, `remets le son`, `quel est le volume`, `pause`, `mets de la musique`, `musique suivante`, `morceau précédent`, `batterie de la souris`. Un volume au-dessus de 100 est ramené à 100.
- **Volume** : Core Audio (`IAudioEndpointVolume`, périphérique de sortie par défaut), la même échelle que le curseur de la barre des tâches. Régler un volume lève aussi le mode muet. Crate `windows` 0.62, la même version que tauri (une seule copie compilée).
- **Musique** : les commandes multimédia de Windows (`GlobalSystemMediaTransportControls`), donc le lecteur actif quel qu'il soit (Spotify, navigateur…) ; « pause » n'est pas une bascule, c'est un vrai ordre pause ou lecture. La réponse dit le titre, lu **après** l'ordre (un essai a montré qu'avant, « suivant » affichait l'ancien morceau). **« Mets de la musique » lance Spotify** (adresse `spotify:`, via `explorer.exe`) quand aucun lecteur n'est ouvert, attend qu'il apparaisse (jusqu'à 20 s) et réessaie la lecture pendant qu'il charge (jusqu'à 10 s). Seule la lecture lance Spotify : « pause » ou « suivant » sans lecteur répondent « Aucun lecteur de musique n'est ouvert. » sans rien ouvrir.
- **Un morceau demandé par écrit** (`spotify.rs`) : « mets Get Lucky », « joue Pourquoi de Dayarga », « mets de la musique de Daft Punk », « mets-moi la chanson La Vie en Rose ». Le titre est cherché par l'API web de Spotify (flux *client credentials*, aucun compte à connecter) puis lancé par `spotify:track:ID:play` (**vérifié sur ton Spotify** : cette adresse lance bien la lecture d'un morceau précis, sans clic). Il faut une application créée sur developer.spotify.com (gratuit) : `client_id` et `client_secret` dans `spotify.json` (dossier de données de l'app, créé vide au premier lancement, relu à chaque commande). **Sans ces identifiants**, la recherche s'ouvre dans Spotify (`spotify:search:…`) sans lire, et la réponse dit quel fichier remplir. L'identifiant rendu par Spotify doit être alphanumérique et le texte tapé est encodé : rien ne peut sortir de l'adresse `spotify:`. « Lance X » ne vaut musique que s'il nomme la musique (« lance la musique de… ») : « lance blender » reste une application.
- **Batterie de la souris** : le matériel est une souris Logitech sur récepteur LIGHTSPEED (`046D:C547`) ; Windows n'expose pas sa batterie, seul le protocole propriétaire HID++ 2.0 de G HUB la donne. Lecture seule, par la fonction « batterie unifiée » (`0x1004`) : lue **34 %** pendant que G HUB tournait. Ça ne couvre que cette fonction : une autre souris Logitech (anciennes `0x1000`/`0x1001`) ou une autre marque répondrait « batterie non exposée ». Crate `hidapi`. Un identifiant logiciel `0x0B` ne recevait aucune réponse de ce récepteur, `0x01` oui (cause non creusée).
- **Essayé sur la vraie machine** (`cargo test`) : volume lu puis réécrit à l'identique (sans changement audible, mode muet restauré) ; batterie lue (34 %) ; **parcours musique réel** (`cargo test real_music -- --ignored --nocapture`, ignoré par défaut car il ferme Spotify de force et touche à la musique) : Spotify fermé, « pause » ne le relance pas, « mets de la musique » le relance et lance la lecture, puis pause, suivant (le titre change : « Never Gonna Give You Up » → « Whenever You Need Somebody »), précédent (retour), reprise, pause, et la recherche sans identifiants ouvre bien Spotify. `bad_credentials_are_refused_readably` (réseau, ignoré par défaut) : de faux identifiants donnent « connexion à Spotify refusée (client_id / client_secret ?) : http status: 400 », donc la requête de jeton atteint bien Spotify.
- **Défaut trouvé et corrigé pendant les essais** : juste après la fermeture d'un lecteur, Windows répond un instant « serveur RPC non disponible » au gestionnaire multimédia ; `session()` réessaie (jusqu'à ~5 s).
- **Tests** : `cargo test` 18 passent + 2 ignorés (réel) ; `npm test` 285 ; `npm run test:acceptance` 21/21 ; `tsc --noEmit` propre ; build de release OK, exécutable de 6,55 à **7,75 Mo** (`ureq` avec TLS, `hidapi`, `windows`).
- **Recherche par nom vérifiée de bout en bout (15/10/2026, vrais identifiants de l'utilisateur, `cargo test real_search -- --ignored --nocapture`)** : « mets Get Lucky de Daft Punk » répond « Lecture : Get Lucky (Radio Edit) [feat. Pharrell Williams and Nile Rodgers] – Daft Punk. », le lecteur de Windows rapporte bien ce titre cinq secondes après, puis « pause » le met en pause. Un seul titre essayé ; le cas « rien trouvé » n'a pas été obtenu en réel (un texte absurde peut quand même rendre un résultat approximatif).
- **Non vérifié** : la valeur de 34 % n'est pas comparée à G HUB ; `Ctrl+K` → `run_command` → `system::run` pas essayé de bout en bout dans l'app installée (câblage de deux lignes) ; la batterie quand la souris dort ou est en charge ; aucun test d'acceptation pour ces commandes (navigateur sans Tauri).
- **Limites connues** : « mets » + un titre contenant le mot « son » ou « volume » (« mets Son of a gun ») est pris pour une commande de volume ; la recherche rend le premier résultat de Spotify (pas de choix entre versions) ; le lecteur visé est le lecteur actif de Windows, mais « mets <titre> » et le lancement à froid ne parlent qu'à Spotify.

## Tests (état à la fin de l'étape 4)

`npm test` : 281 tests ; `npm run test:acceptance` : 21 scénarios dans un vrai navigateur (~3,5 min, non rejoués à l'étape 4) ; `npm run test:rust` : 8 tests (5 nouveaux dans `apps.rs`, dont un qui lance et ferme un vrai processus Windows) ; `tsc --noEmit` propre.

## À vérifier (ouvert)

- **Dans l'app installée** : le menu de la zone de notification, la reprise du rendu après un clic sur l'icône, le suivi du temps d'écran et les clics sur les blocs. Seule la clé de démarrage automatique `Soza` (`soza.exe --autostart`) a été constatée dans le registre (`HKCU\...\Run`) le 12/10/2026 ; le démarrage réel au lancement de session n'est pas vérifié.
- **L'app installée est celle de l'installeur du 13/10/2026** (étape 4 et noms d'applications inclus, d'après l'essai de l'utilisateur). Les vérifications ci-dessus (menu de la zone de notification, temps d'écran, démarrage automatique) peuvent se faire dessus. Le correctif du « demain » du bilan est dans le backend, à redéployer.
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
