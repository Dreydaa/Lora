# Løra

[English](README.md) · **Français**

Un assistant personnel piloté par **Telegram**, pour un seul utilisateur, doublé d'une **application de bureau Windows** (voix, barre de commande, gestes de la main). Løra aide à garder une discipline de travail sur tes projets en cours, avec une seule personnalité (« Friday »), et utilise **Notion comme source de vérité** pour toutes tes données (idées, agenda, jalons, bilans, réglages).

> Løra s'appelait *Soza* jusqu'au 05/11/2026. Quelques identifiants techniques gardent l'ancien nom volontairement (dossier de données `com.soza.assistant`, identifiants des planifications QStash, nom du dépôt) : voir « Renommage » dans [`docs/ai/STATUS-V2.md`](docs/ai/STATUS-V2.md).

## À lire d'abord

- **Auto-hébergé, un seul utilisateur.** Il n'existe pas de version hébergée. Tu crées ton propre espace Notion, ton bot Telegram, tes comptes Upstash et Groq, et tu déploies ton propre backend sur Vercel. Tous ont une offre gratuite suffisante pour un usage personnel.
- **L'assistante parle français.** Le prompt de personnalité (`lib/ai/prompts/friday.ts`), les briefings, la voix et le mot d'activation sont en français, et les dates utilisent le fuseau `Europe/Paris`. Changer de langue veut dire réécrire ce prompt et quelques textes : ce n'est pas un réglage.
- **L'application de bureau ne tourne que sous Windows** (Windows 10/11, Rust + Tauri). Le backend et la partie Telegram marchent sans elle.
- **C'est né comme un projet personnel**, construit autour de l'installation d'une personne (un « protocole » Parsec/VS Code, le navigateur Brave, des gestes pour Blender…). Tout ce qui est personnel se règle dans un fichier local ou est isolé à un seul endroit, listé dans [Personnaliser](#personnaliser).
- Certaines fonctions (mot d'activation, voix, gestes) n'ont été essayées que sur la machine de l'auteur (Windows 11, carte NVIDIA, une webcam). Attends-toi à quelques réglages.

## Ce que ça fait

**Sur Telegram (marche PC éteint)**

- Comprend le langage naturel et agit dans Notion par des appels d'outils IA : créer une idée (taille et notes décidées par le modèle), ajouter un rendez-vous ou un shift à l'agenda, changer le statut d'un projet, créer ou valider des jalons, enregistrer le bilan du jour, mettre Løra en pause quelques jours (« je prends mon week-end »), changer l'heure du briefing…
- **Briefing du matin** (météo, agenda sur 7 jours, bilan d'hier, actualités de tes flux RSS) et **bilan du soir** (la journée, le prochain jalon de chaque projet en cours, l'agenda, puis la question du bilan), à des horaires modifiables en discutant. Déclenchés par des planifications QStash.
- **Plusieurs projets en parallèle** : le bilan du soir enregistre sur lesquels tu as avancé.
- **Recherche web** pour une question extérieure ou récente (recherche intégrée de Groq ; nouvel essai sans elle en cas d'échec).
- **Réponses directes sans le modèle** pour les choses simples (météo, conversions, comptes à rebours, titres…), pour économiser des jetons.
- **Protocoles** : le message exact `Protocole 7E3A` lance une séquence nommée (par exemple ouvrir des applications sur ton PC) ; le PC la récupère et le résultat revient sur Telegram. Le déclencheur est reconnu par le code, jamais par le modèle.

**Sur l'application de bureau (Windows)**

- Un tableau de bord en « verre liquide » devant un ruban de Möbius en particules (three.js), qui affiche tes données Notion en lecture seule, plus le temps passé par application (mesuré en local, jamais envoyé).
- **Barre de commande `Ctrl+K`** : ouvrir ou fermer des applications d'une liste blanche, régler le volume, piloter la musique (Spotify), lire la batterie de la souris (tout cela marche hors ligne) ; toute autre phrase part au backend (`api/ask`), le même cerveau que Telegram.
- **Voix** : chaque réponse est dite (Piper en local s'il est installé, sinon la voix de Windows). **Mot d'activation « Løra »** avec **reconnaissance vocale locale** (whisper.cpp, rien ne sort du PC). Avant d'écrire dans Notion, elle demande confirmation à voix haute. « Løra, stop » la coupe, « Løra, repose-toi » arrête l'écoute, « Løra, fin de mission » ferme l'application.
- **Gestes de la main** (MediaPipe, en local ; caméra éteinte par défaut et allumée à la voix) : un « mode manuel » pour Blender : rotation, zoom aux deux index, scaling, validation aux deux poings.
- Icône de la zone de notification, démarrage avec Windows, « modes » de travail facultatifs (applications + pages web + un titre liké Spotify), parole spontanée (rendez-vous, batterie de la souris, pause pour le dos), hooks Claude Code facultatifs (elle lit la dernière réponse de Claude Code).

## Comment ça marche

```
 Telegram ──► api/telegram-webhook ──► QStash ──► api/qstash-worker ──► Groq (outils) ──► Notion
 (chat_id validé)   (aucune tâche longue)           (le travail long)                       │
                                                                                            ▼
 Planifications QStash ──► api/cron-morning / api/cron-evening ──► Telegram + copie courte dans Redis ◄─┘
                                                                         │
 App de bureau (Tauri) ◄── api/dashboard · api/ask · api/protocol ◄──────┘
```

1. Telegram envoie le message à `api/telegram-webhook.ts`, qui vérifie le secret du webhook et le `chat_id` autorisé, puis publie aussitôt un job dans **QStash**. Aucune tâche longue ne s'exécute dans le webhook.
2. QStash le livre à `api/qstash-worker.ts`, qui appelle le modèle (Groq, via le Vercel AI SDK) avec des outils (`lib/ai/tools.ts`) qui lisent et écrivent dans Notion.
3. Deux **planifications QStash** déclenchent le briefing du matin et le bilan du soir aux heures stockées dans la base Notion *Løra Réglages*.
4. **Redis (Upstash)** garde une mémoire courte de la conversation (~10 messages / 6 h), le dernier briefing et la pause en cours.
5. L'**application de bureau Tauri** lit `api/dashboard` et parle à `api/ask` ; son côté Rust gère tout le local (applications, volume, musique, micro, voix, caméra).

## Stack

- **Backend** : fonctions Vercel (Edge Runtime) en TypeScript, `@upstash/qstash`, `@upstash/redis`, `@notionhq/client`.
- **IA** : Groq via `ai` (Vercel AI SDK), `zod` pour les paramètres des appels d'outils. Modèle par défaut `openai/gpt-oss-120b`, repli `openai/gpt-oss-20b`.
- **Bureau** : React 18 + Vite + three.js, packagé avec Tauri 2 (Rust).
- **Voix et vision en local** : whisper.cpp (reconnaissance vocale), Piper (synthèse vocale), MediaPipe (mains).
- **Tests** : Vitest (unitaires, intégration, régression, acceptation dans un vrai navigateur avec Playwright) et `cargo test`.

## Prérequis

| Pour | Il te faut |
| --- | --- |
| Tout | Node.js 20 ou plus (développé sous Node 24), npm, Git |
| Backend | Comptes gratuits : [Vercel](https://vercel.com), [Groq](https://console.groq.com), [Notion](https://www.notion.so), [Upstash](https://console.upstash.com) (QStash **et** Redis), et un compte Telegram |
| Application de bureau | Windows 10/11, [Rust](https://rustup.rs) (chaîne MSVC), Visual Studio Build Tools avec la charge « Développement Desktop en C++ », WebView2 (déjà dans Windows 11) : voir les [prérequis de Tauri](https://v2.tauri.app/start/prerequisites/) |
| Reconnaissance vocale locale (facultatif) | Une carte NVIDIA est ce qui a été testé (whisper.cpp version CUDA), environ 2 Go de disque |
| Gestes de la main (facultatif) | Une webcam |
| Tests d'acceptation (facultatif) | Edge ou Chrome installé (ou `CHROMIUM_PATH`) |

## Démarrage

### 1. Récupérer le code

```bash
git clone https://github.com/Dreydaa/Soza.git
cd Soza
npm install
cp .env.example .env     # PowerShell : Copy-Item .env.example .env
```

Remplis `.env` au fil des étapes suivantes. Ne le commite jamais (il est ignoré par git). Chaque variable est expliquée dans [`.env.example`](.env.example). **Pas d'espace après le `=`.**

### 2. Créer les comptes et les clés

| Service | À faire | Variables |
| --- | --- | --- |
| **Groq** | Créer une clé d'API. | `GROQ_API_KEY` (et éventuellement `GROQ_MODEL`) |
| **Notion** | Créer une *intégration interne*, créer une page vide « Løra », la partager avec l'intégration (`…` → *Connexions*). | `NOTION_TOKEN`, `NOTION_PARENT_PAGE_ID` |
| **Telegram** | Parler à [@BotFather](https://t.me/BotFather) → `/newbot`. Envoyer un message à ton bot, puis ouvrir `https://api.telegram.org/bot<TOKEN>/getUpdates` et lire `message.chat.id`. | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_ID`, et un `TELEGRAM_WEBHOOK_SECRET` aléatoire (lettres, chiffres, `_`, `-`) |
| **Upstash QStash** | Copier le jeton et les deux clés de signature. | `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` ; garder `QSTASH_DEV=false` |
| **Upstash Redis** | Créer une base, copier l'URL REST et le jeton. | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| **Tes propres secrets** | Générer de longues chaînes aléatoires, par exemple `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. | `CRON_SECRET`, `DASHBOARD_API_KEY`, et la même valeur que `DASHBOARD_API_KEY` dans `VITE_DASHBOARD_API_KEY` |
| **Facultatif** | Tes coordonnées et des flux RSS pour le briefing. | `WEATHER_LAT`, `WEATHER_LON`, `NEWS_RSS_URL_TECH`, `NEWS_RSS_URL_FASHION` |

### 3. Créer les bases Notion

```bash
npm run notion:check             # vérifie la connexion et la page partagée
npm run notion:create            # crée Agenda, Idées, Jalons, Progression
npm run notion:create-settings   # crée la base « Løra Réglages »
```

Recopie les identifiants de bases affichés par ces scripts dans `NOTION_AGENDA_DATABASE_ID`, `NOTION_IDEAS_DATABASE_ID`, `NOTION_MILESTONES_DATABASE_ID`, `NOTION_PROGRESS_DATABASE_ID` et `NOTION_SETTINGS_DATABASE_ID`. Le schéma est décrit dans [`docs/product/NOTION-SCHEMA.md`](docs/product/NOTION-SCHEMA.md).

### 4. Déployer le backend sur Vercel

```bash
npx vercel                # lie le projet (première fois)
```

Ajoute **toutes les variables de `.env` sauf celles en `VITE_*`** dans *Project → Settings → Environment Variables* (ou avec `npx vercel env add` ; colle les valeurs sans espace), puis :

```bash
npx vercel --prod
```

Mets dans `APP_URL` ton **domaine de production stable** (par exemple `https://your-app.vercel.app`), pas l'URL propre à chaque déploiement : QStash y livre les jobs, et la Deployment Protection de Vercel répond `401` sur les URL par déploiement. Redéploie après l'avoir changée.

### 5. Brancher Telegram et QStash

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://your-app.vercel.app/api/telegram-webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"

npm run qstash:setup-schedules   # crée les planifications du briefing du matin et du bilan du soir
```

Envoie un message à ton bot (« ajoute une idée : … »). Tu dois recevoir une réponse. Les messages de tout autre chat sont ignorés en silence.

### 6. Construire l'application de bureau (Windows, facultatif)

1. Dans `.env`, mets `VITE_API_URL` à ton URL de production et `VITE_DASHBOARD_API_KEY` à la même valeur que `DASHBOARD_API_KEY`. Elles sont **embarquées dans le build**.
2. Dans [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json), remplace l'origine du backend dans le `connect-src` de **`csp` et de `devCsp`** par ta propre URL. La Content-Security-Policy est volontairement stricte : si tu l'oublies, l'application ne peut pas joindre ton backend.
3. Lance :

```bash
npm run tauri dev      # développement
npm run tauri build    # installeur Windows (NSIS) : src-tauri/target/release/bundle/nsis/
```

4. Au premier lancement, l'application crée ses fichiers locaux dans `%APPDATA%\com.soza.assistant\` (voir [Fichiers locaux](#fichiers-locaux)). Renseigne `agent.json` (`api_url` et `api_key` : mêmes valeurs que `VITE_API_URL` et `VITE_DASHBOARD_API_KEY`) pour que le PC récupère les protocoles, et `apps.json` avec les applications que Løra peut ouvrir.

> **Ne partage ni un build ni un installeur construit avec ton `.env`** : ta clé du dashboard est dedans.

### 7. Voix locale (facultatif)

Løra parle avec la voix de Windows d'office. Pour le reste, dépose les fichiers dans `%APPDATA%\lora-voice\` (un dossier voisin du dossier de données, pour que la désinstallation de l'application ne puisse pas les supprimer) :

- **Reconnaissance vocale + mot d'activation** : `whisper\whisper-server.exe` et ses DLL, pris dans une [version de whisper.cpp](https://github.com/ggml-org/whisper.cpp/releases) (l'auteur a utilisé `b5454`, `whisper-bin-win-cuda-12.4.0-x64.zip`), et le modèle `whisper\ggml-large-v3-turbo-q5_0.bin` depuis [Hugging Face](https://huggingface.co/ggerganov/whisper.cpp). Sans eux, l'écoute ne démarre simplement pas. Seule la version CUDA a été testée.
- **Meilleure voix (Piper)** : `piper\piper.exe` (une version 1.x de Piper qui lit l'UTF-8 et gère `--output-dir` ; l'ancienne version C++ ne convient pas) et un modèle de voix français nommé `fr_FR-soza-medium.onnx` avec son `.onnx.json`. Le modèle de voix de l'auteur n'est **pas** distribué. Détails et pièges : [`docs/ai/STATUS-V2.md`](docs/ai/STATUS-V2.md), étape 9. Sans Piper, la voix de Windows est utilisée.

## Fichiers locaux

Créés vides au premier lancement dans `%APPDATA%\com.soza.assistant\`, relus à chaque commande, **jamais versionnés** :

| Fichier | Contenu |
| --- | --- |
| `apps.json` | Liste blanche des applications que `Ctrl+K` et les protocoles peuvent ouvrir ou fermer : `{ "nom": "C:\\chemin\\vers\\app.exe" }`. Rien d'autre ne peut être lancé. |
| `agent.json` | `api_url` et `api_key`, pour que le PC récupère les protocoles. |
| `spotify.json` | `client_id` / `client_secret` d'une application Spotify (gratuite), pour chercher un morceau par son nom. Sans eux, la recherche s'ouvre dans Spotify sans lire. |
| `spotify-token.json` | Jeton de renouvellement créé par « connecte Spotify » (titres likés, lecture seule). Le supprimer déconnecte. |
| `modes.json` | Modes de travail (« mode créatif », « mode dev ») : une phrase de départ et des étapes (`open` une application, `browse` des pages web, `liked_song`). Créé avec deux modes de départ. |
| `voice.json` | `volume` (0 à 1) et `english` (noms d'applications dits avec l'accent anglais). |
| `listen.json` | `enabled`, `wake` (orthographes du mot d'activation), `threshold`, `command_secs`, `log` (**`true` écrit tout ce qui est entendu, en clair,** dans `listen.log` : seulement pour régler). |

## Personnaliser

| Quoi | Où |
| --- | --- |
| Personnalité, ton, surnoms permis (« Boss », « patron », « chef ») | `lib/ai/prompts/friday.ts` |
| Protocoles (`Protocole 7E3A` ouvre Parsec + VS Code ; `2B` et `6H9K` sont vides) | `lib/protocols.ts` |
| Fuseau horaire (`Europe/Paris`) | `lib/date.ts`, `lib/integrations/qstash.ts`, `lib/notion/agenda.ts`, `lib/ai/client.ts` |
| Heures des briefings | Le demander à Løra (« briefing à 7h30 »), ou modifier la base *Løra Réglages* |
| Catégories Notion / logos | `lib/types.ts` (`CATEGORIES`) |
| Orthographes du mot d'activation, volume, applications autorisées | les fichiers locaux ci-dessus |

## Commandes

```bash
npm run dev                 # dashboard dans le navigateur (Vite)
npm run build               # tsc --noEmit + build Vite
npm run tauri dev           # application de bureau en développement
npm run tauri build         # installeur Windows

npm test                    # rapide : unit + integration + regression (quelques secondes)
npm run test:acceptance     # scénarios dans un vrai navigateur (~2 min)
npm run test:rust           # tests Rust
npm run test:all            # tout enchaîner

npm run test:live           # vraies APIs (Notion, Groq…), à lancer à la main
npm run test:search         # batterie de recherche web sur le vrai Groq (~220 000 jetons)
npm run test:projects       # briefings multi-projets sur le vrai Groq (~160 000 jetons)
npm run test:protocol       # protocoles de bout en bout (faux Redis/Telegram/QStash)
```

Les tests ordinaires (`npm test`, `test:acceptance`, `test:rust`) **n'utilisent jamais ton `.env` ni un vrai service** : variables factices, et tout appel réseau imprévu fait échouer le test. Seuls `test:live`, `test:search` et `test:projects` appellent de vraies APIs, et chacune des deux batteries peut épuiser un quota quotidien gratuit de Groq en un passage.

Deux migrations Notion ponctuelles existent aussi : `notion:migrate-agenda-type` et `notion:categories-cleanup`.

## Structure du dépôt

```
api/            Endpoints Vercel : webhook Telegram, worker QStash, crons matin/soir, dashboard, protocole, ask
lib/            Logique backend : ai/ (client, personnalité, outils), notion/, integrations/ (Telegram, QStash, météo, actualités),
                briefing, protocoles, réponses directes, dates, mémoire Redis
src/            Interface de l'app de bureau (React) : dashboard en verre, calendrier, intro en particules, mains, widget
src-tauri/      Application Rust : fenêtre, temps d'écran, zone de notification, commandes locales (applications, volume, musique,
                batterie), voix (Piper), micro + mot d'activation (Whisper), gestes, modes de travail, lien avec Claude Code
tests/          unit, integration, regression, acceptance (+ faux Notion/Redis, réseau bloqué)
scripts/        Installation et migrations Notion/QStash, batteries contre les vraies APIs
docs/           ai/ (état d'avancement et plans), product/ (schéma Notion, UI), portfolio/ (journal de construction)
```

## Sécurité et vie privée

- Le webhook Telegram vérifie le **jeton secret** et le **`chat_id`** avant toute action ; les autres chats sont ignorés. Les tâches longues sont publiées dans QStash, jamais exécutées dans le webhook.
- Les crons et le worker n'acceptent qu'une **signature QStash** valide (ou `Bearer CRON_SECRET` pour un déclenchement manuel). Les endpoints dashboard, `ask` et `protocol` exigent l'en-tête `x-dashboard-key`.
- La conception est **mono-utilisateur** : une clé partagée pour le dashboard, pas de comptes. Traite cette clé comme un mot de passe, et ne publie jamais un build de l'application qui la contient.
- Les secrets ne vivent que dans les variables d'environnement. Aucun fichier `.env` n'a jamais été commité dans ce dépôt.
- Le temps d'écran, la liste blanche et la voix locale restent **sur ton PC**. La reconnaissance vocale est locale (le serveur n'écoute que sur `127.0.0.1`). La caméra est éteinte par défaut et traitée en local.
- Pour signaler une faille, utilise le formulaire privé « Report a vulnerability » de GitHub (onglet Security) plutôt qu'une issue publique.

## État du projet et documentation

La V1 (cloud + dashboard) a été déclarée terminée le 09/10/2026 ; la V2 (voix locale, gestes…) le 14/11/2026 après une revue finale. L'étape « protocoles » (2B et 6H9K) est en pause. L'état détaillé et daté (ce qui est fait, mesuré, et ce qui n'a jamais été vérifié en réel) se trouve dans :

- [`docs/ai/STATUS-V2.md`](docs/ai/STATUS-V2.md) : avancement de la V2 (à jour)
- [`docs/ai/LoraV2.md`](docs/ai/LoraV2.md) : vision, décisions de conception, liste des étapes
- [`docs/ai/STATUS.md`](docs/ai/STATUS.md) : historique de la V1
- [`docs/product/NOTION-SCHEMA.md`](docs/product/NOTION-SCHEMA.md) et [`docs/product/UI.md`](docs/product/UI.md) : schéma Notion, notes d'UI
- [`docs/portfolio/BUILD-LOG.md`](docs/portfolio/BUILD-LOG.md) : comment le projet a été conçu (architecture, choix et leurs raisons, bugs, évolution du design)

## Contribuer

Les issues et les pull requests sont les bienvenues, mais c'est un projet personnel : aucun support ni délai de réponse n'est promis. Avant une PR, lance `npm test`, `npm run build` et, si tu as touché au Rust, `npm run test:rust`. Pas de secrets dans les commits, et jamais de vrais jetons dans les tests.

## Licence

[MIT](LICENSE). Les composants tiers gardent leur propre licence : MediaPipe (Apache-2.0), whisper.cpp (MIT), Piper et ses modèles de voix (vérifie la licence du modèle que tu utilises), three.js (MIT), Tauri (MIT/Apache-2.0), Simple Icons (CC0).
