# Soza — étude de cas et journal de construction

Soza est un assistant personnel piloté par Telegram, doublé d'une application de bureau, construit de zéro : la V1 en trois semaines (16 septembre → 9 octobre 2026), puis la V2, en cours (étapes 0 à 8 faites au 20/10/2026, étape 9 commencée). Ce document raconte **comment** : l'architecture, les choix et leurs compromis, les bugs et leurs causes racines, ce qui a été essayé puis abandonné, et la méthode de travail.

Il se lit à trois niveaux :

| Si vous avez… | Lisez |
| --- | --- |
| 2 minutes (recruteur, manager) | [En bref](#en-bref), [Compétences démontrées](#compétences-démontrées), [Bilan de la V1](#bilan-de-la-v1) |
| 10 minutes (développeur junior ou curieux) | [Architecture](#architecture), [Le cœur IA](#le-cœur-ia--tool-calling-et-prompts), [Bugs et causes racines](#bugs-et-causes-racines), [Ce qu'un junior peut en tirer](#ce-quun-développeur-junior-peut-en-tirer) |
| Le temps d'un vrai relecteur (senior) | tout, en particulier [Décisions et compromis](#décisions-et-compromis), [Qualité, tests, sécurité](#qualité-tests-sécurité) et [Limites assumées](#limites-assumées) |

L'état d'avancement détaillé et daté vit dans [`docs/ai/STATUS.md`](../ai/STATUS.md) (V1) et [`docs/ai/STATUS-V2.md`](../ai/STATUS-V2.md) (V2), qui changent plus vite que ce document et font foi. La suite prévue est décrite dans [`docs/ai/SozaV2.md`](../ai/SozaV2.md).

---

## En bref

**Le problème.** Tenir une discipline de travail sur un projet personnel, malgré des horaires de travail postés (shifts) qui fatiguent. Deux exigences opposées à concilier : demander de la régularité sans mettre la pression quand le corps est épuisé.

**La réponse.** Un assistant qui vit là où l'utilisateur est déjà (Telegram) :
- il comprend le langage naturel (« ajoute un rendez-vous jeudi à 14 h », « je prends mon week-end ») et agit dans Notion via des outils IA ;
- il envoie un **briefing le matin** (météo, agenda, bilan de la veille) et demande un **bilan le soir**, à des horaires modifiables en conversation ;
- une **application de bureau** (Tauri + React) affiche tout cela dans un tableau de bord en « verre liquide » devant un ruban de Möbius en particules animé en temps réel.

**Statut.** Backend en production et utilisé au quotidien. L'application de bureau a un installeur Windows, mesure le temps d'écran réel et ouvre sur l'intro en particules puis le dashboard en verre ; 397 tests couvrent le projet (350 rapides, 26 en Rust et 21 scénarios navigateur, voir [Tests](#tests)). **La V1 est terminée (déclarée le 09/10/2026).** Quatre étapes de finition ont suivi le 12/10 : tests de cadence corrigés, statut « Terminé » et catégorie Notion lus par le code, pause de plusieurs jours visible dans le dashboard, et lag du dashboard mesuré puis supprimé (réfraction du verre coupée : ~120 % → ~30 % d'un cœur, 20 → 60 images/s). Le démarrage automatique réel, la zone de notification et le premier texte des briefings restent à observer à l'usage (voir le [bilan de la V1](#bilan-de-la-v1)). La V2 (assistant vocal local, protocoles, gestes), cadrée en 13 étapes, a ensuite avancé du 13 au 20/10 : ouvrir et fermer des applications depuis une barre `Ctrl+K`, recherche web de Soza, volume / musique / batterie de la souris, plusieurs projets en parallèle, un moteur de protocoles (un protocole, exclusion et ajout d'applications, ouverture directe depuis Telegram) et, après un blocage du worker sur la limite de débit de Groq, un allègement des appels au modèle. L'étape 9 (voix) est commencée : la voix de Windows dit les réponses de `Ctrl+K`, la voix finale reste à choisir. Les étapes 10 à 12 (agent résident et widget, « qu'est-ce que je regarde ? », gestes de la main) ne sont pas commencées ; l'essai réel d'un protocole sur le PC, avec un vrai Telegram, n'est pas fait.

**Un cadrage qui a évolué.** Soza est née comme un coach de discipline à deux personnalités (une exigeante, une protectrice, selon les horaires de travail). Le 07/10, l'utilisateur tenant sa cadence de travail, ce cadrage a été abandonné : une seule personnalité (« Friday »), plus de mode ACTIF/PAUSE, le produit se rapprochant d'un assistant du type Jarvis/FRIDAY. Le retrait a touché le backend (modes, prompts, outils, accès Notion, briefing, API du dashboard), les scripts et le front.

### Chiffres clés

| | |
| --- | --- |
| Durée | 3 semaines de V1 (premier commit le 16/09/2026, clôture le 09/10/2026), puis la V2 : étapes 0 à 8 du 12 au 20/10/2026, étape 9 (voix) commencée le 18/10 |
| Historique | 73 commits à la clôture de la V1, 127 au 01/11/2026 (29 pull requests fusionnées, dernière activité le 20/10) |
| Code suivi par git | ~5 070 lignes de TypeScript/CSS/Rust à la clôture de la V1 : `api/` 167, `lib/` 1 165, `src/` 3 135, `scripts/` 440, Rust 166 ; plus 2 152 lignes de tests. Le Rust atteint ~890 lignes au 01/11 (applications, volume, musique, protocole, voix) |
| Tests | 397 : 350 rapides (unitaires, intégration, régression — rejoués le 01/11, environ 3 s), 21 scénarios dans un vrai navigateur (dernier passage 21/21 consigné à l'étape 6, 15/10, non rejoués depuis), 26 en Rust (rejoués le 01/11) plus 5 essais réels ignorés par défaut |
| Endpoints serverless | 6 (webhook Telegram, worker, cron matin, cron soir, dashboard, protocole) |
| Outils IA exposés au modèle | 14, plus la recherche web intégrée de Groq (fournie par le fournisseur, pas définie dans le code) |
| Bases Notion | 5 (Idées, Agenda, Jalons, Progression, Réglages) |
| Fournisseur LLM | 1 (Groq) — un second a été essayé puis retiré |
| Dépendances d'exécution | 13 (5 inutilisées retirées le 08/10), dont `three`, `zod`, `ai` (Vercel AI SDK), `@upstash/*`, `@notionhq/client` |

Chiffres tirés de `git log` et du dépôt ; les lignes de code sont celles du 09/10/2026 (clôture de la V1), sauf le Rust. Les 350 tests rapides et les 26 tests Rust ont été rejoués le 01/11/2026 ; les 21 scénarios navigateur ne l'ont pas été depuis le 15/10, et le nombre de lignes de tests n'a pas été recompté.

### Compétences démontrées

- **Architecture serverless asynchrone** : file de jobs, webhooks, crons pilotables par API, reprise sur échec.
- **Intégration de LLM en production** : appel d'outils (tool calling) avec validation de schéma, conception de prompts, gestion des intentions ambiguës, mémoire de conversation, repli quand le modèle est indisponible.
- **Fiabilité** : fuseaux horaires, dérives de configuration entre environnements, bugs silencieux, repli quand un backend est plus ancien que l'app.
- **Qualité logicielle** : 397 tests en quatre familles (unitaire, intégration, régression par famille de bugs, acceptation dans un vrai navigateur) plus Rust ; tests qui n'utilisent jamais de vrais services ; un test de régression vérifié en réintroduisant le bug.
- **Rust et application de bureau** : thread de suivi du temps d'écran, zone de notification, démarrage automatique, installeur, réduction de 33 % de l'exécutable ; en V2, volume (Core Audio), musique (commandes multimédia de Windows), batterie d'une souris (protocole propriétaire HID++) et boucle qui exécute des protocoles venus du backend.
- **Front et graphisme temps réel** : React/Vite/Tauri, WebGL avec three.js, shaders GLSL, filtres SVG, CSS Grid animée.
- **Jugement produit** : fonctionnalités retirées volontairement plutôt que conservées par inertie, limites documentées plutôt que cachées.
- **Rigueur de méthode** : décisions datées et motivées, distinction écrite entre « vérifié » et « non vérifié », garde-fous contre la dispersion.

---

## Chronologie

| Période | Étape | Ce qui s'est passé |
| --- | --- | --- |
| 16 → 22/09 | **Preuve de concept locale** | Telegram → LLM → Notion en local ; mémoire de conversation dans Redis ; briefing du matin ; deux fournisseurs LLM branchés pour se prémunir d'un quota. |
| 23 → 24/09 | **Mise en production** | Déploiement Vercel et ses pièges (URL protégée, secrets corrompus) ; horaires et mode pilotables en conversation ; synthèse IA des idées ; heure des rendez-vous et plannings de shifts ; correction du décalage horaire UTC ; retrait de Gemini. |
| 26 → 30/09 | **Simplification du produit** | Le « Proof of Work » est remplacé par un contrôle de cohérence, puis le système de streak est retiré en entier ; le dashboard est ramené à une page plate pour repartir d'une maquette Figma. |
| 28/09 → 01/10 | **L'avatar** | Intro en particules (entrée, boucle, transformation en ruban de Möbius) ; hub statique ; fond en shader reconstruit à partir d'une photo de référence ; ombre, glow, rendu hologramme. 8 commits rien que le 30/09 pour trouver le fond. |
| 30/09 | **Dashboard branché** | Nouvel endpoint agrégé `api/dashboard.ts` ; le front passe des données factices aux vraies données Notion. |
| 06/10 | **Dashboard en verre et correctifs** | Disposition « bento » de la maquette, calendrier, blocs, frise des jalons ; correctif du briefing (bilan manquant, rappels d'agenda) ; pauses de plusieurs jours. |
| 07/10 | **Une seule personnalité, dashboard par défaut, mise en ligne** | Les deux personnalités sont fusionnées en une seule (« Friday ») et le mode ACTIF/PAUSE est retiré de tout le code ; le dashboard en verre devient la page d'accueil de l'app ; le fond passe à un aplat bleu avec des particules blanches en fil de fer ; la fusion sur `main` déclenche le déploiement de production qui met enfin en ligne les correctifs de la veille. |
| 08/10 | **Une application qui s'installe, qui mesure et qui se teste** | Le bloc « Écran » devient réel : un thread Rust mesure l'application au premier plan (données gardées sur la machine) et le détail s'ouvre au clic ; démarrage automatique avec Windows et zone de notification ; installeur Windows ; le briefing du soir est rédigé par Soza ; les colonnes Notion obsolètes sont supprimées et les 52 idées reçoivent une catégorie ; 286 tests ; passe d'optimisation mesurée (exécutable −33 %, 5 dépendances en moins, requêtes Notion des crons réduites) ; la fusion de la PR sur `main` met le tout en production. |
| 09/10 | **Fin de la V1** | Le ruban passe à 60 images/s (30 donnait une animation saccadée dans l'app installée), la barre de titre Windows 11 prend la couleur du fond, les surnoms de Soza sont variés (le prompt disait « Boss » par défaut), l'installeur est reconstruit et lancé, un déploiement de production suit la dernière fusion, et l'utilisateur déclare la V1 terminée. |
| 12/10 | **Quatre étapes de finition** | Étape 0 : les 2 tests de cadence lisent `REST_FPS` au lieu d'un 30 en dur. Étape 1 : statut « Terminé » pour les idées, catégorie Notion lue par le code (prioritaire sur les mots-clés pour les logos), noms et logos pour les applications inconnues du temps d'écran. Étape 2 : la pause de plusieurs jours s'affiche dans le dashboard. Étape 3 : la cause du lag est mesurée dans l'app installée (le filtre de réfraction du verre), puis la réfraction est coupée sur décision de l'utilisateur. PR #12 à #15. |
| 13 → 17/10 | **V2 : étapes 4 à 8** | Étape 4 : ouvrir et fermer une application nommée depuis une barre `Ctrl+K`, avec une liste blanche locale (`apps.json`) et une fermeture douce. Étape 5 : recherche web de Soza (Groq), avec repli sans recherche si l'outil échoue. Étape 6 : volume (Core Audio), musique (commandes multimédia de Windows, Spotify par nom de morceau), batterie de la souris (protocole propriétaire du fabricant). Étape 7 : plusieurs projets « En cours » en parallèle (bilan, briefings du matin et du soir). Étape 8 : moteur de protocoles (déclencheur strict, le PC vient chercher ses étapes), avec un premier protocole. Entre-temps : surnoms tirés par le code (14/10) et correctif du « demain » recopié du bilan (13/10). PR #17 à #23. |
| 18 → 20/10 | **Le worker se bloque sur la limite de Groq** | Deux messages du soir restent sans réponse et créent des doublons dans Notion : Groq plafonne à 8 000 jetons par minute, Vercel coupe à 25 s, QStash relance. Fin des relances automatiques, message d'erreur sur Telegram, échec à 20 s (PR #27) ; puis appels allégés : second appel sans outils, repli sur un autre modèle (PR #30), outils choisis par mots-clés et descriptions raccourcies (sur la branche `allegement-outils-et-ouverture-apps`, pas encore fusionnée). Journaux Groq documentés en PR #28. |
| 18 → 20/10 | **Protocoles : exclure, ajouter, ouvrir** | `Protocole 7E3A - Parsec`, `Protocole 7E3A + Spotify`, et ouverture directe `Ouvre Blender` depuis Telegram (le PC déclare la liste de ses applications, jamais leurs chemins). PR #26 pour l'exclusion ; le reste est sur la branche en cours. |
| 18 → 19/10 | **Étape 9 : la voix** | Synthèse vocale avec la voix de Windows dans `Ctrl+K` ; essais d'autres voix (Piper, clonage XTTS-v2, féminisation de la voix de l'utilisateur), tous écartés et supprimés ; la voix de Windows est remise le 19/10 « en attendant » ; voix d'une proche à reprendre avec son accord. PR #29. |
| 01 → 02/11 | **La voix : clonage XTTS abandonné, Piper sur des enregistrements consentis** | Ouverture de plusieurs applications par message Telegram, outil `get_settings` et aveu d'ignorance (PR #32). Côté voix : un échantillon de 99 s cloné avec XTTS-v2 est jugé « très médiocre » par l'utilisateur et tout est supprimé (environ 24 Go) ; la politique d'usage d'ElevenLabs interdit d'entraîner un autre modèle avec ses sorties, donc une voix ElevenLabs ne peut pas alimenter Piper ; l'utilisateur choisit Piper avec la voix d'un ami qui signe un accord écrit. 695 phrases à lire sont préparées (environ 52 minutes de parole) et environ 45 minutes sont enregistrées en MP3 : ni traitées ni installées pour l'instant. Deux Extras de confort sont documentés (articles développés, Soza qui parle selon les événements de l'ordinateur). |
| à partir de 30/09 | **V2 cadrée** | Assistant vocal local, protocoles, puis (06/10) gestes de la main : documenté, pas démarré. Le premier chantier (personnalité unique) a été fait le 07/10, en fin de V1 ; la V2 a démarré le 12/10 (étapes 0 à 8 faites au 20/10, la 8 côté code seulement, la 9 commencée ; avancement : `STATUS-V2.md`). |

---

## Architecture

```
Telegram ──▶ api/telegram-webhook.ts ──▶ QStash (file) ──▶ api/qstash-worker.ts ──▶ Groq (LLM + 14 outils + recherche web) ──▶ Notion
                    │                                              │
                    ▼                                              ▼
             valide chat_id                                  répond sur Telegram

QStash Schedules ──▶ api/cron-morning.ts / api/cron-evening.ts ──▶ Notion + Telegram
                         (silencieux pendant une pause)

Dashboard Tauri (React) ──▶ api/dashboard.ts ──▶ Notion (lecture agrégée) + Redis (dernier briefing)

Redis : mémoire de conversation (10 messages, 6 h), derniers briefings (matin et soir), pause en cours

Application de bureau (Rust) : suivi du temps d'écran en local (jamais envoyé), zone de notification, démarrage avec Windows
```

### Principes directeurs

1. **Le webhook ne fait jamais de travail long.** Il valide le `chat_id` autorisé et publie un job dans QStash ; un worker séparé appelle le modèle. Un appel IA lent ne fait donc ni expirer ni rejouer le webhook Telegram, et le système est rejouable.
2. **Toute action vérifie d'abord qui parle.** Le `chat_id` est contrôlé avant toute action ; les crons n'acceptent qu'une signature QStash valide (ou un secret de secours).
3. **Notion est la source de vérité** pour tout ce qui doit être consultable à distance (idées, agenda, jalons, bilans, réglages). Le backend lit et écrit, sans dupliquer d'état métier. Redis ne sert qu'à de l'éphémère (mémoire courte, cache du briefing, pause en cours).
4. **Les faits sont calculés dans le code, le modèle ne fait que rédiger.** Voir plus bas : c'est la leçon la plus transposable du projet.

### Organisation du dépôt

```
api/        6 endpoints serverless (edge) : webhook, worker, crons, dashboard, protocole
lib/        cœur métier : IA (client, outils, prompts), accès Notion, intégrations, mémoire Redis, dates, briefing
src/        application de bureau : features/ (dashboard, calendar, widgets, glass, intro, particles, hub…)
src-tauri/  application de bureau en Rust (~890 lignes) : héberge la vue web, mesure le temps d'écran, zone de notification, démarrage automatique, commandes locales (applications, volume, musique, batterie), boucle des protocoles, voix
tests/      unit, integration, regression, acceptance + faux Notion, faux Redis et réseau bloqué
scripts/    configuration et migration Notion/QStash, test contre les vraies APIs
docs/       état du projet, contexte IA, schéma Notion, V2, ce journal
```

---

## Le cœur IA : tool calling et prompts

Le modèle ne « répond » pas seulement : il agit, via 14 outils (créer une idée, planifier un rendez-vous, enregistrer un bilan, changer l'heure du briefing, mettre en pause…), chacun défini par un schéma Zod. Quelques choix qui comptent :

**Une phrase peut déclencher plusieurs actions.** Jusqu'à 4 étapes d'outils par message (« crée cette idée et planifie un point jeudi »).

**Le doute vaut mieux que l'action.** Une consigne dédiée interdit de créer une idée ou un jalon sur une intention ambiguë : le modèle pose d'abord une question courte. Validé en conditions réelles.

**Une seule personnalité.** Deux prompts de personnage (l'un exigeant, l'autre protecteur, choisis selon l'heure) ont été fusionnés en un seul, `friday.ts`, rédigé par l'utilisateur : le prompt dit à Soza que « Soza » est son nom, qu'elle parle à la première personne, et fixe son registre. Moins de code : le choix du personnage et la détection du mode ont disparu.

**Le modèle décide des détails qu'il peut décider.** La taille d'un projet (Petit / Moyen / Grand) est estimée par le modèle selon une grille donnée dans la description de l'outil, au lieu d'être demandée à l'utilisateur. À l'inverse, il lui est interdit d'inventer le contenu d'une note.

**Les entrées d'un LLM ne respectent pas votre schéma.** Groq renvoie parfois `null` pour un paramètre optionnel au lieu de l'omettre ; avec `.optional()`, toute la validation échouait et l'action se perdait sans message. Passage à `.nullish()` sur les six paramètres concernés.

**Un modèle ne connaît pas la date du jour.** En ajoutant les pauses, on s'est rendu compte que le prompt de conversation ne contenait aucune date : « ce week-end » ou « demain » ne pouvaient pas être convertis en dates réelles pour les outils. La date du jour (fuseau de Paris) est désormais injectée.

**Le briefing : faits en code, rédaction par le modèle.** Voir l'étude de cas dans [Bugs et causes racines](#bugs-et-causes-racines). Si le modèle est indisponible (quota, panne), un briefing basique est envoyé plutôt que de faire échouer le cron.

**Le briefing du soir, avec ses garde-fous (08/10).** Le soir aussi, Soza rédige : la journée (tâches faites sur le total), le prochain jalon, l'agenda des 7 jours, puis la question du bilan. Les faits sont calculés dans le code, et le prompt interdit d'inventer du travail ou de conclure qu'une journée est improductive parce que l'agenda est vide. Si le texte ne contient pas le mot « bilan », une question de bilan est ajoutée, car le briefing du matin en dépend ; si le modèle est indisponible, la phrase fixe d'origine part quand même. Une version courte (deux à trois phrases) est gardée pour le dashboard.

**Plusieurs projets en parallèle (15/10).** Le bilan reçoit la liste des projets sur lesquels l'utilisateur a avancé (`projectsWorkedOn`), écrite en tête du texte du bilan : aucune colonne Notion à ajouter, le briefing du matin relit le texte tel quel. Les noms sont rapprochés des vrais titres côté code, car le modèle ne les connaît pas exactement (« le portfolio » pour « Portfolio web »). Le briefing du soir donne le prochain jalon de chaque projet en cours (trois au maximum). Une batterie contre le vrai modèle a trouvé un défaut que les tests simulés ne voyaient pas : avec le champ nommé `projects`, le modèle l'omettait une fois sur deux ; renommé `projectsWorkedOn` avec une consigne plus précise, il l'a renseigné six fois sur six. Défaut résiduel, non corrigé : sur un projet explicitement « pas touché », il le liste encore une fois sur trois.

**Recherche web (14/10).** Le modèle dispose de la recherche intégrée de Groq et décide seul de s'en servir, pour une question extérieure ou récente seulement ; la réponse doit pouvoir être lue à voix haute (deux ou trois phrases, ni liste ni lien), et les marques de citation que la recherche ajoute sont retirées dans le code. Deux faits mesurés sur le vrai service : une recherche coûte 19 000 à 41 000 jetons d'entrée contre environ 3 700 sans, et le quota quotidien (200 000 jetons) est partagé avec les briefings. L'outil de recherche est parfois rejeté par Groq, ce qui laissait Telegram sans réponse, d'où un repli : un second essai sans la recherche, qui n'a lieu que si aucun outil d'écriture n'a déjà tourné, pour ne jamais écrire deux fois.

**Des actions réelles sur le PC, bornées (13 → 17/10).** Rien n'est exécuté depuis une phrase libre : la barre `Ctrl+K` ne lance que les applications d'une liste blanche locale, et la fermeture est douce (l'application peut proposer d'enregistrer). Un protocole sur Telegram n'est reconnu que si le message entier est `Protocole <code>` avec un code connu, et c'est le worker qui l'exécute, jamais le modèle ni le webhook. Le backend ne donne jamais de chemin : il décrit des étapes (`ouvrir <application>`), le PC les résout avec sa propre liste. Un job différé prévient sur Telegram si le PC ne répond pas, au lieu du silence.

**Exclure, ajouter, ouvrir (18 → 20/10).** `Protocole 7E3A - Parsec` lance le protocole sans Parsec, `Protocole 7E3A + Spotify` ajoute une étape ; `Ouvre Blender` ouvre une seule application, par le même circuit. Une exclusion qui ne correspond à aucune étape (faute de frappe) refuse tout plutôt que de lancer quelque chose d'inattendu. Seul un message qui est exactement « verbe + application déclarée » est intercepté : « ouvre un jalon pour demain » reste au modèle. Le backend ne connaît pas `apps.json` ; l'app du PC lui envoie la liste des noms (jamais les chemins) au démarrage, puis quand le fichier change.

**Faire tenir les appels sous la limite de Groq (18 → 20/10).** Chaque appel envoyait environ 3 700 jetons avant même le message (prompt de personnalité ~1 240, 13 outils ~2 030, définition de la recherche web ~430) pour un plafond de 8 000 par minute et par modèle ; une action avec un outil faisait deux appels, soit 7 603 jetons. Quatre leviers : (1) le second appel, qui ne sert qu'à écrire « c'est fait », n'a plus d'outils sauf un seul (7 603 → 5 275 jetons, −31 %, mesuré sur le vrai compte) ; (2) sur une erreur 429, passage au modèle suivant (`gpt-oss-120b` puis `gpt-oss-20b`, compteurs séparés) au lieu d'attendre les 2 à 36 s demandées par Groq, jamais après qu'un outil a écrit, pour ne pas dupliquer ; (3) descriptions d'outils raccourcies (environ −260 jetons par appel, mesuré) ; (4) seuls les outils dont un mot-clé apparaît dans le message sont envoyés (un rendez-vous n'en envoie plus que ~280 jetons au lieu de ~2 560 pour tous, **estimation** par caractères ÷ 3,3, pas un décompte Groq), et un message sans mot-clé reconnu reçoit les 13 outils pour ne jamais bloquer une action. Le cache de prompt de Groq, que la documentation annonce, ne se déclenche pas sur ce compte (aucun jeton en cache rapporté, même avec un préfixe statique) : on ne compte pas dessus. Le palier payant est écarté par l'utilisateur, d'où un allègement plutôt qu'un achat de marge. Le repli de modèle n'a été testé qu'avec des faux services.

**Lire ses réglages, et avouer ce qu'on ne sait pas (01/11).** Demander à Soza ses réglages n'avait aucune bonne réponse : aucun outil ne lisait les heures du briefing, la pause ou la liste des applications, et rien n'interdisait au modèle de répondre au hasard. Deux changements. Un outil `get_settings` en lecture seule rend ces trois informations, chaque source lue séparément : une lecture en échec est transmise comme « indisponible » plutôt qu'omise, pour que le modèle l'avoue au lieu de combler le trou. Et une consigne dans tous les prompts de conversation : ne jamais deviner ni inventer, ne dire que ce qu'un outil a rendu, avouer explicitement en une phrase quand on ne sait pas, et ne jamais annoncer une action comme faite sans confirmation de l'outil. Ce qui est testé, c'est la consigne envoyée et l'outil ; **le comportement réel du modèle ne l'est pas**, une consigne réduit les inventions sans les garantir. Elle ne peut toujours pas lire l'agenda, les idées ni les bilans : sur ces sujets, la bonne réponse est « je ne sais pas ».

---

## Décisions et compromis

| Décision | Alternative écartée | Pourquoi | Coût accepté |
| --- | --- | --- | --- |
| **QStash** pour planifier briefing et bilan | Crons Vercel | Le plan gratuit limite à 1 exécution par jour avec ±59 min d'imprécision ; QStash a une API qui permet de changer l'heure *depuis une conversation*, sans redéployer | Un service tiers de plus |
| **Webhook + file + worker** | Tout traiter dans le webhook | Un appel IA lent ne doit pas faire expirer/rejouer le webhook | Plus de pièces mobiles |
| **Notion comme source de vérité, y compris la config** | Variables d'environnement, base dédiée | Changer l'heure du briefing et du bilan en conversation naturelle, sans toucher au déploiement | Latence et limites de l'API Notion |
| **Un bloc Notion par jour de shift** | Un évènement récurrent | L'API Notion ne gère pas la récurrence : un bloc unique s'afficherait comme un évènement continu | Beaucoup de pages créées |
| **Redis limité à l'éphémère** | Y mettre aussi l'état métier | Deux sources de vérité = divergences | Rien d'autre que du cache en Redis |
| **La pause dans Redis, pas dans Notion** | Nouvelle propriété Notion | Évite de modifier le schéma de la base de production pour un état transitoire ; expire seul 3 jours après la fin | Pas visible dans Notion |
| **Dashboard branché en dernier** | UI d'abord | Ne pas construire une interface contre un backend mouvant : elle a tourné sur des données factices jusqu'à ce que le backend soit éprouvé | Un temps sans vraies données à l'écran |
| **Un seul fournisseur LLM** | Garder deux fournisseurs « au cas où » | Code de branchement, dépendance et variables supprimés plutôt que laissés en jachère | Dépendance à Groq |
| **Pas de vidéo pour l'intro** | Export vidéo depuis Blender | Une vidéo qui bascule vers un canvas crée un raccord visible et n'est pas réactive | Intro codée à la main |
| **Rendu du ruban en three.js, pas depuis Blender** | Embarquer une scène Blender | Une scène Blender ne s'embarque pas comme fond d'une app Tauri ; l'équation paramétrique est plus légère et variable en temps réel | Blender ne sert qu'au prototypage |
| **Fenêtre verrouillée en 1440 ou 1920 de large** | Mise en page responsive complète | Une app de bureau n'a pas besoin d'un mode mobile ; la grille est mise à l'échelle | Pas d'usage sur petit écran |
| **Temps d'écran mesuré en Rust, gardé sur la machine** | L'envoyer à Notion ou au backend | Ce qu'on fait sur son ordinateur est une donnée sensible : elle n'a pas à quitter la machine, et un fichier local évite tout réseau | Visible seulement dans l'app, Windows uniquement |
| **Fermer la fenêtre la masque** | Quitter l'application | Le suivi et le démarrage automatique supposent une app qui reste vivante ; « Quitter » est explicite dans la zone de notification | L'app reste en mémoire |
| **Le PC va chercher ses protocoles** | Ouvrir un port sur la machine, ou pousser depuis le backend | Aucun port ouvert : l'app interroge le backend toutes les 30 s avec sa clé, et un protocole n'est remis qu'une fois | Environ 2 900 lectures Redis par jour, à surveiller sur le palier gratuit |
| **Pas de relance automatique des jobs** | Laisser QStash retenter | Chaque relance refaisait toute la conversation, écritures Notion comprises : des doublons | Un message perdu n'est plus rejoué, l'utilisateur est prévenu et le renvoie |
| **Alléger les appels plutôt que payer** | Palier payant de Groq | Décision de l'utilisateur : pas de paiement au jeton | Du code de choix des outils à maintenir |
| **Pas de clonage de voix sans accord** | Cloner un extrait de film, de série ou de jeu | Règle posée le 18/10 : la voix d'une personne identifiable demande son accord | La voix finale attend |
| **Pas d'entraînement sur des sorties ElevenLabs** | Fabriquer un jeu de données avec une voix ElevenLabs pour entraîner Piper | La Prohibited Use Policy (section 12) interdit d'utiliser leurs sorties pour entraîner ou affiner un modèle ; vérifié le 02/11 | Pas de voix « sur mesure » obtenue par description : la voix vient d'enregistrements dont on a les droits |
| **Piper affiné sur des enregistrements** | Clonage sans entraînement (XTTS-v2) à partir de 99 s | Jugé « très médiocre » à l'écoute ; le mieux mesuré (0,79 de similarité d'empreinte de voix avec l'échantillon) ne comble pas l'écart entre un modèle 24 kHz mono et un échantillon 44,1 kHz stéréo | Il faut enregistrer environ une heure, avec accord écrit |
| **Des tests sans aucun vrai service** | Tester contre les vrais Notion, Redis, Groq | Rapides (environ 3 secondes pour 350 tests), reproductibles, sans risque pour les vraies données ; tout appel réseau non prévu fait échouer le test | Un seul test (`test:live`), lancé à la main, valide les vraies APIs |

### Ce qui a été retiré, et pourquoi

Savoir retirer est autant une compétence que savoir ajouter. Chaque retrait est daté et motivé dans `STATUS.md`.

- **Le « Proof of Work »** (preuve tangible d'une journée : lien, capture, export 3D, commit) : jugé trop lourd à l'usage, remplacé par un contrôle de cohérence conversationnel, puis supprimé.
- **Le streak (compteur de jours consécutifs)** : retiré *en entier*, pas seulement son affichage. La machinerie qui le justifiait (contrôle d'horaire, vérification de cohérence) est partie avec, `record_progress` redevenant un simple enregistrement, et la colonne a été supprimée de la base Notion de production plutôt que laissée morte.
- **Le mode ACTIF/PAUSE et les deux personnalités (07/10/2026)** : un mode qui basculait le ton du modèle selon les horaires de travail. Retiré en entier : le module de détection, le type, le champ dans Notion et dans l'API, l'outil qui le pilotait, les composants du dashboard. L'utilisateur tenait sa cadence de travail : le mécanisme n'avait plus d'utilité pour lui, et un mécanisme inutilisé reste du code à maintenir et à tester.
- **Les réglages de shift (08/10/2026)** : le code, la réponse de l'API, le type du dashboard et les colonnes Notion correspondantes. Les colonnes ont été supprimées par un script de migration qui **simule d'abord** (aucune écriture), affiche ce qu'il ferait, puis s'applique avec `--apply` et relit les schémas ; il est idempotent. Supprimer une colonne efface ses valeurs sans retour possible, et le code avait été nettoyé *avant* qu'il soit écrit, pour que l'ordre avec le déploiement n'ait pas d'importance.
- **L'ancien dashboard plat et son code mort (07/10/2026)** : 20 fichiers, repérés par une cartographie des imports à partir du point d'entrée plutôt que « à l'œil ». Et 5 dépendances inutilisées le 08/10, le build du front restant identique à l'octet près.
- **La dégradation visuelle de l'interface après un jalon manqué** : envisagée, puis abandonnée le 08/10, hors V1 comme hors V2. Une décision explicite vaut mieux qu'une idée qui traîne dans la liste des « à faire ».
- **Les essais de voix (18/10/2026)**, rien n'est resté dans le dépôt : Piper en local (5 voix françaises, 6 anglaises, 0,3 à 1 s par phrase, écarté par l'utilisateur sans verdict d'écoute consigné), voix payantes (comparaison documentaire seulement, gardées pour plus tard), féminisation de sa propre voix avec Praat (écartée : une voix déjà féminine se dégrade), clonage sans entraînement avec XTTS-v2 (fonctionne, mais plus lent que la voix de Windows, licence non commerciale, aucun verdict d'écoute consigné). 13 Go libérés sur le disque. La voix de Windows, retirée le jour même, est revenue le 19/10 « en attendant ».
- **Le second fournisseur LLM (Gemini)**, la refonte visuelle « éditoriale » du dashboard (repartie de zéro depuis Figma), le parallax du fond, une première version du fond en poussière à quatre couches, la mise en page mobile.

---

## Bugs et causes racines

Chaque entrée suit : symptôme → cause → correction → leçon.

**1. QStash livrait vers une URL protégée.**
Les jobs échouaient en 401 silencieux et étaient retentés sans fin. Cause : ils visaient `VERCEL_URL`, l'URL propre à chaque déploiement, protégée par défaut par Vercel Deployment Protection. Correction : une URL fixe (`APP_URL`) pointant sur l'alias de production. *Leçon : la protection par défaut d'une plateforme est facile à oublier tant qu'on ne teste pas un vrai appel externe.*

**2. Le décalage horaire invisible.**
La fenêtre « pause » (celle de l'ancien mode ACTIF/PAUSE, retiré depuis) se déclenchait avec 1 à 2 heures d'écart selon la saison. Cause : Vercel exécute en UTC ; `getHours()` et `toISOString()` donnaient l'heure UTC, pas celle de Paris. Correction : une conversion centralisée via `Intl` dans `lib/date.ts`, utilisée partout. *Leçon : ne jamais laisser chaque appelant refaire son propre calcul d'heure.*

**3. Un `null` explicite qui fait échouer toute une action.**
Voir [Le cœur IA](#le-cœur-ia--tool-calling-et-prompts). *Leçon : une validation trop stricte sur la sortie d'un LLM fait échouer l'action de façon invisible au lieu de la rejeter proprement.*

**4. Des secrets corrompus par un espace.**
La plupart des valeurs `.env` étaient écrites `CLE= valeur`. Sans effet en local, mais le secret poussé tel quel vers Vercel était invalide. Correction : retirer l'espace et repousser. *Leçon : la copie de secrets entre environnements mérite une vérification explicite.*

**5. Un flux RSS qui dupliquait son titre.**
Le parsing positionnel des balises `<title>` lisait deux fois le titre du flux (répété dans un bloc `<image>`). Correction : isoler chaque titre à l'intérieur de sa balise `<item>`.

**6. Un déploiement qui uploadait 1,8 Go.**
Le premier déploiement tentait d'envoyer `node_modules` et la cible de compilation Rust. Correction : un `.vercelignore`.

**7. Le briefing qui tournait en boucle sur un ancien bilan.**
*Symptôme* : sans bilan la veille, le briefing du matin répétait le dernier bilan enregistré comme s'il datait d'hier. *Cause racine* : la requête renvoyait « le dernier bilan », quelle que soit sa date, et le texte envoyé au modèle disait « Hier : … ». Corriger le *prompt* n'aurait pas suffi : le modèle n'avait aucun moyen de savoir que cette information était périmée. *Correction* : la requête renvoie aussi la **date** du bilan ; le code décide si c'est « hier » ; sinon le modèle reçoit explicitement « Bilan d'hier : AUCUN, le dernier date du … » et doit le signaler. Le même correctif limite les rappels d'agenda aux 7 prochains jours avec une échéance écrite en toutes lettres (« demain à 14 h », « dans 4 jours, dimanche 11/10 »), car un rendez-vous à trois semaines était présenté comme s'il avait lieu aujourd'hui. *Leçon : ne demandez pas à un modèle de déduire une absence ou une date relative ; calculez-la et donnez-lui le fait.*

**8. Un correctif écrit n'est pas un correctif livré.**
Le lendemain du correctif ci-dessus, le briefing avait encore l'ancien comportement. Cause : les commits étaient sur une branche de travail, et la production se déploie depuis `main` ; la liste des déploiements montrait un dernier déploiement de production vieux de 7 jours. Indice décisif dans le texte lui-même : il citait un évènement à 23 jours, que le nouveau code aurait filtré. Résolu le 07/10 : la fusion de la pull request sur `main` a déclenché un déploiement de production, observé « Ready » dans la liste des déploiements. *Leçon : « terminé » veut dire déployé et observé en production, pas seulement mergé en local ; et un symptôme vous dit quelle version de votre code tourne.*

**9. Un écran blanc quand le backend est plus ancien que l'app.**
Le front lit `eveningBriefing` dans la réponse de `/api/dashboard`. Avec un backend déployé avant l'ajout de ce champ, le composant lisait `undefined.split` et tout l'écran devenait blanc après l'heure du bilan. Correction : un texte de repli quand le briefing manque. *Leçon : le front et le backend se déploient séparément ; un champ absent d'une réponse ne doit jamais faire planter l'affichage.*

**10. Des liens qui ne faisaient rien dans l'application.**
Sans dossier de capacités, Tauri 2 refuse toute commande de plugin (`opener.open_url not allowed`) : les liens d'articles ne faisaient rien. Correction : une capacité donnant à la fenêtre principale la seule permission d'ouvrir des URL `https://`. *Leçon : un refus par défaut est un choix de sécurité, pas un bug ; on accorde le minimum.*

**11. Une trace blanche à l'ouverture d'une carte.**
Une carte naissait à quelques pixels de haut et recevait un reflet de bord généré à cette taille, étiré ensuite sur toute sa hauteur : des bords blancs épaissis. Correction : aucune carte n'est générée pendant un redimensionnement, le reflet d'une carte étirée de plus de 12 % est masqué, et la réfraction n'est appliquée qu'une fois la carte de déplacement prête. Vérifié image par image (à 120 ms, 450 ms, 800 ms, 1,6 s). *Leçon : un effet calculé à une taille n'est pas valable à une autre ; une animation se vérifie sur ses images intermédiaires, pas sur son état final.*

**12. Un build qui échoue sur des versions décalées.**
`cargo add` avait monté la crate Tauri à 2.12.1 alors que les paquets npm restaient en 2.11. Correction : aligner les deux paquets npm sur 2.12.1. *Leçon : les dépendances jumelles côté Rust et côté JavaScript doivent suivre la même version.*

**13. Des entités HTML visibles dans les titres d'articles.**
Certains flux RSS laissent `&#8216;` dans leurs titres, que React affiche tel quel. Correction : une fonction `decodeEntities` appliquée juste après l'extraction, qui laisse intacte une entité inconnue. *Leçon : une donnée externe se nettoie à l'entrée, pas à l'affichage.*

**14. Une animation saccadée dans l'application installée.**
Le ruban avait été plafonné à 30 images/s au repos pour économiser le CPU (mesuré le 08/10 : environ 8 à 10 % d'un cœur, contre environ 140 % sans plafond), et ce réglage avait été validé sur la consommation, pas sur le ressenti. Dans l'app installée, l'animation était saccadée. Correction appliquée le 09/10 : 60 images/s au repos. **Cause établie le 12/10 (étape 3)** : le `backdrop-filter` à réfraction des cartes de verre, recalculé à chaque image du canvas. Mesuré dans l'app installée (écran 240 Hz) : ~120 à 138 % d'un cœur et ~20 images de particules/s ; réfraction sur les 4 petites cartes seulement 59 % et 60 images/s ; sans réfraction ~30 % et 60 images/s ; sans le canvas WebGL 18 %. L'utilisateur a choisi de couper la réfraction (`REFRACTIVE = false`, réversible) ; résultat sur le build de production neuf : ~30 % et 60 images/s. Le verre perd les franges de couleur sur les bords. *Leçon : un réglage de performance validé par une mesure de ressources peut dégrader l'expérience ; un seuil de fluidité se juge à l'œil dans l'application réelle ; et une cause « suspectée » se tranche en mesurant chaque variante, pas en la supposant.*
**Effet de bord, à la clôture** : deux tests d'acceptation figeaient la valeur de 30 images/s et échouaient depuis le passage à 60 (125 images en 2 s mesurées, moins de 75 attendues). Le code était juste, les attentes périmées ; corrigé le 12/10 (étape 0) : les tests lisent `REST_FPS`. Limite : à 60 images/s le plafond ne se distingue plus de l'absence de plafond sur l'horloge simulée, ces tests ne gardent que le plafond haut. *Leçon : un test qui recopie la valeur d'un réglage au lieu de la lire casse à chaque changement du réglage.*

**15. Un prompt qui impose un mot par défaut le répète partout.**
Le prompt de personnalité donnait « Boss » comme appellation par défaut, et ses exemples commençaient par ce mot. Correction : trois surnoms alternés, jamais le même deux messages de suite, et pas de surnom dans la plupart des messages (un seul, pour saluer, marquer une remarque ou adoucir un rappel) ; la question de repli du briefing du soir n'a plus de surnom en dur. **Suite, 14/10** : la règle « jamais le même deux fois de suite » ne tenait pas, car le modèle n'a aucune mémoire d'un appel à l'autre et retombait sur « patron ». Le code tire désormais au hasard Boss, patron ou chef pour les briefings du matin et du soir et le donne au modèle ; le prompt interdit tout surnom ailleurs. Non vérifié : le texte réel du modèle (seul le contenu du prompt est testé). *Leçon : une valeur « par défaut » écrite dans un prompt tend à devenir un tic ; mieux vaut décrire quand l'employer. Et une règle qui suppose une mémoire que le modèle n'a pas se déplace dans le code.*

**16. Une limite de débit qui devient des doublons (18/10).**
*Symptôme* : deux messages du soir restent sans réponse sur Telegram, chacun traité plusieurs fois, et des entrées d'agenda apparaissent en double dans Notion. *Cause* : trois facteurs en chaîne. (1) L'appel à Groq dépasse la limite de 8 000 jetons par minute (16 refus 429 dans l'export des journaux de la console, tous de ce type, aucun journalier) ; la bibliothèque attend puis réessaie, souvent plus de 25 s au total. (2) Vercel coupe le worker à 25 s sans réponse (504). (3) QStash relance tout ce qui n'est pas un 2xx, et chaque relance refait toute la conversation, écritures Notion comprises, avec des titres un peu différents ; les relances tombent dans la même minute et aggravent le blocage. Rien n'était dit à l'utilisateur. *Correction* : plus de relance (`retries: 0`), le worker répond 200 en cas d'échec après avoir vérifié la signature et prévient sur Telegram, `askSoza` échoue à 20 s au lieu d'être coupé à 25. *Dégâts* : l'utilisateur nettoie Notion à la main ; le nombre exact d'entrées écrites n'a pas été vérifié. Correctif fusionné (PR #27), déploiement non vérifié. *Leçon : une relance automatique n'est sûre que si l'opération est idempotente, sinon elle transforme une panne en corruption de données ; et on lit les journaux du fournisseur avant de conclure à un modèle lent, c'était un quota.*

**17. Un poids fixe de 3 700 jetons par appel (19/10).**
*Symptôme* : même sans plantage, une action avec un outil consomme presque tout le budget d'une minute. *Mesure* sur le vrai compte, avec des outils factices pour ne rien écrire : ~3 700 jetons par appel dont ~2 030 pour les 13 outils et ~430 pour la recherche web. La documentation de Groq annonce un cache de prompt qui ne compterait pas dans la limite ; sur ce compte il ne se déclenche pas (aucun jeton en cache rapporté). *Correction* : voir « Faire tenir les appels sous la limite de Groq » dans [Le cœur IA](#le-cœur-ia--tool-calling-et-prompts). *Leçon : une fonctionnalité annoncée se vérifie sur son propre compte avant d'écrire du code qui en dépend.*

**18. Trois pièges trouvés au premier essai sur la vraie machine.**
(a) Un BOM UTF-8 en tête d'`apps.json` (PowerShell 5, certains éditeurs) vidait la liste blanche sans erreur : corrigé et testé (13/10). (b) Juste après la fermeture d'un lecteur de musique, Windows répond un instant « serveur RPC non disponible » au gestionnaire multimédia : la lecture réessaie jusqu'à ~5 s (15/10). (c) Si l'envoi des statuts d'un protocole échouait brièvement après le lancement des applications, l'utilisateur recevait dix minutes plus tard « le PC n'a pas rendu le statut » alors que tout était lancé : trois essais à 2 s d'écart sur coupure ou erreur 5xx, aucun sur un refus 4xx (17/10). *Leçon : ces défauts n'apparaissent pas avec des faux services, seulement en essayant pour de vrai.*

---

## Front : le dashboard et l'avatar

### Un seul système de particules, de l'intro au dashboard
Le ruban de Möbius est un mesh instancié de 4 500 sphères positionnées par l'équation paramétrique du ruban. L'intro n'est pas une vidéo : chaque particule a une position de départ (une trajectoire relevée sur la vue caméra Blender) et une position cible sur le ruban, interpolées par un paramètre de progression. Une fois arrivé, le dashboard *est* ce même système au repos : zéro raccord. Le calcul du ruban a été extrait dans un module partagé (`particles/ribbon.ts`) seulement quand un second usage (le hub statique) l'a justifié, pas avant.

### Un fond reconstruit à partir d'une photo
Le fond est un shader plein écran. Plutôt que de le régler à l'œil, le profil des rayons (360 valeurs, une par degré) a été **extrait automatiquement d'une photo de référence** (centre et courbe du cœur ajustés par moindres carrés). Mesuré sur le rendu seul : **0,978 de corrélation** avec la photo, à luminosité moyenne égale. Cette approche a remplacé des itérations purement visuelles, toutes abandonnées, qui avaient coûté 8 commits en une journée.

**Puis simplifié.** Le 07/10, avec le dashboard en verre devant, ce fond a lui-même été remplacé par un aplat bleu et des particules blanches en fil de fer (réglées avec un panneau de développement qui copie la config à figer dans le code). Le shader et le profil de rayons restent dans le code, désactivés par leurs valeurs, sans être supprimés. Le résultat final est plus sobre que l'étape qui avait coûté le plus de travail.

### Le « verre liquide »
Chaque carte du dashboard est un panneau de verre qui **réfracte** réellement le fond :
- une **carte de déplacement** est calculée pour chaque carte à partir de sa taille et de son rayon (distance au bord d'un rectangle arrondi, normale du bord, profil de lentille convexe), puis appliquée au fond via `backdrop-filter: url(#filtre-svg)` ;
- la **dispersion chromatique** sépare les trois canaux couleur avec des intensités légèrement différentes ;
- le reflet du biseau est généré à partir des normales du bord, pas dessiné ;
- tout est exprimé dans une unité qui suit la fenêtre (`--u`), pour que la maquette 1440×1024 reste fidèle à toute taille ;
- compromis assumé : cette technique n'existe que dans Chromium/WebView2 (donc dans Tauri sur Windows) ; ailleurs, repli sur flou et saturation.

### Une grille qui s'anime sans JavaScript de layout
La disposition « bento » est une CSS Grid en unités `fr`. Un clic sur « Prochain jalon » ajoute une carte (la frise des jalons) : la colonne passe de 3 à 4 lignes, les autres cartes se redimensionnent, et tout s'anime avec `grid-template-rows` seul, sans calcul de position ni marge animée. La carte supplémentaire existe en permanence, repliée à hauteur nulle, et s'ouvre.

### Le calendrier et les icônes
Vue mois ou semaine, navigation, détail du jour, couleurs par type d'évènement. Les logos des tâches sont devinés **par mots-clés dans le titre** (une ligne par icône), testés sur 28 titres types, dont des faux amis (« Révision vélo », « Séance de muscu »). Limite connue et documentée : Notion n'avait pas de champ « catégorie ». La version fiable existe maintenant côté données (une colonne « Catégorie » à 15 options, ajoutée par la migration, et renseignée pour les 52 idées d'après leur contenu), mais le code ne la lit pas encore : les logos viennent toujours des mots-clés.

### Le temps d'écran, du système d'exploitation à l'écran
Le bloc « Écran » mesure le vrai temps passé par application, sans rien envoyer en dehors de la machine :
- un **thread Rust** interroge toutes les 5 secondes l'application au premier plan (clé = nom de l'exécutable), ignore la machine inactive depuis 5 minutes et la fenêtre de Soza elle-même ;
- les secondes par jour et par application restent en mémoire et sont sauvegardées toutes les 30 secondes dans un petit fichier local ;
- une commande Tauri renvoie l'historique au front, qui classe les applications et affiche le jour ou les 7 derniers jours, avec le logo de chaque application ;
- un clic sur le bloc ouvre le détail dans la même carte que la frise des jalons, qui change de contenu sans se refermer quand on passe d'un bloc à l'autre.

Autour de ce suivi, l'application **démarre avec Windows** (fenêtre masquée dans ce cas), **se réduit dans la zone de notification** (clic gauche : l'afficher ; clic droit : menu « Afficher » / « Quitter » qui sauvegarde avant d'arrêter) et dispose d'un **installeur** Windows de 2,18 Mo, sans droits administrateur. En développement, rien n'est inscrit au démarrage : sinon Windows lancerait l'exécutable de debug sans serveur de développement.

### Comment c'était vérifié
Captures et mesures automatisées (Playwright, rendu logiciel), puis **dans la vraie fenêtre WebView2** : `tauri dev` et un build de production affichent le dashboard avec les vraies données, sans erreur de console, de politique de sécurité ni de réseau. 20 scénarios d'acceptation tournent dans un vrai navigateur sur l'application réelle avec un faux backend. Limites écrites dans l'état du projet : l'animation et les effets dynamiques n'ont été vus qu'en images fixes par les outils automatiques, et l'installeur n'a été ni lancé ni installé.

---

## Qualité, tests, sécurité

### Tests
397 tests en quatre familles plus du Rust (350 rapides et 26 en Rust rejoués le 01/11/2026 ; les 21 scénarios navigateur n'ont pas été rejoués depuis le 15/10), ajoutés surtout le 08/10, en fin de V1, puis à chaque étape de la V2 :

| Famille | Ce qu'elle couvre | Rapidité |
| --- | --- | --- |
| **Unitaires** | dates, lignes du briefing (bilan, agenda, journée, jalon), flux RSS, validation et accès, logos par mots-clés, classement du temps d'écran, calendrier, mémoire Redis | instantané |
| **Intégration** | webhook Telegram (secret, `chat_id`, publication dans la file), worker (signature, réponse), crons du matin et du soir, `/api/dashboard` : le vrai code tourne de bout en bout, seuls Notion, Redis, Telegram, Groq et le réseau sont simulés | instantané |
| **Régression** | un fichier par **famille de bugs déjà corrigés** : paramètres `null` de Groq, fuseau horaire, bilan périmé et rappels d'agenda, URL de livraison QStash, garde-fous fermés par défaut, requêtes Notion, champs retirés du payload, plafonds de requêtes des crons, budget d'appels Groq (repli de modèle, pas de repli après une écriture), repli de la recherche web | instantané |
| **Acceptation** | 21 scénarios utilisateur dans un vrai navigateur (Playwright) : dashboard complet, briefings, détail Écran, bascule Écran ↔ Jalons, liens, calendrier, backend en panne ou clé refusée, intro | ~2 min |
| **Rust** | 26 tests (plus 5 essais réels ignorés par défaut) : reconnaissance des commandes, liste blanche des applications, volume, musique, protocole, synthèse vocale ; l'un lance et ferme un vrai processus Windows | instantané |

Principes qui valent d'être retenus :
- **Aucun test n'utilise le `.env` ni un vrai service** : variables factices, et tout appel réseau non prévu fait échouer le test. Un seul script, lancé à la main, appelle les vraies APIs (`test:live`, la suite historique, 37 vérifications au 30/09, qui avait elle-même remplacé dix scripts ad hoc).
- **Un test de régression se vérifie en réintroduisant le bug** : l'un des tests d'acceptation a été validé en remettant l'ancien code, sur lequel il échoue bien. Un test qui ne peut pas échouer ne protège de rien.
- **Les bugs sont rangés par famille**, pas par date : chaque bug du chapitre précédent a son garde-fou.
- **Les batteries contre le vrai modèle ne sont pas des tests de non-régression.** `test:search` (28 cas) et `test:projects` coûtent 160 000 à 220 000 jetons, l'essentiel du quota du jour, et ne se relancent pas plusieurs fois par jour. Elles ont trouvé ce que les faux services ne voyaient pas (un champ `projects` omis une fois sur deux, renommé `projectsWorkedOn` : six fois sur six), et elles refusent toute écriture Notion ou Telegram.
- Les 350 tests rapides tournent en environ 3 secondes ; la vérification de types stricte (`tsc --noEmit`) accompagne chaque étape.

### Sécurité
- **Trois barrières successives sur le webhook Telegram** : la méthode doit être POST, un secret partagé doit figurer dans l'en-tête (`x-telegram-bot-api-secret-token`), puis le `chat_id` doit être celui de l'utilisateur autorisé. Un message d'un autre utilisateur reçoit une réponse « ignoré » sans aucune action ni erreur révélatrice. Le corps de la requête est aussi validé par un schéma Zod avant d'être utilisé.
- Les crons exigent une signature QStash valide, ou un secret en `Bearer` pour un déclenchement manuel.
- L'endpoint du protocole (`api/protocol.ts`, que le PC interroge) est protégé par la même clé que le dashboard, remet un protocole une seule fois et borne ce qu'il accepte en retour (au plus 20 résultats d'étapes, textes tronqués).
- **Les actions sur le PC sont bornées par une liste blanche locale** : aucune application hors de `apps.json` ne se lance ni ne se ferme, et le backend ne donne jamais de chemin. Essayés et refusés le 13/10 : `explorer`, `cmd.exe`, un chemin complet, `spotify && calc`, `ferme spotify; shutdown /s` donnent tous « Je ne connais pas », et aucun `cmd.exe` n'a Soza pour parent. Le titre d'un morceau est encodé et l'identifiant rendu par Spotify doit être alphanumérique : rien ne peut sortir de l'adresse `spotify:`.
- **Un échec du worker répond 200** (après la vérification de la signature) pour qu'aucune relance ne rejoue des écritures ; l'utilisateur est prévenu sur Telegram.
- L'endpoint du dashboard est protégé par une clé. **Compromis assumé** : cette clé est embarquée dans le build de l'application, ce qui est acceptable en usage mono-utilisateur mais ne le serait pas pour un produit public.
- **Application de bureau** : politique de sécurité de contenu (CSP) stricte en production, limitée à l'application, à l'API de production, au service météo et à la communication interne de Tauri ; un appel vers un autre site est bloqué (vérifié). L'ouverture de liens est une permission explicite, limitée à `https://`.

### Observabilité
Les appels d'outils sont journalisés avec leurs paramètres ; la suite d'intégration vérifie le comportement bout en bout. Depuis le 15/10, `generateBriefing` journalise la cause avant de prendre le texte de repli (l'erreur était avalée sans trace) ; le 18/10, l'export CSV des journaux de la console Groq a permis d'établir la vraie cause des échecs du worker (bug 16).

---

## Limites assumées

Les relecteurs expérimentés y regarderont en premier ; autant les dire.

- **Des zones non testées automatiquement** : le suivi réel de la fenêtre active (il dépend du système d'exploitation), le rendu visuel du verre et des particules (WebGL logiciel), le menu de la zone de notification et le démarrage automatique (visibles seulement dans l'app installée).
- **Le texte produit par le modèle n'est pas testé automatiquement** : seul le contexte qui lui est envoyé l'est. La qualité de rédaction se juge à l'usage.
- **Pas de limitation de débit** au-delà du filtre `chat_id` : risque faible en usage à un utilisateur, à traiter si le bot devient accessible à d'autres.
- **Plusieurs projets « En cours » sans plafond** (depuis le 15/10) : la limite d'un seul projet à la fois n'existait déjà plus dans le code ; le briefing du soir n'en cite que trois, et le bilan reste un texte unique (limite Notion de 2 000 caractères par bloc).
- **Dépendance à des services tiers gratuits** (Vercel, QStash, Upstash, Notion, Groq) avec leurs quotas.
- **Détection des icônes par mots-clés** : fragile par construction. Depuis le 12/10 la colonne « Catégorie » de Notion est lue et prioritaire, mais les entrées d'Agenda et de Jalons créées avant cette date n'en ont pas : elles restent devinées par mots-clés.
- **Des vérifications restent à faire dans l'app installée** : démarrage automatique, zone de notification et suivi du temps d'écran restent à valider dans l'app installée, et la fluidité n'est mesurée que sur une session courte (~30 % d'un cœur avec la réfraction coupée) : le CPU sur la durée et quand la fenêtre est masquée n'est pas observé. L'app installée est celle de l'installeur du 13/10, essayée par l'utilisateur pour l'étape 4.
- **Le suivi du temps d'écran ne mesure que Windows et que l'application Tauri** (dans un navigateur le bloc affiche « — »), et seulement tant que Soza tourne.
- **À la clôture, la suite de tests n'était pas entièrement verte** : 2 des 20 scénarios d'acceptation échouaient (cadence du rendu figée à l'ancienne valeur de 30 images/s, voir le bug 14). Corrigé le 12/10.
- **Recherche web : quota et fiabilité** : le palier gratuit de Groq limite à 200 000 jetons par jour et 8 000 par minute, partagés avec les briefings ; une batterie complète en consomme l'essentiel. La latence réelle n'est pas établie et la météo donnée par la recherche était probablement fausse dans un essai.
- **Protocoles : le chemin réel n'est pas vu** : la boucle entre le PC et le vrai backend, le lancement réel des applications du premier protocole et un vrai message Telegram n'ont pas été essayés ; seuls l'essai local (vrai worker et vraie boucle Rust, faux Redis, faux Telegram, 17 contrôles sur 17) et les tests le sont. L'exclusion `-`, l'ajout `+` et l'ouverture directe (18 → 20/10) sont dans le même cas, et demandent de déployer le backend et de réinstaller l'app, sinon la liste des applications n'est jamais envoyée. 2B et 6H9K sont reconnus mais sans étapes.
- **Limite de débit de Groq : allègement estimé, pas mesuré de bout en bout** : le gain du choix des outils par mots-clés vient d'une estimation (caractères ÷ 3,3), le repli de modèle n'a été testé qu'avec des faux services, et un message de simple conversation (« salut ») reste à plein tarif. `test:projects` et `test:search` n'ont pas été rejoués après le changement des descriptions d'outils.
- **Dates fausses pour « ce week-end »** : « je ne bosse pas ce week-end » a donné de mauvaises dates 3 fois sur 3, donc `set_break` suspendrait les briefings sur de mauvais jours. Non corrigé ; piste : donner au modèle les dates du prochain samedi et du prochain dimanche.
- **Voix : personne n'a écouté** : le test réel de la voix de Windows prouve l'absence d'erreur, pas que le son sorte ; deux réponses rapprochées se superposent ; les noms d'applications sont dits tels quels. La voix finale (clonage d'une proche, avec son accord) n'est pas commencée.
- **Commandes locales** : « mets Son of a gun » est pris pour une commande de volume ; la batterie de la souris ne marche que pour une souris dont le fabricant expose la fonction « batterie unifiée » (lue 34 %, non comparée au logiciel du fabricant).
- **Non vérifiés à la clôture** : le premier texte réel des briefings avec le nouveau code, les écritures Notion avec le client 4 (`test:live` jamais relancé depuis), et une passe sécurité.

---

## Méthode de travail

**La documentation comme source de vérité, tenue à jour pendant le travail.** `STATUS.md` consigne ce qui est fait, ce qui reste, et surtout **pourquoi** chaque décision a été prise, avec la date. Chaque entrée distingue ce qui a été **vérifié** de ce qui **ne l'est pas**. C'est ce qui permet de reprendre le projet à froid, y compris pour un assistant IA.

**Un garde-fou contre la dispersion.** Le projet s'est donné une règle écrite : ne pas commencer une idée de la V2 avant d'avoir fini la V1. Elle est inscrite en tête de `SozaV2.md` et rappelée à chaque nouvelle ambition. Les idées sont notées, discutées, cadrées, mais pas implémentées tant que le socle n'est pas fini. La V1 a été déclarée terminée le 09/10/2026 ; la V2 a démarré le 12/10 par les étapes les plus simples, une PR par étape.

**Des décisions prises en discussion, puis écrites.** Les choix structurants (retrait du streak, retrait du mode ACTIF/PAUSE au profit d'une personnalité unique, moteur de détection du mot d'activation) sont discutés avec leurs alternatives, tranchés, puis consignés avec leur raison.

**Développement assisté par IA.** Le projet a été mené avec un assistant de code IA (Claude Code), guidé par des fichiers de contexte versionnés dans le dépôt (`CLAUDE.md`, `docs/ai/`). Les règles de sécurité (validation du `chat_id`, aucune tâche longue dans le webhook) y sont écrites noir sur blanc. Le dépôt montre aussi les limites de ce mode de travail : un correctif « fini » mais jamais déployé (voir bug 8), un modèle auquel on avait oublié de donner la date du jour (voir plus haut).

**Les pièges de l'outillage.** Un `\n` dans une chaîne TypeScript écrite par un script collé dans le shell devenait un vrai saut de ligne (arrivé deux fois, dans deux fichiers) : désormais, `tsc --noEmit` après tout script de ce genre. Autre piège de dev noté : `tauri dev` relance le serveur de développement sur un port fixe, et un serveur déjà ouvert fait échouer le démarrage.

**Mesurer sur le vrai compte, écrire ce qu'on n'a pas pu mesurer.** L'enquête du 18/10 est partie des journaux de Groq et de QStash, pas d'une hypothèse ; les chiffres de poids des appels ont été pris sur le compte réel avec des outils factices (rien d'écrit), et le cache de prompt annoncé s'est révélé inactif. Ce qui reste estimé ou simulé (gain des mots-clés, repli de modèle) est dit comme tel dans les limites.

**Ce que l'historique montre.** 8 commits en un jour pour trouver un fond « à l'œil », contre un résultat mesuré (0,978 de corrélation) quand une référence a été fournie. Itérer contre une référence converge ; itérer contre une impression, beaucoup moins.

---

## Bilan de la V1

La V1 a été déclarée terminée par l'utilisateur le 09/10/2026, après trois semaines et 73 commits.

**Ce qui est livré**
- Un backend en production : webhook, worker, crons, briefings du matin et du soir rédigés par Soza, 13 outils IA, une seule personnalité, pause de plusieurs jours.
- Une application de bureau Windows : intro en particules, dashboard en verre alimenté par les vraies données, temps d'écran réel, démarrage automatique, zone de notification, installeur.
- 305 tests, trois passes d'optimisation mesurées (la troisième, le 12/10, a trouvé la vraie cause du lag), une documentation tenue à jour.

**Ce qui n'est pas vert à la clôture, et qui est écrit plutôt que caché**
- 2 des 20 scénarios d'acceptation échouaient : ils figeaient la cadence de 30 images/s alors que le rendu tourne à 60. **Corrigé le 12/10** (étape 0).
- Non vérifié : le démarrage automatique réel, le menu de la zone de notification et la reprise du rendu dans l'app installée, les écritures Notion avec le client 4, une passe sécurité, quelques jours d'usage, et le texte réel des premiers briefings avec le nouveau code.
- Optionnel à la clôture, **fait le 12/10** (étape 1) : la catégorie Notion est lue par le code, et le statut « Terminé » existe pour les idées. Les écritures réelles de ces deux champs ont été vérifiées sur le vrai Notion le 13/10 (`Catégorie` écrite puis relue dans les trois bases ; `test:live` 48/48 après l'ajout du statut `Terminé` dans la base Idées).

**Ce que la journée de clôture enseigne**
- Un réglage validé sur une mesure (le CPU) peut être mauvais à l'usage (la fluidité) ; et un test qui recopie la valeur du réglage plutôt que de la lire échoue dès qu'on le change.
- Une valeur « par défaut » écrite dans un prompt tend à se retrouver partout dans les réponses.
- Déclarer « terminé » n'efface pas la liste de ce qu'on n'a pas vérifié : la clôture l'inscrit au lieu de l'omettre.

**La suite** : la V2, décrite dans [`SozaV2.md`](../ai/SozaV2.md) (avancement dans [`STATUS-V2.md`](../ai/STATUS-V2.md)). Ses étapes 0 à 7 sont faites et la 8 (protocoles) est livrée côté code avec un premier protocole, essai réel à faire ; la 9 (voix) est commencée, avec la voix de Windows en attendant la voix finale ; les étapes 10 à 12 (agent résident et widget, « qu'est-ce que je regarde ? », gestes de la main) ne sont pas commencées.

---

## Vision V2 (résumé)

La V2 rapproche Soza d'un assistant du type Jarvis/FRIDAY : une seule personnalité, des fonctionnalités qui servent l'utilisateur plutôt qu'un rôle de coach. Le premier pas, la personnalité unique et le retrait du mode ACTIF/PAUSE, a été fait dès le 07/10, en fin de V1. Le détail est dans [`SozaV2.md`](../ai/SozaV2.md). Les décisions d'architecture déjà prises, avant la moindre ligne de code :

- **Hybride local/cloud, pas une IA locale complète.** Détection du mot d'activation et exécution d'actions sur la machine en local (accès OS obligatoire) ; raisonnement dans le cloud ; commandes simples reconnues en local pour la rapidité et le fonctionnement hors ligne.
- **Principe « local plutôt que cloud »** : Notion reste la source de vérité pour ce qui doit être accessible à distance, le reste (réglages, défauts) vit sur la machine.
- **Les fondations de l'agent local existent déjà**, posées en V1 par le suivi du temps d'écran : un thread Rust résident, une icône de zone de notification, le démarrage avec Windows et un installeur. La V2 s'y greffe.
- **Deux canaux d'entrée distincts** : la voix en local, Telegram à distance. Un protocole qui démarre un PC éteint ne peut pas passer par la voix locale, puisque le micro est éteint avec la machine.
- **Détection stricte des commandes à effet réel**, sur le modèle de l'ancienne commande `/mode` (supprimée avec le mode ACTIF/PAUSE, réintroduite le 17/10 à l'étape 8 pour un premier protocole), pour qu'une phrase qui *parle* d'un protocole ne le déclenche jamais.
- **Gestes de la main par caméra**, avec un détecteur de mains dont le rendu de contrôle est le prérequis de tout geste, un geste d'engagement contre les déclenchements accidentels, et un traitement 100 % local.
- **Sécurité traitée avant la fonctionnalité** : exécuter des actions sur une machine réelle depuis une commande à distance est sensible, le modèle de menace est posé en premier.

**Ce qui est déjà construit de la V2 (20/10/2026)** : la barre `Ctrl+K` (applications, volume, musique, batterie, et la réponse dite à voix haute avec la voix de Windows), la recherche web, le multi-projets, le moteur de protocoles (un protocole, exclusion et ajout d'applications, ouverture directe depuis Telegram) et un allègement des appels au modèle sous la limite de Groq. Ce qui a été décidé en route : le PC va chercher ses protocoles (aucun port ouvert), la liste blanche des applications reste sur la machine, la fermeture est toujours douce, et l'allumage du PC par Soza est écarté (l'utilisateur le démarre avec l'application de sa prise connectée). L'essai réel de bout en bout n'est pas fait, et c'est écrit comme tel dans `STATUS-V2.md`.

**Extras de confort documentés (01 et 02/11/2026), à faire après l'étape 12** : des articles plus développés dans le briefing du matin, et Soza qui prend la parole d'elle-même selon les événements de l'ordinateur (batterie, réseau, applications, temps passé), avec des phrases fixes plutôt qu'un appel au modèle par événement.

---

## Ce qu'un développeur junior peut en tirer

Des patterns concrets, chacun lisible dans un fichier précis :

| Pattern | Où le lire |
| --- | --- |
| Webhook qui répond vite et délègue à une file | `api/telegram-webhook.ts`, `api/qstash-worker.ts` |
| Outils IA avec validation de schéma | `lib/ai/tools.ts` |
| Un seul endroit pour la logique de dates et de fuseaux | `lib/date.ts` |
| Logique pure testable séparée de l'accès aux données | `bilanLine` et `agendaLine` dans `lib/briefing.ts` |
| Cache éphémère avec durée de vie (TTL) | `lib/memory.ts` |
| Agrégation d'un endpoint pour un front | `api/dashboard.ts` |
| Mesh instancié et position calculée par une équation | `src/features/particles/ribbon.ts` |
| Filtre SVG appliqué à l'arrière-plan d'un élément | `src/features/glass/glass.ts` |
| Faux services et réseau bloqué pour des tests reproductibles | `tests/helpers/` |
| Un test de régression par famille de bugs | `tests/regression/` |
| Mesure en tâche de fond côté Rust, exposée par une commande | `src-tauri/src/main.rs` |
| Repli sur un autre modèle quand une limite de débit est atteinte, sauf après une écriture | `lib/ai/client.ts` |
| Choisir les outils à envoyer au modèle selon le message | `lib/ai/tool-routing.ts` |
| Une machine locale qui vient chercher ses ordres, sans port ouvert | `src-tauri/src/protocol.rs`, `api/protocol.ts` |

Pour le lancer : voir le [`README.md`](../../README.md) (variables d'environnement, commandes `npm run dev`, `npm run tauri dev`, `npm test`, scripts de configuration Notion et QStash).

**Trois habitudes à reprendre de ce projet** : écrire pourquoi on retire quelque chose en même temps qu'on le retire ; séparer « calculé » de « rédigé » quand on utilise un LLM ; ne jamais déclarer terminé ce qui n'a pas été observé là où il tourne vraiment.
