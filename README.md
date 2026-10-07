# Soza

Assistant personnel piloté par Telegram, pour un unique utilisateur. Soza aide à garder une discipline de travail sur son projet en cours sans ignorer la fatigue liée aux shifts physiques (horaires de travail postés).

Notion est la source de vérité pour toutes les données (idées, agenda, jalons, progression, réglages). Soza ne fait qu'y lire et écrire.

## Comment ça marche

1. **Telegram** reçoit un message → `api/telegram-webhook.ts` valide le `chat_id` autorisé et publie immédiatement le job dans **QStash** (aucune tâche longue n'est exécutée dans le webhook lui-même).
2. **QStash** livre le job à `api/qstash-worker.ts`, qui appelle le modèle (Groq, via le Vercel AI SDK) avec un jeu de tools (`lib/ai/tools.ts`) capables de lire/écrire dans Notion : créer une idée, ajouter un rendez-vous ou un shift à l'agenda, changer le statut d'un projet, enregistrer le bilan du jour, mettre Soza en pause quelques jours, changer l'heure du briefing, etc.
3. Deux **crons QStash** déclenchent le briefing du matin (`api/cron-morning.ts`) et le bilan du soir (`api/cron-evening.ts`) aux horaires configurés dans la base Notion **Soza Réglages**.
4. Une **mémoire courte durée** (Redis, ~10 messages / 6h) permet de garder le contexte d'une conversation Telegram sans tout réinjecter depuis Notion à chaque message.
5. Un **dashboard Tauri** (app de bureau) joue une intro en particules (un ruban de Möbius se forme), puis affiche ces mêmes données en lecture dans un tableau de bord en verre liquide (`api/dashboard.ts` agrège Notion). Il n'écrit pas dans Notion : tout se pilote par la conversation Telegram.
6. Une **pause de plusieurs jours** (« je prends mon week-end ») suspend le briefing et le bilan, et le briefing de reprise n'en fait pas un reproche.

## Stack

- **Backend** : fonctions Vercel (Edge Runtime) en TypeScript, `@upstash/qstash`, `@upstash/redis`, `@notionhq/client`.
- **IA** : Groq via `ai` (Vercel AI SDK) + `zod` pour la validation des paramètres de tool calls.
- **Frontend / dashboard** : React + Vite, packagé en application de bureau avec Tauri (`src-tauri/`).

## Structure du repo

```
api/                  Endpoints Vercel : webhook Telegram, worker QStash, crons matin/soir, dashboard
lib/
  ai/                 Client IA, prompt de personnalité unique (friday.ts), définition des tools
  notion/             Accès aux bases Notion (agenda, idées, jalons, progression, réglages)
  integrations/       Telegram, QStash, météo, actualités
  briefing.ts         Construction du briefing du matin (bilan d'hier, agenda à 7 jours, pause)
  date.ts             Dates et fuseau Europe/Paris (Vercel tourne en UTC)
  memory.ts           Redis : mémoire courte durée, dernier briefing, pause en cours
src/                  Dashboard Tauri (React)
  features/           glass (bento en verre), widgets, calendar, intro et particles (ruban de Möbius), hub…
scripts/              Setup Notion/QStash, script d'intégration (`full-mechanics-test.ts`)
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

## Commandes

```bash
npm run dev                        # dashboard Tauri en dev (Vite)
npm run build                      # tsc --noEmit + build Vite
npm run tauri dev                  # application de bureau en développement (Tauri)

npm run notion:check               # vérifie la connexion Notion
npm run notion:create              # crée les bases Notion (Agenda, Idées, Jalons, Progression)
npm run notion:create-settings     # crée la base Soza Réglages
npm run notion:migrate-agenda-type # migration du champ Type sur Agenda

npm run qstash:setup-schedules     # configure les schedules QStash (briefing/bilan)
```

Le script `scripts/full-mechanics-test.ts` (lancé via `tsx --env-file=.env scripts/full-mechanics-test.ts`) fait office de suite de tests d'intégration contre les vraies APIs (Notion, Redis, QStash) ; il n'y a pas de tests unitaires isolés.

## État du projet

Voir [`docs/ai/STATUS.md`](docs/ai/STATUS.md) pour le détail de ce qui est fait et ce qu'il reste à faire.

## Journal de construction

[`docs/portfolio/BUILD-LOG.md`](docs/portfolio/BUILD-LOG.md) raconte comment le projet a été conçu : architecture, choix techniques et leurs raisons, bugs rencontrés, évolution du design — matière première pour une présentation portfolio.
