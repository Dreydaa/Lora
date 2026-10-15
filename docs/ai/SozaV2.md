# Soza V2 — vision FRIDAY

Ce fichier porte la vision, les décisions de conception et la liste des étapes de la V2. **L'avancement (ce qui est fait, mesuré, vérifié ou pas) est dans [`STATUS-V2.md`](STATUS-V2.md)** ; l'état de la V1 reste dans `STATUS.md`.

**Statut : la V1 est terminée (09/10/2026) et la V2 a démarré le 12/10/2026.** Les étapes 1 à 6 de la to-do ci-dessous sont faites (la 0 reste ouverte) ; le détail est dans `STATUS-V2.md`. Les chantiers 4 à 12 (hors ceux cochés) ne sont pas implémentés.

## Pourquoi cette direction (décidé 30/09/2026)

L'utilisateur tient bien sa cadence de travail ces derniers temps (au moins une session/jour) et sent que le cadrage "coach discipline/fatigue" de Soza (deux personas + mode ACTIF/PAUSE) est moins nécessaire que prévu — la difficulté est plus de *tenir* la discipline que de la *construire*, et il la tient. Direction retenue : rapprocher Soza d'un assistant type **FRIDAY** (Tony Stark) — une seule personnalité, des fonctionnalités qui servent l'utilisateur directement plutôt qu'un rôle de coach.

## Principe directeur : local plutôt que cloud (décidé 01/10/2026)

La V1 est entièrement cloud (Vercel + Notion + Telegram). La V2 **penche vers le local** : Notion reste la source de vérité seulement pour ce qui doit rester accessible à distance (suivi de projet, agenda — relu localement aussi, mais pas dupliqué en écriture). Tout le reste (config, défauts, logique d'action sur la machine) vit en local, sur le PC d'Alan, pas dans Notion. Ça implique un **agent résident local**, probablement intégré au Tauri existant côté Rust — rien de ce qui suit (contrôle d'apps, volume, périphériques) ne peut tourner sur l'infra Vercel actuelle, qui n'a aucun accès à la machine physique.

## Deux pipelines de déclenchement (décidé 01/10/2026)

- **Local, par la voix** : pour tout ce qui suppose d'être devant le PC allumé (mot d'activation, lancer/fermer une app, recherche parlée, description d'écran, "on se met au boulot", musique/volume/batterie).
- **Distant, par Telegram** : canal existant, inchangé dans son fonctionnement normal (conversation + tools), avec ajout des commandes protocoles (voir plus bas). Nécessaire pour tout ce qui doit marcher PC éteint — son propre micro ne peut pas être le déclencheur (ex. Protocole 2B).

Un **troisième canal d'entrée local** s'ajoute à ces deux : les gestes de la main filmés par la caméra (chantier 9), qui passent par le même agent local.

**Démarrage de l'écoute locale** : commence en mode "app ouverte" (le process Tauri tourne, fenêtre visible ou juste minimisée en widget-ruban — les deux comptent, minimiser ne tue pas le process). Le mode "toujours active même app fermée" (agent tray/arrière-plan résident, chantier 5 plus bas) est repoussé à après la validation des fonctionnalités vocales de base.

**Ordre de test voulu** : valider l'écoute et les actions d'abord (retour visuel/texte sur le ruban), brancher la vraie voix de sortie (TTS, chantier séparé déjà dans `STATUS.md` étape 3 de l'avatar) après — pas besoin d'attendre le TTS pour commencer à tester le vocal.

## Hybride local/cloud pour le raisonnement (décidé 01/10/2026)

Soza devient un système hybride, **pas une IA locale complète** : le mot d'activation et l'exécution des actions sur la machine sont locaux par nécessité (accès OS), mais le raisonnement (comprendre la demande, décider quoi faire) reste cloud via Groq comme en V1. Faire tourner un LLM complet en local est explicitement écarté pour l'instant — décision distincte et plus lourde, à reconsidérer séparément si jamais voulu.

- **Commandes simples → reconnues en local** (correspondance de mots-clés/petit classifieur, sans aller-retour réseau), pour la rapidité et pour que ça marche même hors connexion.
- **Phrases ambiguës avec un défaut configuré → toujours local.** Ex. "mets de la musique" n'a pas besoin du cloud si un défaut (app par catégorie) est déjà configuré.
- **Demandes vraiment ouvertes → cloud.** Ex. recherche parlée au contenu imprévisible, description d'écran.
- Ces défauts par catégorie (musique → app X, code → app Y, etc.) vivent dans un **fichier de config purement local**, lu par l'agent Tauri — pas dans Notion (cohérent avec le principe directeur ci-dessus). Pas d'écran/commande d'édition à distance prévu ; à éditer sur la machine elle-même.

## Chantier 1 — Retirer le mode ACTIF/PAUSE, garder une seule personnalité

Décision prise (30/09/2026), remplace l'ancienne cible "une seule personnalité en gardant les modes" — le système de mode est retiré, pas juste fusionné. **Fait le 07/10/2026** (en fin de V1, voir `STATUS.md`, section « Personnalité unique — Friday ») : il y avait deux personas selon le mode, Ikkaku (ACTIF, coach strict) et Jarvis (PAUSE, calme/protecteur) ; elles sont fusionnées dans `lib/ai/prompts/friday.ts`.

- **Portée du retrait** (vérifiée par grep le 30/09/2026, à revérifier avant d'exécuter — le code peut avoir bougé d'ici la V2) : touche `lib/modes.ts`, `lib/briefing.ts`, `lib/ai/client.ts`, `lib/ai/tools.ts`, `lib/notion/progress.ts`, `lib/notion/agenda.ts`, `lib/types.ts`, `lib/ai/prompts/jarvis.ts` ; un champ Notion **Soza Réglages** (`shiftActive`/`shiftStartHour`/`shiftEndHour`) ; le tool IA `update_mode_schedule`.
- **Distinct à garder** : le champ Agenda `Type` (Shift/Perso), qui sert uniquement à exclure les blocs de travail du briefing du matin (`getUpcomingAgenda()`), n'a rien à voir avec la personnalité/le ton — probablement à conserver même sans mode ACTIF/PAUSE (à confirmer le moment venu).
- Concerne aussi `lib/ai/prompts/` (un seul prompt au lieu de deux) et la voix (une seule voix à choisir, chantier 3). **Chantier 1 fait le 07/10/2026** : prompts fusionnés dans `lib/ai/prompts/friday.ts`, `lib/modes.ts` et tout le code ACTIF/PAUSE retirés ; le tool `update_mode_schedule` est supprimé (l'heure du briefing se règle déjà par conversation). Les colonnes `Mode` des bases Notion Agenda et Progression ont aussi été retirées (13/10/2026) : rien ne reste.
- Pas de collision de nom à craindre avec le futur "mode travail" (protocole 7E3A, chantier 2) : une fois ACTIF/PAUSE retiré proprement du code et des prompts, il ne reste rien avec quoi il pourrait se confondre.

## Chantier 2 — Système de protocoles

Un protocole est une **séquence nommée d'actions** (lancer une app, en fermer une, appeler une API externe). Primitif commun à toute cette liste (protocoles ET commandes vocales comme "lancer/fermer une app" ou "on se met au boulot") — un moteur générique unique vaut mieux que du code par protocole, vu que la liste grandit déjà (6H9K sans détails = d'autres viendront).

**Déclenchement et rendu (décidé 01/10/2026)** :
- Détection **stricte** sur Telegram (phrase-clé exacte, ex. "Protocole 2B", pas une recherche de mot-clé dans une phrase libre) — même principe que l'ancienne commande `/mode actif|pause` (regex ancrée qui court-circuitait le LLM). **Cette commande a disparu avec `lib/modes.ts` le 07/10/2026** : le mécanisme est à réintroduire (le webhook passe aujourd'hui tout message texte au worker et au modèle), pas à « étendre ».
- Rendu : une phrase de début ("Lancement du protocole 2B") puis une phrase de fin une fois toutes les étapes terminées — pas de message par étape intermédiaire. Phrase de fin : générique si tout a réussi, détail de ce qui a échoué (quelle étape, pourquoi) sinon — implique que chaque étape vérifie et remonte son propre statut, pas juste un enchaînement de commandes lancées à l'aveugle.

**Protocole 2B** : lancement du PC via l'API communautaire Meross (sinon on saute à l'étape suivante), puis lancement de Sunshine + Playnite + si possible Parsec, pour jouer à distance depuis la Ayn Thor. Points ouverts :
- Wake-on-LAN vs coupure/reprise secteur brute via le plug Meross — comportement différent selon que le PC était éteint ou en veille, à clarifier avant d'implémenter.
- Doit être déclenché via Telegram, pas en local : si le PC est éteint, son micro l'est aussi.

**Protocole 7E3A** : lancement du PC + "mode travail" + VS Code ouvert, pour travailler à distance depuis le téléphone ou la Ayn Thor via Parsec. Même mécanisme de détection/rendu que 2B. Nom "mode travail" conservé tel quel. Parsec est donc une **dépendance partagée** entre 2B (jeu à distance) et 7E3A (travail à distance), pas spécifique à un seul protocole — encore un argument pour le moteur générique.

**Protocole 6H9K** : existe, aucun détail donné pour l'instant.

## Chantier 3 — Fonctionnalités vocales

**Mot d'activation** : "Soza" → réponse courte ("oui"/surnom). Moteur choisi : **openWakeWord** (open source, local, gratuit, sans limite d'usage), plutôt que Picovoice Porcupine (commercial, setup en minutes via leur console mais dépendance à un service tiers même si l'inférence tourne en local).
- Entraînement par génération **synthétique** (notebook Colab fourni par le projet : voix TTS variées + bruit/pitch/vitesse/réverbération simulés), pas par enregistrement répété de sa propre voix — possibilité d'ajouter de vrais enregistrements plus tard si la précision s'avère insuffisante.
- Inférence prévue en Rust via le crate `ort` (ONNX Runtime) pour s'intégrer à l'agent local Tauri ; l'entraînement reste en Python/Colab.

**Ordre de test des fonctionnalités** (décidé 01/10/2026, du plus simple au plus dur) :
1. **Lancer/fermer une app nommée** — bénéficie directement de la reconnaissance locale (contrôle de processus via Tauri/Rust, liste d'apps autorisées).
2. **Recherche rapide parlée** (ex. "cherche comment faire des pâtes carbonara") — réutilise le pattern tool-calling déjà en place (Groq), plus un outil de recherche web à ajouter ; réponse à dire à voix haute (dépend du TTS).
3. **"Qu'est-ce que je suis en train de regarder ?"** — capture d'écran répétée (pour analyser une vidéo par ex.) + modèle avec vision. Le plus lourd techniquement et le plus sensible côté vie privée (peut capturer un mot de passe ou un document confidentiel à l'écran) — volontairement en dernier.

**Non ordonné / à décider plus tard** :
- "On se met au boulot" — probablement pas une fonctionnalité séparée mais un protocole comme 7E3A, juste déclenché à la voix plutôt que nommé.
- Musique / volume système / % batterie souris — trois intégrations isolées au niveau OS/matériel. La batterie de la souris est la plus incertaine : dépend entièrement du fabricant et de si le périphérique expose sa batterie par un protocole standard ou propriétaire (à vérifier sur le matériel réel le moment venu).

## Chantier 4 — Comprendre les pauses de plusieurs jours

Quand l'utilisateur dit qu'il prend une pause de X jours (ex. un week-end pour se ressourcer), Soza doit le comprendre et l'intégrer : ne pas relancer/mettre la pression pendant la période, ne pas compter ces jours comme un abandon, et reprendre proprement au retour. Motivation : l'utilisateur a eu l'impression de perdre le fil à un moment.

Pistes : nouveau tool IA type `set_break` (dates début/fin) persisté dans Notion (base Réglages ou Agenda) ; briefings/bilans suspendus sur la période ; message de reprise avec récap de là où il en était. Simplifié par le retrait du streak (déjà fait en V1, 30/09/2026) : plus rien à "casser" numériquement pendant une pause, reste la question du silence des briefings/bilans sur la période.

**Version minimale faite le 06/10/2026 (en V1, à cause d'un besoin réel)** : outils `set_break` (dates de début et de fin) et `cancel_break`, pause stockée dans Redis (clé `break`, durée de vie jusqu'à 3 jours après la fin). Pendant la pause, `api/cron-morning.ts` et `api/cron-evening.ts` n'envoient rien. Le briefing du lendemain de la fin accueille la reprise : `bilanLine()` n'annonce pas de bilan manquant et rappelle le dernier bilan d'avant la pause. Le prompt de conversation reçoit désormais la date du jour (sinon « ce week-end » ne peut pas être converti en dates). **Fait le 12/10/2026 (étape 2 de la V2)** : `/api/dashboard` expose `pause` (`{ start, end }` ou `null`, seulement si elle est en cours ou à venir) et le bloc briefing l'affiche : pause en cours = « En pause jusqu'au … inclus » à la place du briefing, pause à venir = rappel sous le briefing. **Décidé de ne pas la persister dans Notion** : Redis suffit (elle est posée et lue par conversation) et une base de plus ne changerait rien à l'affichage. **Reste** : rien d'obligatoire ; non vérifié contre le vrai Redis tant que le backend n'est pas redéployé.

## Chantier 5 — Widget en barre des tâches, activable à la voix, app fermée

Prolonge l'étape 5 de l'"Ordre de réalisation" de l'avatar dans `STATUS.md` (widget de bureau en fenêtre Tauri secondaire). Ajout : Soza tourne en arrière-plan (icône zone de notification / tray Tauri) et s'active par commande vocale même quand la fenêtre principale est fermée. Dépend du chantier 3 (STT, écoute en arrière-plan testée et validée en mode "app ouverte" d'abord) et du chantier 6 (coût en ressources d'une écoute permanente).

**Premiers éléments faits en V1 (08/10/2026)** : l'application de bureau a déjà un **thread Rust résident** (`src-tauri/src/main.rs`) qui mesure l'application au premier plan toutes les 5 s, une **icône de zone de notification** (clic gauche : afficher la fenêtre ; clic droit : « Afficher Soza » / « Quitter »), le **démarrage automatique avec Windows** (`--autostart` : fenêtre masquée) et un **installeur NSIS**. Ce sont les fondations de l'agent local de ce chantier et du chantier 3. **Reste** : l'écoute vocale en arrière-plan et le widget animé ; le suivi du temps d'écran, le menu de la zone de notification et le démarrage automatique ne sont pas encore vérifiés dans l'app installée.

## Chantier 6 — Optimisation du dossier et du code (performances)

Objectif : ne pas consommer trop de ressources, surtout avec un widget/écoute résidents. Pistes à vérifier par mesure, pas à l'aveugle : code mort listé dans `STATUS.md` ("Nettoyage pré-existant"), dépendances inutilisées, poids du bundle, coût CPU/GPU du système de particules (nombre de particules, `devicePixelRatio`, pause du rendu quand la fenêtre est masquée), taille des dossiers (`node_modules`, `src-tauri/target`, `dist`), empreinte mémoire de l'app Tauri en tray.

**Première passe faite en V1 (08/10/2026), mesurée** : exécutable de release de 9,75 à 6,55 Mo (−33 %), 5 dépendances inutilisées retirées, fonction `/api/dashboard` de 925 à 482 ko (séparation de la validation Zod et du contrôle d'accès), requêtes Notion des crons réduites (matin 3 à 2, soir 5 à 3). **Restent, non faites car elles changent le visuel ou le comportement** : mettre en pause les boucles three.js quand la fenêtre est masquée (le CPU fenêtre masquée n'a pas pu être mesuré), un rendu plus léger, retirer Zod du webhook, découper le chunk JS. Détail dans `STATUS.md`, section « Qualité / robustesse ». **Troisième passe (12/10/2026)** : mesure dans l'app installée (120 % de CPU, 20 images/s de particules), cause = réfraction `backdrop-filter` des cartes de verre, coupée par décision de l'utilisateur (30 % de CPU, 60 images/s) ; le reste de la liste (chunk JS, calcul GPU des particules) est volontairement laissé, faute de gain mesurable.

## Chantier 7 — Gérer plusieurs projets en même temps

Lève la limite actuelle : un seul projet "En cours" à la fois côté Notion (`Statut` des Idées). À redéfinir : plusieurs projets "En cours" simultanés, sur quoi porte le bilan du soir, comment le briefing les présente, et comment `record_progress` associe un bilan à un projet. Plus simple à traiter maintenant que le streak est retiré (30/09/2026) — `record_progress` n'a plus de logique de projet "en cours" à généraliser, `getCurrentProject()` a été supprimé de `lib/notion/idees.ts` avec le reste du gating et sera à réintroduire (probablement sous une autre forme, multi-projets) pour ce chantier.

## Chantier 8 — Documentation "comment on crée Soza" pour le portfolio

Seul chantier de ce fichier **déjà en cours**, pas bloqué par la fin de la V1. Docs de construction du projet (architecture, choix techniques et leurs raisons, bugs rencontrés, évolution du design Blender → particules → app) destinée à être réutilisée plus tard dans le portfolio.

- **Fait (30/09/2026)** : première version de `docs/portfolio/BUILD-LOG.md` — architecture, choix techniques et pourquoi, bugs rencontrés, décisions produit et leur raison, évolution du design de l'avatar. Lien ajouté depuis `README.md`.
- À compléter au fil des prochaines sessions (pipeline vocal, retrait du mode en V2, protocoles, etc.) plutôt que réécrit d'un coup.

## Chantier 9 — Interaction par gestes de la main (caméra)

Ajouté le 06/10/2026. Au départ **surdev assumé** (défi personnel pour construire l'agent qu'il veut vraiment, plus proche de Jarvis/FRIDAY) ; l'utilisateur a précisé le 12/10/2026 que ce n'est **plus du surdev**, c'est un chantier normal de la V2, placé en dernier par l'ordre de difficulté. Reste de la V2 (aucun code avant le début de la V2), et la liste d'actions est volontairement ouverte — il en ajoutera au fur et à mesure.

**Actions voulues (liste de départ)** :
1. Faire défiler (scroll) une page.
2. Zoomer sur différents types de documents ou d'applications (exemples cités : Blender, Affinity, un PDF).
3. Déplacer une fenêtre d'un écran à un autre.
4. Gérer le son (déjà possible aussi à la voix, voir chantier 3 — pas gênant d'avoir les deux).

**Prérequis : un détecteur de mains/doigts avec rendu de contrôle (demandé le 06/10/2026)** — à construire **avant** toute action. Il faut identifier parfaitement les doigts des **deux mains**, avec un rendu visible par-dessus l'image de la caméra :
- **un point par articulation** (le modèle de suivi en donne 21 par main : poignet + 4 points par doigt, dont le bout) ;
- **un bâton par doigt** (segments reliant les points, qui matérialisent les phalanges) ;
- **un carré par main** (boîte englobante), avec la main gauche et la main droite distinguées (couleur/étiquette différente).

Le but est de voir en direct si le suivi est fiable avant de construire les gestes dessus : les deux mains identifiées en continu, **gauche/droite qui ne s'inversent pas** (attention à l'image miroir de la webcam), tenue en cas de doigts qui se cachent, effet de la lumière. Les mouvements seront ensuite construits sur ces points et resteront **généralement simples** : état de chaque doigt (tendu/plié), pose de la main, vitesse de déplacement, avec un lissage des points pour éviter le tremblement. Ce rendu sert aussi d'outil de réglage et pourra rester disponible en option (aperçu activable) plutôt que visible en permanence.

**Nombre de mains (décidé 06/10/2026)** : une seule main suffit pour la majorité des gestes (scroll, son, déplacement de fenêtre). Le **zoom** utilise **les deux mains** (écartement/rapprochement, comme un pincement sur écran tactile), notamment dans les applications. Conséquence : le zoom exige que les deux mains soient détectées en même temps, alors que les autres gestes ne dépendent que d'une main.

**Geste de zoom envisagé (06/10/2026, à valider avec le détecteur)** : les deux mains entrouvertes, en diagonale, le dos de chaque main tourné vers l'autre ; l'écart entre les deux mains pilote le zoom. À vérifier au test : (1) les points restent-ils fiables quand les mains sont vues de profil/en diagonale par la caméra (les modèles de suivi sont moins bons sur des mains vues de côté) ; (2) l'orientation dos/paume doit être déduite des points (sens du plan de la main) ; (3) la posture entrouverte demande des seuils sur l'état des doigts. Cette posture inhabituelle est un avantage : elle sert aussi de **geste d'engagement** naturel contre les zooms accidentels. Repli prévu si le suivi est trop instable : le pincement pouce-index sur chaque main.

**Dézoom (décidé 06/10/2026)** : geste distinct du zoom, pour éviter toute confusion. Même schéma à deux mains entrouvertes, mais **paumes face à face** (au lieu des dos) et les mains **se rapprochent** l'une de l'autre. C'est donc l'**orientation dos/paume** qui choisit la direction (dos face à face + écartement = zoom avant ; paumes face à face + rapprochement = zoom arrière), ce qui rend la détection fiable de l'orientation dos/paume critique. 

**Quantité de zoom : proportionnelle à l'écartement (décidé 06/10/2026)** — la variation de distance entre les deux mains détermine directement l'ampleur du zoom (pas de paliers façon cran de molette). La distance est à normaliser par la taille apparente des mains, sinon elle dépend de la distance à la caméra.

**Comportement de cliquet (décidé 06/10/2026)** : dans une pose donnée, seul le mouvement dans le sens du geste compte. Dans la pose "dos face à face", seul l'écartement zoome ; si les mains se rapprochent dans cette même pose pour recommencer, rien ne se passe et la distance de référence est recalée sur la nouvelle position, de sorte que le prochain écartement reparte de là (comme quand on relève un doigt sur un pavé tactile). Symétriquement, dans la pose "paumes face à face", seul le rapprochement dézoome. Sortir de la pose (une main qui quitte le cadre ou change d'orientation) interrompt le geste. Les seuils (mouvement minimal avant de compter, tolérance au tremblement) sont à régler avec le détecteur.

**Le geste exact de chaque action n'est pas défini** : l'utilisateur doit décrire le vocabulaire de gestes (à discuter, comme pour les protocoles).

**Pistes techniques (analyse du 06/10/2026, à valider avant d'implémenter)** :
- **Suivi des mains en local** : la caméra est lue dans le webview Tauri (`getUserMedia`) et un modèle de suivi de main (ex. MediaPipe Hands / Gesture Recognizer, tournant en WASM/WebGL, ~21 points par main) transforme l'image en points. Aucune image ne quitte la machine, cohérent avec le principe "local plutôt que cloud" ; à ne pas faire passer par le cloud ni Groq.
- **Gestes → actions** : règles simples sur les points (distance de pincement, paume ouverte qui glisse, poing fermé...) puis table de correspondance dans la **config locale** (même fichier que les défauts de catégories du chantier 3). Pas besoin de LLM : même logique "commande simple reconnue en local".
- **Exécution** : injection d'entrées OS depuis l'**agent local Rust** — le même que celui des protocoles et du vocal (molette/touches pour scroll et zoom, API fenêtre Windows pour déplacer entre écrans, API audio Windows pour le volume). Le geste devient un **troisième canal d'entrée local**, à côté du mot d'activation vocal et de Telegram.
- **Zoom** : il n'existe pas de geste "zoom" universel côté OS, il faut un **profil par application** (Blender, Affinity, lecteur PDF réagissent chacun à leurs propres raccourcis ou à Ctrl+molette) → détection de l'application au premier plan + table de profils dans la config locale. C'est la partie la plus laborieuse de la liste.
- **Déplacer une fenêtre d'un écran à l'autre** : demande de connaître la géométrie des écrans et d'avoir un état "saisie" (ex. poing fermé = je tiens la fenêtre, je bouge, j'ouvre = je la lâche). Probablement l'action la plus difficile à rendre fiable.

**Risques et points ouverts** :
- **Déclenchements involontaires** : une caméra qui regarde en continu va voir des mains qui bougent sans intention (clavier, café...). Il faudra un **geste d'armement** explicite (équivalent du mot d'activation) et un désarmement automatique quand la main sort du cadre.
- **Fenêtres lancées en administrateur** : Windows refuse l'injection d'entrées vers une application élevée si Soza ne l'est pas — à vérifier sur les applications visées.
- **Matériel** : position de la webcam par rapport à ses écrans (plusieurs écrans), éclairage, latence — à tester avec le matériel réel avant de promettre quoi que ce soit.
- **Ressources** : caméra + modèle de suivi en continu coûtent du CPU/GPU, à mesurer (chantier 6) ; même logique que l'écoute locale : commencer en mode "app ouverte" avant tout fonctionnement en arrière-plan (chantier 5).
- **Vie privée** : indicateur visible quand la caméra est active, et traitement 100 % local.

**Ordre de test proposé (à confirmer avec l'utilisateur)** : d'abord le détecteur de mains et son rendu de contrôle (étape 0, voir "Prérequis" plus haut), puis scroll (un seul mouvement continu, le plus simple à valider) → son (déjà couvert par l'API audio du chantier 3) → zoom (profils par application) → déplacement de fenêtre entre écrans en dernier.

## To-do V2 — ordre d'exécution (décidé 12/10/2026)

Du **plus simple au plus dur**, un seul chantier à la fois (voir Garde-fou). Cases à cocher au fil des sessions.

- [ ] 0. Remettre au vert les 2 tests d'acceptation de cadence (lire `REST_FPS` au lieu de 30 en dur) et vérifier la liste « Non vérifié à la clôture » de `STATUS.md` — **tests faits le 12/10/2026** (20/20 acceptation, 263 rapides, 3 Rust, `tsc` propre) ; reste la liste non vérifiée (app installée, `test:live`, passe sécurité, textes de briefing)
- [x] 1. Petits restes de la V1 : statut Notion `Terminé`, catégorie Notion lue par le code, nom et logo des applications inconnues du temps d'écran — **fait le 12/10/2026** (voir `STATUS.md`) ; restent à vérifier contre le vrai Notion après redéploiement
- [x] 2. Pause de plusieurs jours (chantier 4) : l'afficher dans le dashboard — **fait le 12/10/2026** ; persistance Notion écartée (voir chantier 4)
- [x] 3. Optimisation (chantier 6) : re-mesurer, puis traiter ce qui reste — **fait le 12/10/2026** : cause du lag trouvée et corrigée (réfraction du verre coupée : 120 % → 30 % de CPU, 20 → 60 images/s), voir `STATUS.md` « Troisième passe d'optimisation »
- [x] 4. Lancer/fermer une app nommée + fichier de config local (chantier 3, fonction 1) : fondation de l'agent local — **fait le 13/10/2026** : barre `Ctrl+K`, liste blanche `apps.json`, fermeture douce (voir `STATUS-V2.md`)
- [x] 5. Recherche rapide parlée (chantier 3, fonction 2) — **fait le 14/10/2026 côté Telegram** : recherche intégrée de Groq, réponse courte lisible à voix haute (voir `STATUS-V2.md`) ; barre `Ctrl+K` et voix pas branchées
- [x] 6. Musique, volume système, batterie de la souris (chantier 3) — **fait le 15/10/2026 via `Ctrl+K`** : volume (Core Audio), musique (commandes multimédia de Windows), batterie (HID++ Logitech, lue 34 %) ; « mets de la musique » lance Spotify, « mets <titre> » cherche et lance le morceau (identifiants Spotify à fournir, voir `STATUS-V2.md`)
- [ ] 7. Plusieurs projets en parallèle (chantier 7)
- [ ] 8. Moteur de protocoles : 2B, 7E3A, 6H9K (chantier 2)
- [ ] 9. Voix : mot d'activation, reconnaissance vocale, synthèse vocale, ruban réactif à l'audio (chantier 3)
- [ ] 10. Agent résident en arrière-plan et widget animé (chantier 5)
- [ ] 11. « Qu'est-ce que je regarde ? » (chantier 3, fonction 3)
- [ ] 12. Gestes de la main (chantier 9) : détecteur et rendu de contrôle, puis scroll → son → zoom → déplacement de fenêtre

Chantier 8 (documentation portfolio) : en continu, hors liste. Chantier 1 : fait.

**Point d'attention** : les points 4 à 6 sont décrits comme déclenchés à la voix, mais l'écoute (point 9) arrive après. Les tester d'abord par une entrée texte (Telegram ou champ dans le ruban), comme prévu par « Ordre de test voulu ».

## Garde-fou

La V1 est terminée (09/10/2026) : le socle attendu par ce fichier est en place (dashboard branché sur le vrai backend, design intégré, intro branchée, code mort supprimé). Quand la V2 démarrera : choisir **un seul chantier à la fois**, dans l'ordre déjà décidé (l'écoute et les actions d'abord, la voix de sortie ensuite, du plus simple au plus dur), et ne pas en ouvrir un second avant d'avoir fini le premier, sous peine de ne jamais finir ni l'un ni l'autre.
