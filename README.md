# Soza

Assistant personnel piloté par Telegram, pour un unique utilisateur. Soza aide à garder une discipline de travail sur son projet en cours sans ignorer la fatigue liée aux shifts physiques (horaires de travail postés).

Notion est la source de vérité pour toutes les données (idées, agenda, jalons, progression, réglages). Soza ne fait qu'y lire et écrire.

## Comment ça marche

1. **Telegram** reçoit un message → `api/telegram-webhook.ts` valide le `chat_id` autorisé et publie immédiatement le job dans **QStash** (aucune tâche longue n'est exécutée dans le webhook lui-même).
2. **QStash** livre le job à `api/qstash-worker.ts`, qui appelle le modèle (Groq, via le Vercel AI SDK) avec un jeu de tools (`lib/ai/tools.ts`) capables de lire/écrire dans Notion : créer une idée, ajouter un rendez-vous ou un shift à l'agenda, changer le statut d'un projet, enregistrer la progression du jour, changer les horaires du mode pause, etc.
3. Deux **crons QStash** déclenchent le briefing du matin (`api/cron-morning.ts`) et le bilan du soir (`api/cron-evening.ts`) aux horaires configurés dans la base Notion **Soza Réglages**.
4. Une **mémoire courte durée** (Redis, ~10 messages / 6h) permet de garder le contexte d'une conversation Telegram sans tout réinjecter depuis Notion à chaque message.
5. Un **dashboard Tauri** (app de bureau) affiche ces mêmes données en lecture — le design visuel est en cours de refonte (voir `docs/ai/STATUS.md`), il n'écrit pas encore dans Notion.

## Stack

- **Backend** : fonctions Vercel (Edge Runtime) en TypeScript, `@upstash/qstash`, `@upstash/redis`, `@notionhq/client`.
- **IA** : Groq via `ai` (Vercel AI SDK) + `zod` pour la validation des paramètres de tool calls.
- **Frontend / dashboard** : React + Vite, packagé en application de bureau avec Tauri (`src-tauri/`).

## Structure du repo

```
api/                  Endpoints Vercel : webhook Telegram, worker QStash, crons matin/soir
lib/
  ai/                 Client IA, prompts de persona, définition des tools
  notion/             Accès aux bases Notion (agenda, idées, jalons, progression, réglages)
  integrations/       Telegram, QStash, météo, actualités
  memory.ts           Mémoire courte durée (Redis)
  modes.ts            Logique du mode ACTIF/PAUSE
src/                  Dashboard Tauri (React)
  features/           Un dossier par onglet (agenda, idées, jalons, actualités, réglages, quiz...)
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
| Divers | `NEWS_RSS_URL_TECH`, `NEWS_RSS_URL_FASHION`, `WEATHER_LAT`, `WEATHER_LON` |

Setup Notion détaillé dans `docs/product/NOTION-SCHEMA.md`.

## Commandes

```bash
npm run dev                        # dashboard Tauri en dev (Vite)
npm run build                      # tsc --noEmit + build Vite
npm run tauri                      # CLI Tauri

npm run notion:check               # vérifie la connexion Notion
npm run notion:create              # crée les bases Notion (Agenda, Idées, Jalons, Progression)
npm run notion:create-settings     # crée la base Soza Réglages
npm run notion:migrate-agenda-type # migration du champ Type sur Agenda

npm run qstash:setup-schedules     # configure les schedules QStash (briefing/bilan)
```

Le script `scripts/full-mechanics-test.ts` (lancé via `tsx --env-file=.env scripts/full-mechanics-test.ts`) fait office de suite de tests d'intégration contre les vraies APIs (Notion, Redis, QStash) ; il n'y a pas de tests unitaires isolés.

## État du projet

Voir [`docs/ai/STATUS.md`](docs/ai/STATUS.md) pour le détail de ce qui est fait et ce qu'il reste à faire.
