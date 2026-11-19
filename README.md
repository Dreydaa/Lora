# Løra

**English** · [Français](README.fr.md)

A personal assistant driven by **Telegram**, for a single user, paired with a **Windows desktop app** (voice, command bar, hand gestures). Løra helps you keep a work discipline on your current projects, with one personality ("Friday"), and uses **Notion as the source of truth** for all your data (ideas, agenda, milestones, daily reviews, settings).

> Løra was called *Soza* until 2026-11-05. A few technical identifiers kept the old name on purpose (app data folder `com.soza.assistant`, QStash schedule ids, repository name) — see "Renaming" in [`docs/ai/STATUS-V2.md`](docs/ai/STATUS-V2.md).

## Read this first

- **Self-hosted, single user.** There is no hosted version. You create your own Notion workspace, Telegram bot, Upstash and Groq accounts, and deploy your own backend on Vercel. All of them have a free tier that is enough for personal use.
- **The assistant speaks French.** The personality prompt (`lib/ai/prompts/friday.ts`), briefings, voice and wake word are French, and dates use the `Europe/Paris` time zone. Changing the language means rewriting that prompt and a few strings; it is not a setting.
- **The desktop app is Windows-only** (Windows 10/11, Rust + Tauri). The backend and the Telegram part work without it.
- **It started as a personal project** and was built around one person's setup (a Parsec/VS Code "protocol", the Brave browser, Blender gestures…). Everything personal is either configurable in a local file or isolated in one place listed in [Customizing](#customizing).
- Some features (wake word, voice, hand gestures) were only tried on the author's machine (Windows 11, NVIDIA GPU, one webcam). Expect to tweak things.

## What it does

**On Telegram (works with your PC off)**

- Understands natural language and acts in Notion through AI tool calls: create an idea (size and notes decided by the model), add an appointment or a work shift to the agenda, change a project's status, create/validate milestones, record the daily review, pause Løra for a few days ("I'm taking my weekend"), change the briefing time…
- **Morning briefing** (weather, agenda over 7 days, yesterday's review, news from your RSS feeds) and **evening review** (the day, next milestone of each running project, agenda, then the review question), at times you can change by chat. Triggered by QStash schedules.
- **Several projects in parallel**: the evening review records which ones you worked on.
- **Web search** for outside or recent questions (Groq's built-in search; retries without it on failure).
- **Direct answers without the model** for simple things (weather, unit conversions, countdowns, titles…) to save tokens.
- **Protocols**: the exact message `Protocole 7E3A` runs a named sequence (e.g. open apps on your PC); the PC fetches it and reports the result back on Telegram. The trigger is matched by code, never by the model.

**On the desktop app (Windows)**

- A "liquid glass" dashboard in front of a Möbius ribbon made of particles (three.js), showing your Notion data read-only, plus screen time per application (measured locally, never uploaded).
- **`Ctrl+K` command bar**: open/close allow-listed apps, set the volume, control music (Spotify), read the mouse battery — all of these work offline; any other sentence goes to the backend (`api/ask`), the same brain as Telegram.
- **Voice**: every answer is spoken (Piper locally if installed, otherwise the Windows voice). A **wake word "Løra"** with **local speech recognition** (whisper.cpp, nothing leaves the PC). Writing to Notion requires a spoken confirmation. "Løra, stop" cuts her off, "Løra, repose-toi" stops listening, "Løra, fin de mission" quits.
- **Hand gestures** (MediaPipe, local; camera off by default and switched on by voice): a "manual mode" for Blender — rotate, zoom with two index fingers, scale, validate with two fists.
- Tray icon, start with Windows, optional work "modes" (open apps + web pages + a liked Spotify song), spontaneous speech (appointments, mouse battery, back-pain break), optional Claude Code hooks (she reads out Claude Code's last answer).

## How it works

```
 Telegram ──► api/telegram-webhook ──► QStash ──► api/qstash-worker ──► Groq (tool calls) ──► Notion
 (chat_id checked)   (never runs long tasks)        (the long job)                              │
                                                                                                ▼
 QStash schedules ──► api/cron-morning / api/cron-evening ──► Telegram + short copy in Redis ◄──┘
                                                                         │
 Desktop app (Tauri) ◄── api/dashboard · api/ask · api/protocol ◄────────┘
```

1. Telegram sends the message to `api/telegram-webhook.ts`, which checks the webhook secret and the allowed `chat_id`, then publishes a job to **QStash** immediately. No long task ever runs inside the webhook.
2. QStash delivers it to `api/qstash-worker.ts`, which calls the model (Groq, through the Vercel AI SDK) with tools (`lib/ai/tools.ts`) that read and write Notion.
3. Two **QStash schedules** trigger the morning briefing and the evening review at the times stored in the Notion *Løra Réglages* database.
4. **Redis (Upstash)** holds a short conversation memory (~10 messages / 6 h), the last briefing and the current pause.
5. The **Tauri desktop app** reads `api/dashboard` and talks to `api/ask`; its Rust side handles everything local (apps, volume, music, microphone, voice, camera).

## Stack

- **Backend**: Vercel Functions (Edge Runtime) in TypeScript, `@upstash/qstash`, `@upstash/redis`, `@notionhq/client`.
- **AI**: Groq via `ai` (Vercel AI SDK), `zod` for tool-call parameters. Default model `openai/gpt-oss-120b`, fallback `openai/gpt-oss-20b`.
- **Desktop**: React 18 + Vite + three.js, packaged with Tauri 2 (Rust).
- **Local voice/vision**: whisper.cpp (speech recognition), Piper (speech synthesis), MediaPipe (hands).
- **Tests**: Vitest (unit, integration, regression, browser acceptance with Playwright) and `cargo test`.

## Requirements

| For | You need |
| --- | --- |
| Everything | Node.js 20 or newer (developed on Node 24), npm, Git |
| Backend | Free accounts: [Vercel](https://vercel.com), [Groq](https://console.groq.com), [Notion](https://www.notion.so), [Upstash](https://console.upstash.com) (QStash **and** Redis), and a Telegram account |
| Desktop app | Windows 10/11, [Rust](https://rustup.rs) (MSVC toolchain), Visual Studio Build Tools with the "Desktop development with C++" workload, WebView2 (already in Windows 11) — see the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) |
| Local speech recognition (optional) | An NVIDIA GPU is what was tested (CUDA build of whisper.cpp), about 2 GB of disk |
| Hand gestures (optional) | A webcam |
| Browser acceptance tests (optional) | Edge or Chrome installed (or `CHROMIUM_PATH`) |

## Getting started

### 1. Get the code

```bash
git clone https://github.com/Dreydaa/Soza.git
cd Soza
npm install
cp .env.example .env     # PowerShell: Copy-Item .env.example .env
```

Fill `.env` as you go through the next steps. Never commit it (it is git-ignored). Every variable is explained in [`.env.example`](.env.example). **No space after the `=`.**

### 2. Create the accounts and keys

| Service | What to do | Variables |
| --- | --- | --- |
| **Groq** | Create an API key. | `GROQ_API_KEY` (optionally `GROQ_MODEL`) |
| **Notion** | Create an *internal integration*, create an empty page "Løra", share it with the integration (`…` → *Connections*). | `NOTION_TOKEN`, `NOTION_PARENT_PAGE_ID` |
| **Telegram** | Talk to [@BotFather](https://t.me/BotFather) → `/newbot`. Send any message to your bot, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and read `message.chat.id`. | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_ID`, and a random `TELEGRAM_WEBHOOK_SECRET` (letters, digits, `_`, `-`) |
| **Upstash QStash** | Copy the token and the two signing keys. | `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`; keep `QSTASH_DEV=false` |
| **Upstash Redis** | Create a database, copy the REST URL and token. | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| **Your own secrets** | Generate long random strings, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. | `CRON_SECRET`, `DASHBOARD_API_KEY`, and the same value as `DASHBOARD_API_KEY` in `VITE_DASHBOARD_API_KEY` |
| **Optional** | Your coordinates and RSS feeds for the briefing. | `WEATHER_LAT`, `WEATHER_LON`, `NEWS_RSS_URL_TECH`, `NEWS_RSS_URL_FASHION` |

### 3. Create the Notion databases

```bash
npm run notion:check             # checks the connection and the shared page
npm run notion:create            # creates Agenda, Ideas, Milestones, Progress
npm run notion:create-settings   # creates the "Løra Réglages" database
```

Copy the database ids printed by these scripts into `NOTION_AGENDA_DATABASE_ID`, `NOTION_IDEAS_DATABASE_ID`, `NOTION_MILESTONES_DATABASE_ID`, `NOTION_PROGRESS_DATABASE_ID` and `NOTION_SETTINGS_DATABASE_ID`. The schema is documented in [`docs/product/NOTION-SCHEMA.md`](docs/product/NOTION-SCHEMA.md).

### 4. Deploy the backend on Vercel

```bash
npx vercel                # link the project (first time)
```

Add **all the variables of `.env` except the `VITE_*` ones** in *Project → Settings → Environment Variables* (or with `npx vercel env add`; paste values without spaces), then:

```bash
npx vercel --prod
```

Set `APP_URL` to your **stable production domain** (e.g. `https://your-app.vercel.app`), not the per-deployment URL: QStash delivers jobs there, and Vercel's Deployment Protection answers `401` on per-deployment URLs. Redeploy after changing it.

### 5. Plug Telegram and QStash

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://your-app.vercel.app/api/telegram-webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"

npm run qstash:setup-schedules   # creates the morning-briefing and evening-review schedules
```

Send a message to your bot ("add an idea: …"). You should get an answer. Messages from any other chat are silently ignored.

### 6. Build the desktop app (Windows, optional)

1. In `.env`, set `VITE_API_URL` to your production URL and `VITE_DASHBOARD_API_KEY` to the same value as `DASHBOARD_API_KEY`. They are **embedded in the build**.
2. In [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json), replace the backend origin in the `connect-src` of **both** `csp` and `devCsp` with your own URL. The Content-Security-Policy is deliberately strict: if you forget this, the app can't reach your backend.
3. Run it:

```bash
npm run tauri dev      # development
npm run tauri build    # Windows installer (NSIS): src-tauri/target/release/bundle/nsis/
```

4. On first launch the app creates its local files in `%APPDATA%\com.soza.assistant\` (see [Local files](#local-files)). Fill in `agent.json` (`api_url` and `api_key`: same values as `VITE_API_URL` and `VITE_DASHBOARD_API_KEY`) so the PC can fetch protocols, and `apps.json` with the apps Løra may open.

> **Don't share a build or an installer made with your `.env`**: your dashboard key is inside.

### 7. Optional local voice

Løra speaks with the Windows voice out of the box. For the rest, put the files in `%APPDATA%\lora-voice\` (a sibling of the data folder, so uninstalling the app can't delete them):

- **Speech recognition + wake word**: `whisper\whisper-server.exe` and its DLLs from a [whisper.cpp release](https://github.com/ggml-org/whisper.cpp/releases) (the author used `b5454`, `whisper-bin-win-cuda-12.4.0-x64.zip`), and the model `whisper\ggml-large-v3-turbo-q5_0.bin` from [Hugging Face](https://huggingface.co/ggerganov/whisper.cpp). Without them, listening simply doesn't start. Only the CUDA build was tested.
- **Better voice (Piper)**: `piper\piper.exe` (a Piper 1.x build that reads UTF-8 and supports `--output-dir`; the old C++ build doesn't work) and a French voice model named `fr_FR-soza-medium.onnx` with its `.onnx.json`. The author's own voice model is **not** distributed. Details and pitfalls: [`docs/ai/STATUS-V2.md`](docs/ai/STATUS-V2.md), step 9. Without Piper, the Windows voice is used.

## Local files

Created empty on first launch in `%APPDATA%\com.soza.assistant\`, re-read on every command, **never versioned**:

| File | Content |
| --- | --- |
| `apps.json` | Allow-list of apps that `Ctrl+K` and protocols may open or close: `{ "name": "C:\\path\\to\\app.exe" }`. Nothing else can be launched. |
| `agent.json` | `api_url` and `api_key`, so the PC can fetch protocols. |
| `spotify.json` | `client_id` / `client_secret` of a (free) Spotify app, to search a track by name. Without them, the search opens in Spotify without playing. |
| `spotify-token.json` | Refresh token created by "connecte Spotify" (liked songs, read-only). Deleting it disconnects. |
| `modes.json` | Work modes ("mode créatif", "mode dev"): a trigger phrase and steps (`open` an app, `browse` web pages, `liked_song`). Created with two starter modes. |
| `voice.json` | `volume` (0–1) and `english` (app names pronounced with an English accent). |
| `listen.json` | `enabled`, `wake` (spellings of the wake word), `threshold`, `command_secs`, `log` (**`true` writes everything heard, in clear text,** to `listen.log`: only for tuning). |

## Customizing

| What | Where |
| --- | --- |
| Personality, tone, allowed nicknames ("Boss", "patron", "chef") | `lib/ai/prompts/friday.ts` |
| Protocols (`Protocole 7E3A` opens Parsec + VS Code; `2B` and `6H9K` are empty) | `lib/protocols.ts` |
| Time zone (`Europe/Paris`) | `lib/date.ts`, `lib/integrations/qstash.ts`, `lib/notion/agenda.ts`, `lib/ai/client.ts` |
| Briefing times | Ask Løra in chat ("briefing at 7:30"), or edit the *Løra Réglages* database |
| Notion categories / logos | `lib/types.ts` (`CATEGORIES`) |
| Wake word spellings, volume, allowed apps | the local files above |

## Commands

```bash
npm run dev                 # dashboard in the browser (Vite)
npm run build               # tsc --noEmit + Vite build
npm run tauri dev           # desktop app in development
npm run tauri build         # Windows installer

npm test                    # fast: unit + integration + regression (a few seconds)
npm run test:acceptance     # scenarios in a real browser (~2 min)
npm run test:rust           # Rust tests
npm run test:all            # everything above

npm run test:live           # real APIs (Notion, Groq…), run by hand
npm run test:search         # web-search battery on real Groq (~220,000 tokens)
npm run test:projects       # multi-project briefings on real Groq (~160,000 tokens)
npm run test:protocol       # protocols end to end (fake Redis/Telegram/QStash)
```

The regular tests (`npm test`, `test:acceptance`, `test:rust`) **never use your `.env` or any real service**: fake variables, and any unexpected network call fails the test. Only `test:live`, `test:search` and `test:projects` call real APIs, and each of the two batteries can use up a free Groq daily quota in one run.

Two one-off Notion migrations also exist: `notion:migrate-agenda-type` and `notion:categories-cleanup`.

## Repository layout

```
api/            Vercel endpoints: Telegram webhook, QStash worker, morning/evening crons, dashboard, protocol, ask
lib/            Backend logic: ai/ (client, personality, tools), notion/, integrations/ (Telegram, QStash, weather, news),
                briefing, protocols, quick answers, dates, Redis memory
src/            Desktop front end (React): glass dashboard, calendar, particle intro, hands, widget
src-tauri/      Rust app: window, screen time, tray, local commands (apps, volume, music, battery), voice (Piper),
                microphone + wake word (Whisper), gestures, work modes, Claude Code link
tests/          unit, integration, regression, acceptance (+ fake Notion/Redis, blocked network)
scripts/        Notion/QStash setup and migrations, live batteries
docs/           ai/ (status and plans), product/ (Notion schema, UI), portfolio/ (build log)
```

## Security and privacy

- The Telegram webhook checks the **secret token** and the **`chat_id`** before doing anything; other chats are ignored. Long tasks are published to QStash, never run in the webhook.
- Crons and the worker accept only a valid **QStash signature** (or `Bearer CRON_SECRET` for manual triggers). The dashboard, `ask` and `protocol` endpoints require the `x-dashboard-key` header.
- It is a **single-user** design: one shared dashboard key, no user accounts. Treat that key like a password, and never publish an app build that contains it.
- Secrets live only in environment variables. No `.env` file was ever committed to this repository.
- Screen time, the allow-list and local voice stay **on your PC**. Speech recognition is local (the server listens on `127.0.0.1` only). The camera is off by default and processed locally.
- To report a vulnerability, please use GitHub's private "Report a vulnerability" form (Security tab) rather than a public issue.

## Project status and documentation

V1 (cloud + dashboard) was declared finished on 2026-10-09; V2 (local voice, gestures…) on 2026-11-14 after a final review. The "protocols" step (2B and 6H9K) is on hold. The detailed, dated status — what is done, measured, and what was never verified live — is in:

- [`docs/ai/STATUS-V2.md`](docs/ai/STATUS-V2.md): V2 progress (current)
- [`docs/ai/LoraV2.md`](docs/ai/LoraV2.md): vision, design decisions, to-do list
- [`docs/ai/STATUS.md`](docs/ai/STATUS.md): V1 history
- [`docs/product/NOTION-SCHEMA.md`](docs/product/NOTION-SCHEMA.md) and [`docs/product/UI.md`](docs/product/UI.md): Notion schema, UI notes
- [`docs/portfolio/BUILD-LOG.md`](docs/portfolio/BUILD-LOG.md): how it was designed (architecture, choices and their reasons, bugs, design evolution)

These documents are written in French.

## Contributing

Issues and pull requests are welcome, but this is a personal project: no support or response time is promised. Before a PR, run `npm test`, `npm run build` and, if you touched Rust, `npm run test:rust`. Keep secrets out of commits, and never put real tokens in tests.

## License

[MIT](LICENSE). Third-party components keep their own licenses: MediaPipe (Apache-2.0), whisper.cpp (MIT), Piper and its voice models (check the license of the model you use), three.js (MIT), Tauri (MIT/Apache-2.0), Simple Icons (CC0).
