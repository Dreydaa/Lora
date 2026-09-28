# État Soza

Dernière mise à jour : session du 28/09/2026. Soza est déployé et fonctionnel en production (backend Telegram/Notion complet). Ce qui reste concerne le dashboard Tauri, l'avatar en particules et la voix.

## Fait

### Déploiement
- En production sur Vercel : `https://soza-blond.vercel.app`. Toutes les variables d'env configurées côté Vercel.
- Webhook Telegram enregistré et actif, filtrage `chat_id` vérifié en conditions réelles.
- Bug critique corrigé : QStash livrait les jobs vers `VERCEL_URL` (URL par déploiement, protégée par Vercel Deployment Protection → 401 silencieux). Remplacé par `APP_URL` fixe (`https://soza-blond.vercel.app`).
- Bug corrigé : la plupart des valeurs `.env` avaient un espace en tête (`CLE= valeur`), corrompant les secrets poussés vers Vercel (repoussés proprement, trim appliqué).
- `.vercelignore` ajouté (le premier déploiement tentait d'uploader 1,8 Go de `node_modules`/`src-tauri/target`).

### Pipeline IA
- `lib/ai/client.ts` utilise bien `generateText` + tools du Vercel AI SDK (plus de fetch brut), réponses dans le ton du persona actif — confirmé en prod, plus de réponse générique "Action enregistrée."
- Mémoire courte durée (Redis, 10 messages, 6h) + instruction de doute (ne crée rien sur une intention ambiguë) validées en conditions réelles.
- Une même demande peut contenir plusieurs actions (ex: créer une idée + planifier un rdv) — confirmé, jusqu'à 4 étapes de tool-calls par message.
- **Gemini entièrement retiré** : plus qu'un seul provider (Groq). `@ai-sdk/google` désinstallé, `resolveModel()` simplifié (plus de branchement par provider), `AI_PROVIDER` supprimé du code/env/Vercel, `TESTS-DEMAIN.md` (dont toute la prémisse était le quota Gemini) supprimé.
- Bug de robustesse corrigé : Groq peut renvoyer explicitement `null` pour un paramètre optionnel de tool call au lieu de l'omettre, ce qui faisait échouer toute la validation Zod (et donc l'action entière, silencieusement). Les 6 paramètres optionnels concernés (`statut`, `ideaTitle`, `endDate`, `weekdays`, `shiftStartHour`, `shiftEndHour`) utilisent désormais `.nullish()` au lieu de `.optional()`.

### Mode ACTIF/PAUSE et horaires — désormais dynamiques
- Nouvelle base Notion **Soza Réglages** : source de vérité pour la fenêtre pause (horaires shift) et les heures de briefing/bilan.
- Nouveaux tools IA `update_mode_schedule` (change la fenêtre pause, effet immédiat ou différé à une date) et `update_briefing_schedule` (change l'heure du briefing/bilan).
- Les crons Vercel (limités à 1x/jour, ±59min d'imprécision sur le plan gratuit) ont été remplacés par des **QStash Schedules**, modifiables par API sans redéploiement. `vercel.json` n'a plus de section `crons`.
- `api/cron-morning.ts` / `api/cron-evening.ts` vérifient soit une signature QStash valide, soit `CRON_SECRET` en Bearer (déclenchement manuel de secours).
- **Bug de fuseau horaire corrigé** (`lib/date.ts`, `todayInParis`/`hourInParis` via `Intl`) : en production (Vercel tourne en UTC), `date.getHours()` et `new Date().toISOString()` donnaient l'heure/date UTC au lieu de Paris — la fenêtre pause se déclenchait avec 1-2h de décalage par rapport à la config. Corrigé dans `lib/modes.ts`, `lib/notion/settings.ts`, `lib/notion/idees.ts`, `lib/notion/progress.ts`, `lib/notion/agenda.ts`.

### Base Idées enrichie
- `create_idea` décide lui-même la taille du projet (grille Petit/Moyen/Grand dans la description du tool) au lieu de la demander à l'utilisateur.
- Le champ `Notes` (jusque-là inutilisé) est rempli par une synthèse structurée du fond et de la forme de l'idée, pas un résumé minimal. Testé avec une description de ~1850 caractères → synthèse de ~2800 caractères correctement découpée en blocs Notion (limite de 2000 caractères par bloc `rich_text`).
- **Statut d'idée pilotable** : nouveau champ `statut` sur `create_idea` (Brute/En cours/Archivée, décidé par l'utilisateur explicitement sinon "Brute" par défaut) + nouveau tool `update_idea_status` pour changer le statut d'un projet existant.
- **Bug corrigé** : aucun tool ne permettait de modifier les notes d'une idée déjà créée — Soza tournait en boucle sur "je ne peux pas modifier". Nouveau tool `update_idea_notes` (remplace la synthèse existante). Le vrai projet "Soza" de l'utilisateur, resté sans description à cause de ce bug, a été corrigé après coup.
- `findIdeaByTitle` exclut les idées archivées (évite qu'un titre proche cible la mauvaise page).
- `getMilestones` inclut désormais les jalons en retard (ne les masquait plus après leur échéance).
- Limite de longueur d'un message utilisateur alignée sur la vraie limite Telegram (4096 caractères, au lieu de 4000 arbitraire).

### Agenda enrichi
- `add_agenda_item` accepte une heure de début/fin (`YYYY-MM-DDTHH:mm`), stockée avec le fuseau Europe/Paris explicite pour un rendu correct dans Notion Calendar (Notion gère lui-même l'heure d'été/hiver).
- Nouveau tool `add_shift_schedule` : décrire un rythme de travail récurrent (ex. "je travaille de 5h à 13h du lundi au vendredi jusqu'au 24 octobre") crée un bloc par jour ouvré, marqué d'un nouveau champ Notion **Type** (Perso/Shift).
  - Notion ne supporte pas les événements récurrents via l'API — un bloc unique pour toute la période s'afficherait comme un seul évènement continu dans Notion Calendar. Un bloc par jour reste donc nécessaire pour un rendu correct (choix validé avec l'utilisateur).
  - Pour colorer différemment Shift/Perso dans Notion Calendar : réglage à faire manuellement côté utilisateur (paramètres du calendrier → colorer par propriété → Type), l'API ne permet pas de le configurer.
  - `getUpcomingAgenda()` exclut les blocs Shift par défaut (sinon un planning de plusieurs semaines noierait les rendez-vous personnels dans le briefing du matin).

### Progression / streak — remplace le Proof of Work
- **Proof of Work explicitement mis de côté** (lien, capture, .glb, lecture GitHub...) : décision prise après discussion, à reconsidérer en v2 une fois Soza suffisamment utilisé pour juger de son intérêt réel. Le bouton "Preuve de travail" (placeholder désactivé) retiré de `BlenderPanel.tsx`.
- **Nouvelle condition d'incrémentation du streak** (`record_progress` dans `lib/ai/tools.ts`) : le streak n'avance que si trois conditions sont réunies, sinon il repart à zéro :
  1. Réponse au bilan du soir arrivée avant minuit — vérifié côté serveur (`lib/memory.ts` : `markEveningBilanSent`/`wasEveningBilanSentToday`, marqueur Redis posé par `api/cron-evening.ts` à l'envoi du bilan, comparé à `todayInParis()`), indépendant de ce que le modèle déclare.
  2. Le bilan porte sur le projet actuellement **En cours** dans Notion (`getCurrentProject()` dans `lib/notion/idees.ts`) — comparaison du titre déclaré par le modèle avec celui du projet en cours.
  3. Cohérence jugée par le modèle avec les 3 derniers bilans (`getRecentProgress()` dans `lib/notion/progress.ts`), consultés via le nouveau tool `get_progress_context` que le modèle doit appeler avant `record_progress` (instruction système dédiée dans `lib/ai/client.ts`).
- **Limite assumée** : un seul projet "En cours" est pris en compte à la fois — travailler sur plusieurs projets en parallèle n'est pas géré par cette logique de streak (contrainte acceptée par l'utilisateur en échange de la simplicité du contrôle).

### Actualités
- Remplacé l'unique flux généraliste par deux flux mondiaux réels : Tech (TechCrunch) et Mode (Vogue). Parsing réécrit pour cibler les titres à l'intérieur des balises `<item>` (un flux dupliquait son titre dans un bloc `<image>`, faussant l'ancien découpage positionnel).

### Nettoyage
- 10 scripts de test ad hoc à la racine supprimés, remplacés par `scripts/full-mechanics-test.ts` (batterie complète réutilisable, 37 vérifications contre les vraies APIs, nettoyage automatique de ses propres données de test).
- `docs/ai/STATUS.md` et `HANDOFF.md` (obsolètes) supprimés puis ce fichier recréé à jour ; `docs/ai/CONTEXT.md` conservé.
- Les 4 bases Notion (Idées, Agenda, Milestones, Progress) ont été vidées pour repartir sur une base propre, plus quelques pages résiduelles vides retrouvées et nettoyées en cours de session.

### Dashboard Tauri — reset visuel (design en cours côté utilisateur)
- **La refonte visuelle éditoriale (palette verte/jaune, polices Coinage/Aspekta, arche avatar, popover calendrier, kanban idées, jauge/cadran SVG) a été entièrement retirée à la demande de l'utilisateur**, qui refait le design de zéro dans Figma et le transmettra ensuite (captures d'écran export 2x + valeurs de style en texte, pas de lien Figma direct — pas de connecteur Figma disponible ici).
- `src/styles/tokens.css` et `src/styles/globals.css` réduits à un reset minimal (`box-sizing`, police système, quasi aucune classe). Tous les composants de `src/features/dashboard/`, `calendar/`, `blender/`, `ideas/`, `settings/`, `quiz/` rendent désormais du HTML brut sans classes de mise en forme.
- **Interactions aplaties en listes simples** (décision explicite de l'utilisateur, pas juste un dépouillement CSS) : plus de bascule Semaine/Mois ni de popover calendrier (`CalendarPanel.tsx` liste maintenant les évènements à venir triés par jour), plus de colonnes kanban pour les idées (liste par statut), plus de jauge SVG (Blender) ni de cadran SVG (Réglages) — juste les valeurs en texte.
- Fichiers supprimés car devenus inutilisés par cet aplatissement : `CalendarCard.tsx`, `MonthGrid.tsx`, `WeekGrid.tsx`, `DayPopover.tsx`, `EventBadge.tsx`, `CalendarItem.tsx` (`src/features/calendar/`), ainsi que les helpers `monthCells`/`addMonths`/`sameMonth` dans `src/lib/format.ts`. `components/ui/Icon.tsx` n'est plus utilisé nulle part mais conservé tel quel (probable réutilisation quand le nouveau design arrivera).
- Toute la logique de données est conservée à l'identique (`events.ts`, `mockData.ts`, `dashboardStore.ts`, hooks) — seul l'habillage visuel a changé. Vérifié par `tsc --noEmit`, `vite build`, et un passage Playwright headless sur les 5 onglets (aucune erreur console).
- **Nettoyage pré-existant toujours en attente** (inchangé par ce reset, à faire une fois le nouveau design en place) : `src/components/AvatarOrb/`, `ModeSwitcher.tsx`, `stores/modeStore.ts`, `MilestoneCard.tsx`, `features/milestones/{MilestoneList,Timeline}.tsx`, `features/briefing/BriefingPanel.tsx`, `features/news/NewsPanel.tsx`, `components/ui/{Card,Button}.tsx`, `components/StreakDisplay.tsx`. Rien ne les importe. **Ne pas désinstaller `three`** : il sera réutilisé pour le ruban de Möbius en particules (voir "Avatar Soza" ci-dessous).

## Reste à faire

### Dashboard Tauri
- Design visuel entièrement à refaire : l'utilisateur travaille sa maquette dans Figma, transmission prévue par captures d'écran (export 2x) + valeurs de style en texte. Voir "Dashboard Tauri — reset visuel" ci-dessus.
- Toujours déconnecté de tout backend réel (données factices dans `mockData.ts`). Aucun écran fonctionnel pour la config Réglages (mode/horaires) — l'onglet Réglages affiche les valeurs en lecture seule mais rien n'écrit encore dans Notion depuis le dashboard ; actuellement pilotable uniquement par conversation Telegram.
- Le stockage (Notion) est déjà prêt à être lu/écrit par un futur écran de réglages, sans changement backend nécessaire.
- Le code mort pré-existant listé plus haut ("Nettoyage pré-existant toujours en attente") doit être supprimé une fois l'utilisateur satisfait du nouveau design.
- L'avatar Soza reste à faire par l'utilisateur — hors périmètre IA par consigne explicite. Son emplacement dédié (`.stage__slot`) a disparu avec le reset visuel ; à réintroduire quand le nouveau design arrivera.

### Avatar Soza — ruban de Möbius en particules (décisions du 28/09/2026)
Vision : le hub/page principale du dashboard **est** un ruban de Möbius fait de particules. Plus tard, il devient un widget de bureau animé (fenêtre réduite, app en arrière-plan) qui réagit à la voix de Soza quand elle répond ou fait le briefing. Le design est prototypé par l'utilisateur dans Blender (puis éventuellement TouchDesigner) et documenté pour son portfolio ; le modèle Blender du ruban existe déjà, pas encore converti en particules.

**Décisions d'architecture**
- **Pas de vidéo pour l'intro.** Tout est temps réel dans l'app : un seul système de particules, chaque particule a une position de départ (balayage droite→gauche→droite) et une position cible sur le ruban, interpolées par un paramètre de progression 0→1. Une fois arrivé, le hub est ce même système au repos : l'intro n'est que son état initial (aucun raccord vidéo→canvas).
- Le même moteur sert au hub, au widget de bureau et à la réactivité vocale.
- Positions du ruban : équation paramétrique du Möbius calculée dans le shader (sinon échantillonnage des points du mesh Blender en texture/JSON).
- Blender/TouchDesigner servent au **prototypage et à la documentation portfolio**, pas à produire l'asset final (impossible d'embarquer une scène Blender/TD comme widget de fond dans Tauri). Le rendu final est un shader/three.js dans le webview.
- **Source audio de la réactivité : la voix de Soza (sortie TTS), pas le micro de l'utilisateur.** Le buffer TTS passe dans un `AnalyserNode` (Web Audio API) qui pilote les paramètres des particules (amplitude, bandes de fréquences). Aucune permission micro à gérer.

**Fait (28/09/2026)** — `src/features/intro/` (visible sur `/?intro`, dashboard non touché) : intro temps réel en three.js (3500 sphères UV blanches, fond bleu). Chronologie : entrée depuis la droite le long d'une courbe relevée sur la vue caméra Blender (`path.ts`) → boucle pleine quelques secondes → transformation en ruban de Möbius paramétrique permanent qui tourne autour de son axe propre (`introScene.ts`, constantes réglables en tête de fichier). Responsive : le cadrage garde le tracé entier (fenêtres larges) ou toute la largeur (portrait), la taille du ruban s'adapte.

**À faire sur l'intro**
- **Durée réduite (fait le 28/09/2026)** : l'animation durait ~16,4 s (trop long) ; elle dure maintenant ~8,4 s (ruban qui commence à se former à ~5,6 s, complet à ~8,4 s), avec plus de dynamique (flux plus rapide et plus varié, ondulation le long de la courbe, jaillissement puis convergence des particules pendant la transformation, rotation du ruban plus vive) et des particules plus petites (4500 au lieu de 3500 pour garder la densité). Leviers dans `introScene.ts` : `PATH_SPEED`, `LOOP_HOLD_SECONDS`, `MORPH_STAGGER_SECONDS` / `MORPH_SECONDS`, `SWIRL`, `MIN_SIZE` / `MAX_SIZE`.
- **Choisir les couleurs** : fond bleu (`#2757d0`, estimé à l'œil sur une capture) et particules blanches sont des valeurs provisoires ; à fixer d'après la palette du design final (options `background` / `particleColor`).
- Brancher l'intro au démarrage réel de l'app (avant/vers le dashboard), affiner la courbe sur la référence Blender, puis réactivité audio.

**Éléments UI/UX et backend** : bientôt finalisés côté utilisateur (design Figma, éléments d'interface, backend dashboard). À caler avec ces livraisons : palette de couleurs, emplacement du ruban dans le hub, connexion du dashboard aux vraies données.

**Ordre de réalisation retenu**
1. Hub en ruban de particules **statique** (comble l'ancien emplacement `.stage__slot`, réutilise `three`). Indépendant du reste.
2. **Brancher le dashboard sur le vrai backend** (endpoint ou accès Notion à la place de `mockData.ts`) ; en profiter pour retirer le streak et nettoyer le code mort.
3. **Pipeline vocal** — brique inexistante aujourd'hui (Soza répond uniquement en texte via Telegram/Groq, aucun TTS dans la stack). À décider : choix du TTS, où l'audio est généré (backend ou app), comment il arrive dans l'app Tauri, ce qui déclenche la voix (ex. briefing du matin joué à l'ouverture).
4. Réactivité audio du ruban (mapping AnalyserNode → particules), possible seulement après l'étape 3.
5. Intro animée (particules → ruban), puis widget de bureau (fenêtre Tauri secondaire transparente, toujours au premier plan — vrai chantier, en dernier).

Garde-fou : ne pas dérouler les étapes 4-5 (visuel) avant d'avoir fini 2-3 (dashboard réel + voix), sous peine de polir l'avatar pendant que le dashboard reste sur des données factices.

### Fonctionnalités produit
- Proof of Work : voir section "Progression / streak" ci-dessus — mis de côté au profit d'un contrôle de cohérence conversationnel, à reconsidérer en v2.
- Dégradation visuelle de l'UI après un jalon manqué — non implémentée. L'ancien design anticipait le cas via un attribut `data-degraded="true"` basculant une palette atténuée, mais ce mécanisme a disparu avec le reset visuel (`src/styles/tokens.css` ne contient plus de palette à atténuer). À reconcevoir avec le nouveau design : ni déclencheur (détection d'un jalon manqué) ni rendu associé n'existent pour l'instant.
- **À faire : retirer le streak.** Décision utilisateur (27/09/2026) de retirer complètement la mécanique de streak (comptage de jours consécutifs), pas seulement son affichage. Concerne au minimum : le champ `Streak` de la base Notion Progression, la logique d'incrémentation dans `record_progress` (`lib/ai/tools.ts`, section "Progression / streak" ci-dessus), et `components/StreakDisplay.tsx` côté dashboard (déjà listé en code mort en attente de nettoyage). À vérifier aussi dans les prompts de persona (`lib/ai/prompts/`) si le streak y est mentionné.

### Chantiers à planifier (ajoutés le 28/09/2026)
Liste brute des demandes de l'utilisateur, pas encore priorisées ni commencées. Voir le garde-fou en fin de section.

1. **Personnalité unique de Soza.** Aujourd'hui deux personas selon le mode : Ikkaku (mode ACTIF, coach strict) et Jarvis (mode PAUSE, calme et protecteur), choisies dans `lib/ai/client.ts` et `lib/briefing.ts` (`mode === "ACTIF" ? ikkakuPrompt : jarvisPrompt`). Cible : **une seule personnalité**, tout en **gardant les modes ACTIF/PAUSE** (fenêtre horaire, comportement) — le mode doit moduler l'exigence (ex. une seule micro-action en PAUSE) sans changer de personnage. Concerne `lib/ai/prompts/` (fusion en un prompt unique + variante de mode), les deux points d'appel ci-dessus, et la voix (une seule voix à choisir, voir point 2).
2. **Voix de Soza + reconnaissance vocale en temps réel.** Deux briques distinctes, aucune n'existe aujourd'hui :
   - **Donner une voix à Soza** (TTS) : déjà listé dans "Ordre de réalisation" étape 3 (choix du TTS, génération backend ou app, déclencheurs).
   - **Reconnaissance vocale temps réel (STT)** pour déclencher des fonctionnalités à la voix (nouveau, absent de l'étape 3, qui ne couvrait que la sortie TTS). À décider : moteur STT (API cloud ou local), écoute continue ou mot d'activation, mapping voix → tools existants de `lib/ai/tools.ts`, et permission micro dans Tauri. Note : la décision précédente "pas de micro, réactivité sur la sortie TTS uniquement" concernait le ruban visuel ; le STT ajoute bien une entrée micro, à concilier.
3. **Comprendre les pauses de plusieurs jours.** Quand l'utilisateur dit qu'il prend une pause de X jours (ex. un week-end pour se ressourcer), Soza doit le comprendre et l'intégrer : ne pas relancer/mettre la pression pendant la période, ne pas compter ces jours comme un abandon, et reprendre proprement au retour. Motivation : l'utilisateur a eu l'impression de perdre le fil à un moment. Pistes : nouveau tool IA de type `set_break` (dates début/fin) persisté dans Notion (base Réglages ou Agenda) ; briefings/bilans suspendus sur la période ; message de reprise avec récap de là où il en était. À traiter avec le retrait du streak (une pause ne doit rien "casser").
4. **Widget Soza en barre des tâches, activable à la voix, app fermée.** Prolonge l'étape 5 de l'ordre de réalisation (widget de bureau en fenêtre Tauri secondaire). Ajout : Soza tourne en arrière-plan (icône zone de notification / tray Tauri) et s'active par commande vocale même quand la fenêtre principale est fermée. Dépend des points 2 (STT, écoute en arrière-plan) et 5 (coût en ressources d'une écoute permanente).
5. **Optimisation du dossier et du code (performances).** Objectif : ne pas consommer trop de ressources, surtout avec un widget/écoute résidents. Pistes à vérifier par mesure, pas à l'aveugle : code mort listé dans "Nettoyage pré-existant", dépendances inutilisées, poids du bundle, coût CPU/GPU du système de particules (nombre de particules, `devicePixelRatio`, pause du rendu quand la fenêtre est masquée), taille des dossiers (`node_modules`, `src-tauri/target`, `dist`), empreinte mémoire de l'app Tauri en tray.
6. **Gérer plusieurs projets en même temps.** Lève la limite actuelle : la logique de streak/bilan ne prend en compte qu'un seul projet "En cours" (`getCurrentProject()` dans `lib/notion/idees.ts`). À redéfinir : plusieurs projets "En cours" simultanés, sur quoi porte le bilan du soir, comment le briefing les présente, et comment `record_progress` associe un bilan à un projet. Devient plus simple si le streak est retiré d'abord.
7. **Documentation "comment on crée Soza" pour le portfolio.** Docs de construction du projet (architecture, choix techniques et leurs raisons, bugs rencontrés, évolution du design Blender → particules → app) destinée à être réutilisée plus tard dans le portfolio. À écrire au fil de l'eau plutôt qu'en fin de projet ; peut s'appuyer sur ce fichier et le `README.md`. Emplacement suggéré : `docs/portfolio/`.

**Garde-fou (rappel demandé par l'utilisateur)** : ces 7 chantiers s'ajoutent au dashboard encore sur données factices, au design en cours, à l'intro non branchée et au streak à retirer. Ne pas les dérouler en parallèle : finir d'abord le socle (étape 2 : dashboard branché sur le vrai backend + retrait du streak + nettoyage du code mort), puis les chantiers qui changent le produit de base (points 1, 3, 6), et seulement ensuite la voix, le widget et l'optimisation (points 2, 4, 5). La documentation portfolio (point 7) peut avancer en continu.

### Qualité / robustesse
- Aucun test unitaire isolé (seulement le script d'intégration `full-mechanics-test.ts` contre les vraies APIs).
- Pas de rate-limiting au-delà du filtre `chat_id` (risque faible vu l'usage mono-utilisateur, mais à garder en tête si le bot devient accessible plus largement).
- `scripts/full-mechanics-test.ts` : les blocs Shift créés par le test n'ont pas de marqueur `[TEST]` (le titre est toujours littéralement "Shift") — la portée par plage de dates limite déjà le risque de collision avec un vrai planning, mais rester vigilant si le modèle de test évolue.
