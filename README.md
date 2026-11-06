# Løra

Assistant personnel piloté par Telegram, pour un unique utilisateur, doublé d'une application de bureau Windows. Løra aide à garder une discipline de travail sur son projet en cours, avec une seule personnalité (« Friday »).

> Løra s'appelait Soza jusqu'au 05/11/2026. Quelques identifiants techniques gardent l'ancien nom (dossier de données `com.soza.assistant`, URL Vercel, planifications QStash, dépôt) : voir « Renommage » dans `docs/ai/STATUS-V2.md`.

Notion est la source de vérité pour toutes les données (idées, agenda, jalons, progression, réglages). Løra ne fait qu'y lire et écrire.

## Comment ça marche

1. **Telegram** reçoit un message → `api/telegram-webhook.ts` valide le `chat_id` autorisé et publie immédiatement le job dans **QStash** (aucune tâche longue n'est exécutée dans le webhook lui-même).
2. **QStash** livre le job à `api/qstash-worker.ts`, qui appelle le modèle (Groq, via le Vercel AI SDK) avec un jeu de tools (`lib/ai/tools.ts`) capables de lire/écrire dans Notion : créer une idée, ajouter un rendez-vous ou un shift à l'agenda, changer le statut d'un projet, enregistrer le bilan du jour, mettre Løra en pause quelques jours, changer l'heure du briefing, etc.
3. Deux **crons QStash** déclenchent le briefing du matin (`api/cron-morning.ts`) et le bilan du soir (`api/cron-evening.ts`) aux horaires configurés dans la base Notion **Løra Réglages**. Chaque texte est rédigé par le modèle avec la personnalité de Løra (le soir : la journée, le prochain jalon, l'agenda, puis la question du bilan) ; une version courte est gardée dans Redis pour le dashboard.
4. Une **mémoire courte durée** (Redis, ~10 messages / 6h) permet de garder le contexte d'une conversation Telegram sans tout réinjecter depuis Notion à chaque message.
5. Un **dashboard Tauri** (app de bureau) joue une intro en particules (un ruban de Möbius se forme), puis affiche ces mêmes données en lecture dans un tableau de bord en verre liquide (`api/dashboard.ts` agrège Notion). Il n'écrit pas dans Notion : tout se pilote par la conversation Telegram. Côté Rust, l'app mesure le temps passé par application (les données restent sur la machine), démarre avec Windows et se réduit dans la zone de notification ; `npm run tauri build` produit un installeur Windows (NSIS).
6. Une **pause de plusieurs jours** (« je prends mon week-end ») suspend le briefing et le bilan, et le briefing de reprise n'en fait pas un reproche.
7. **Plusieurs projets en parallèle** : le bilan du soir enregistre sur lesquels l'utilisateur a avancé, le briefing du soir donne le prochain jalon de chaque projet en cours.
8. **Recherche web** (Telegram) : pour une question extérieure ou récente, le modèle utilise la recherche intégrée de Groq et répond en deux ou trois phrases ; si la recherche échoue, il réessaie sans elle.
9. **Protocoles** : le message exact « Protocole 7E3A » est reconnu par le worker (jamais par le modèle) ; le PC récupère le protocole via `api/protocol.ts`, exécute ses étapes (ouvrir des applications) et le résultat revient sur Telegram.
10. **Barre de commande `Ctrl+K`** (app de bureau seulement) : ouvrir ou fermer une application d'une liste blanche, régler le volume, piloter la musique (Spotify : « mets <titre> »), lire la batterie de la souris (ces commandes locales marchent sans réseau) ; toute autre phrase (briefing, agenda, idées, météo, recherche, calcul, avis) part au backend `api/ask`, même cerveau que Telegram. Chaque réponse est dite à voix haute avec la voix de Løra (Piper, en local ; repli sur la voix de Windows). Un hook « Claude Code a terminé » (`say.txt`, dossier de données) la fait aussi parler d'elle-même ; un second hook (`claude-last.json`) lui permet de lire la dernière réponse de Claude Code (« lis la réponse de Claude », en local) puis d'écrire dans la session VS Code la phrase dictée après « écris », de la relire (« relis le message ») et de l'envoyer seulement si tu réponds « oui » (voir `docs/ai/STATUS-V2.md`, étape 13).
11. **Mot d'activation « Løra »** (app de bureau, micro) : Whisper (whisper.cpp) tourne en local sur la carte graphique ; une phrase qui commence par « Løra » est traitée comme une phrase tapée dans `Ctrl+K` et la réponse est dite. Avant toute écriture dans Notion, Løra demande confirmation. « Løra, stop » coupe sa parole (compris aussi pendant qu'elle parle), « Løra, repose-toi » arrête l'écoute (réveil par la case du menu de la zone de notification), « Løra, fin de mission » ferme l'application. L'écoute se coupe depuis le menu de la zone de notification ; elle demande Whisper installé à la main (voir `docs/ai/STATUS-V2.md`). Le ruban se réduit pendant qu'elle écoute et se déforme en étoile quand elle parle. Essayé avec la vraie voix de l'utilisateur le 05/11/2026.

## Stack

- **Backend** : fonctions Vercel (Edge Runtime) en TypeScript, `@upstash/qstash`, `@upstash/redis`, `@notionhq/client`.
- **IA** : Groq via `ai` (Vercel AI SDK) + `zod` pour la validation des paramètres de tool calls.
- **Frontend / dashboard** : React + Vite, three.js pour le ruban en particules, packagé en application de bureau avec Tauri (`src-tauri/`, Rust : suivi du temps d'écran, zone de notification, démarrage automatique, commandes locales : applications, volume, musique, batterie de la souris, agent de protocoles, voix de sortie avec Piper, écoute du micro avec Whisper local).
- **Tests** : Vitest (unitaires, intégration, régression, acceptation dans un vrai navigateur via Playwright) et `cargo test` pour le Rust.

## Structure du repo

```
api/                  Endpoints Vercel : webhook Telegram, worker QStash, crons matin/soir, dashboard, protocole (agent du PC), ask (phrases de l'app, réponse dite)
lib/
  ai/                 Client IA, prompt de personnalité unique (friday.ts), définition des tools
  notion/             Accès aux bases Notion (agenda, idées, jalons, progression, réglages)
  integrations/       Telegram, QStash, météo, actualités
  briefing.ts         Construction du briefing du matin (bilan d'hier, agenda à 7 jours, pause)
  protocols.ts        Protocoles (7E3A…) : déclencheur strict et définition des étapes
  date.ts             Dates et fuseau Europe/Paris (Vercel tourne en UTC)
  memory.ts           Redis : mémoire courte durée, dernier briefing, pause en cours
src/                  Dashboard Tauri (React)
  features/           glass (bento en verre), widgets, calendar, intro et particles (ruban de Möbius), hub…
src-tauri/            Application de bureau (Rust) : fenêtre, temps d'écran, zone de notification, démarrage automatique ; commandes locales dans `apps.rs`, `system.rs` (volume, musique, batterie), `spotify.rs` et `protocol.rs` ; voix de sortie dans `speech.rs` (Piper), écoute du micro et mot d'activation dans `listen.rs` (Whisper)
tests/                unit, integration, regression, acceptance (+ helpers : faux Notion, faux Redis, réseau bloqué)
scripts/              Setup et migration Notion/QStash, test contre les vraies APIs (`full-mechanics-test.ts`), batteries contre le vrai modèle (`search-battery.ts`, `projects-battery.ts`), essai de bout en bout des protocoles (`protocol-e2e.ts`)
docs/
  ai/                 Contexte et état d'avancement à l'usage de l'assistant IA
  product/            Schéma Notion, notes d'UI
```

## Configuration

Variables d'environnement attendues (voir `.env`) :

| Groupe | Variables |
| --- | --- |
| App | `APP_URL`, `CRON_SECRET` |
| Groq | `GROQ_API_KEY`, `GROQ_MODEL` |
| Notion | `NOTION_TOKEN`, `NOTION_AGENDA_DATABASE_ID`, `NOTION_IDEAS_DATABASE_ID`, `NOTION_MILESTONES_DATABASE_ID`, `NOTION_PROGRESS_DATABASE_ID`, `NOTION_SETTINGS_DATABASE_ID` |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_CHAT_ID` |
| QStash | `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `QSTASH_DEV` |
| Redis | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| Dashboard | `DASHBOARD_API_KEY` (serveur), `VITE_DASHBOARD_API_KEY` et `VITE_API_URL` (embarquées dans le build de l'app) |
| Divers | `NEWS_RSS_URL_TECH`, `NEWS_RSS_URL_FASHION`, `WEATHER_LAT`, `WEATHER_LON` |

Setup Notion détaillé dans `docs/product/NOTION-SCHEMA.md`.

**Fichiers locaux de l'application de bureau**, dans `%APPDATA%\com.soza.assistant\` (créés vides au premier lancement, relus à chaque commande, jamais versionnés) :

| Fichier | Contenu |
| --- | --- |
| `apps.json` | Liste blanche des applications que `Ctrl+K` et les protocoles peuvent ouvrir ou fermer : `{ "nom": "chemin\\vers\\app.exe" }`. Rien d'autre ne peut être lancé. |
| `spotify.json` | `client_id` et `client_secret` d'une application Spotify (gratuite) pour chercher un morceau par son nom ; sans eux, la recherche s'ouvre dans Spotify sans lire. |
| `agent.json` | `api_url` et `api_key` (mêmes valeurs que `VITE_API_URL` et `VITE_DASHBOARD_API_KEY`) pour que le PC récupère les protocoles. |
| `voice.json` | Voix de sortie : `volume` (0 à 1) et `english` (noms d'applications dits avec l'accent anglais). Le moteur (Piper compilé et modèle de voix) est dans `voice\piper\` et `voice\`, à installer à la main, hors du dépôt. |
| `listen.json` | Écoute du micro : `enabled`, `wake` (orthographes du mot d'activation), `threshold`, `command_secs`, `log` (**`true` écrit tout ce qui est entendu en clair** dans `listen.log` : seulement pour régler). Whisper (`voice\whisper\`) s'installe à la main. |

## Commandes

```bash
npm run dev                        # dashboard Tauri en dev (Vite)
npm run build                      # tsc --noEmit + build Vite
npm run tauri dev                  # application de bureau en développement (Tauri)
npm run tauri build                # installeur Windows : src-tauri/target/release/bundle/nsis/

npm test                           # tests rapides : unit + integration + regression (moins de 1 s)
npm run test:acceptance            # scénarios dans un vrai navigateur (~2 min)
npm run test:rust                  # tests Rust
npm run test:all                   # tout enchaîner
npm run test:live                  # test contre les vraies APIs (à lancer à la main)
npm run test:search                # batterie de la recherche web contre le vrai Groq (~220 000 jetons : une fois par jour au plus)
npm run test:projects              # batterie des briefings multi-projets contre le vrai Groq (~160 000 jetons : une fois par jour au plus)
npm run test:protocol              # essai de bout en bout des protocoles (faux Redis/Telegram/QStash, vrais processus ; voir STATUS-V2.md, étape 8)

npm run notion:check               # vérifie la connexion Notion
npm run notion:create              # crée les bases Notion (Agenda, Idées, Jalons, Progression)
npm run notion:create-settings     # crée la base Løra Réglages
npm run notion:migrate-agenda-type # migration du champ Type sur Agenda
npm run notion:categories-cleanup  # nettoyage des catégories Notion

npm run qstash:setup-schedules     # configure les schedules QStash (briefing/bilan)
```

Les tests (`npm test`, `test:acceptance`, `test:rust`) n'utilisent jamais le `.env` ni de vrais services : variables factices, et tout appel réseau non prévu fait échouer le test. Seuls `npm run test:live` (`scripts/full-mechanics-test.ts`) et les deux batteries `test:search` / `test:projects` (vrai Groq ; la seconde simule Notion et Redis) appellent de vraies APIs, à la main.

## État du projet

**La V1 est terminée (09/10/2026).** Voir [`docs/ai/STATUS.md`](docs/ai/STATUS.md) (section « Clôture de la V1 ») pour ce qui est livré, ce qui a été vérifié et ce qui ne l'a pas été. **La V2 est en cours** (démarrée le 12/10/2026, une pull request par étape) : les étapes 0 à 7 sont faites (finition de la V1, lancer et fermer des applications, recherche web, volume / musique / batterie de la souris, plusieurs projets en parallèle) ; l'étape 8 (moteur de protocoles) est faite avec le protocole 7E3A, essayé en réel (2B et 6H9K reportés) ; l'étape 9 (voix) est faite côté code, voix de Løra (Piper) et mot d'activation (Whisper) essayés avec la vraie voix, il reste du temps d'usage, un ruban réactif au volume réel et l'écoute fenêtre fermée ; l'étape 13 (commandes vocales élargies) a un premier lot ; l'étape 10 (widget de bureau) est commencée. Les étapes 11 et 12 (« qu'est-ce que je regarde ? », gestes de la main) ne sont pas commencées. L'avancement, ce qui est vérifié et ce qui ne l'est pas : [`docs/ai/STATUS-V2.md`](docs/ai/STATUS-V2.md) ; la vision et la liste des étapes : [`docs/ai/LoraV2.md`](docs/ai/LoraV2.md).

## Journal de construction

[`docs/portfolio/BUILD-LOG.md`](docs/portfolio/BUILD-LOG.md) raconte comment le projet a été conçu : architecture, choix techniques et leurs raisons, bugs rencontrés, évolution du design — matière première pour une présentation portfolio.
