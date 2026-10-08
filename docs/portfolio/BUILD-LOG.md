# Soza — étude de cas et journal de construction

Soza est un assistant personnel piloté par Telegram, doublé d'une application de bureau, construit de zéro en trois semaines (16 septembre → 8 octobre 2026). Ce document raconte **comment** : l'architecture, les choix et leurs compromis, les bugs et leurs causes racines, ce qui a été essayé puis abandonné, et la méthode de travail.

Il se lit à trois niveaux :

| Si vous avez… | Lisez |
| --- | --- |
| 2 minutes (recruteur, manager) | [En bref](#en-bref), [Compétences démontrées](#compétences-démontrées) |
| 10 minutes (développeur junior ou curieux) | [Architecture](#architecture), [Le cœur IA](#le-cœur-ia--tool-calling-et-prompts), [Bugs et causes racines](#bugs-et-causes-racines), [Ce qu'un junior peut en tirer](#ce-quun-développeur-junior-peut-en-tirer) |
| Le temps d'un vrai relecteur (senior) | tout, en particulier [Décisions et compromis](#décisions-et-compromis), [Qualité, tests, sécurité](#qualité-tests-sécurité) et [Limites assumées](#limites-assumées) |

L'état d'avancement détaillé et daté vit dans [`docs/ai/STATUS.md`](../ai/STATUS.md), qui change plus vite que ce document et fait foi. La suite prévue est décrite dans [`docs/ai/SozaV2.md`](../ai/SozaV2.md).

---

## En bref

**Le problème.** Tenir une discipline de travail sur un projet personnel, malgré des horaires de travail postés (shifts) qui fatiguent. Deux exigences opposées à concilier : demander de la régularité sans mettre la pression quand le corps est épuisé.

**La réponse.** Un assistant qui vit là où l'utilisateur est déjà (Telegram) :
- il comprend le langage naturel (« ajoute un rendez-vous jeudi à 14 h », « je prends mon week-end ») et agit dans Notion via des outils IA ;
- il envoie un **briefing le matin** (météo, agenda, bilan de la veille) et demande un **bilan le soir**, à des horaires modifiables en conversation ;
- une **application de bureau** (Tauri + React) affiche tout cela dans un tableau de bord en « verre liquide » devant un ruban de Möbius en particules animé en temps réel.

**Statut.** Backend en production et utilisé au quotidien. L'application de bureau a un installeur Windows, mesure le temps d'écran réel et ouvre sur l'intro en particules puis le dashboard en verre ; 286 tests couvrent le projet. Reste à valider l'app installée dans la durée (démarrage automatique, zone de notification, fluidité). Une V2 (assistant vocal local, protocoles, gestes) est cadrée mais volontairement pas commencée.

**Un cadrage qui a évolué.** Soza est née comme un coach de discipline à deux personnalités (une exigeante, une protectrice, selon les horaires de travail). Le 07/10, l'utilisateur tenant sa cadence de travail, ce cadrage a été abandonné : une seule personnalité (« Friday »), plus de mode ACTIF/PAUSE, le produit se rapprochant d'un assistant du type Jarvis/FRIDAY. Le retrait a touché le backend (modes, prompts, outils, accès Notion, briefing, API du dashboard), les scripts et le front.

### Chiffres clés

| | |
| --- | --- |
| Durée | 3 semaines (premier commit le 16/09/2026, dernier le 08/10/2026) |
| Historique | 61 commits |
| Code suivi par git | ~4 950 lignes de TypeScript/CSS/Rust : `api/` 173, `lib/` 1 153, `src/` 3 049, `scripts/` 440, Rust 151 ; plus 2 169 lignes de tests |
| Tests | 286 : 263 rapides (unitaires, intégration, régression — rejoués le 08/10, ~1 s), 20 scénarios dans un vrai navigateur, 3 en Rust |
| Endpoints serverless | 5 (webhook Telegram, worker, cron matin, cron soir, dashboard) |
| Outils IA exposés au modèle | 13 |
| Bases Notion | 5 (Idées, Agenda, Jalons, Progression, Réglages) |
| Fournisseur LLM | 1 (Groq) — un second a été essayé puis retiré |
| Dépendances d'exécution | 13 (5 inutilisées retirées le 08/10), dont `three`, `zod`, `ai` (Vercel AI SDK), `@upstash/*`, `@notionhq/client` |

Chiffres tirés de `git log` et du dépôt au 08/10/2026. Les 286 tests (263 rapides, 20 scénarios navigateur, 3 en Rust) ont été rejoués le 08/10/2026 pour ce document.

### Compétences démontrées

- **Architecture serverless asynchrone** : file de jobs, webhooks, crons pilotables par API, reprise sur échec.
- **Intégration de LLM en production** : appel d'outils (tool calling) avec validation de schéma, conception de prompts, gestion des intentions ambiguës, mémoire de conversation, repli quand le modèle est indisponible.
- **Fiabilité** : fuseaux horaires, dérives de configuration entre environnements, bugs silencieux, repli quand un backend est plus ancien que l'app.
- **Qualité logicielle** : 286 tests en quatre familles (unitaire, intégration, régression par famille de bugs, acceptation dans un vrai navigateur) plus Rust ; tests qui n'utilisent jamais de vrais services ; un test de régression vérifié en réintroduisant le bug.
- **Rust et application de bureau** : thread de suivi du temps d'écran, zone de notification, démarrage automatique, installeur, réduction de 33 % de l'exécutable.
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
| à partir de 30/09 | **V2 cadrée** | Assistant vocal local, protocoles, puis (06/10) gestes de la main : documenté, pas démarré. Le premier chantier (personnalité unique) a été fait le 07/10, en fin de V1. |

---

## Architecture

```
Telegram ──▶ api/telegram-webhook.ts ──▶ QStash (file) ──▶ api/qstash-worker.ts ──▶ Groq (LLM + 13 outils) ──▶ Notion
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
api/        5 endpoints serverless (edge) : webhook, worker, crons, dashboard
lib/        cœur métier : IA (client, outils, prompts), accès Notion, intégrations, mémoire Redis, dates, briefing
src/        application de bureau : features/ (dashboard, calendar, widgets, glass, intro, particles, hub…)
src-tauri/  application de bureau en Rust (151 lignes) : héberge la vue web, mesure le temps d'écran, zone de notification, démarrage automatique
tests/      unit, integration, regression, acceptance + faux Notion, faux Redis et réseau bloqué
scripts/    configuration et migration Notion/QStash, test contre les vraies APIs
docs/       état du projet, contexte IA, schéma Notion, V2, ce journal
```

---

## Le cœur IA : tool calling et prompts

Le modèle ne « répond » pas seulement : il agit, via 13 outils (créer une idée, planifier un rendez-vous, enregistrer un bilan, changer l'heure du briefing, mettre en pause…), chacun défini par un schéma Zod. Quelques choix qui comptent :

**Une phrase peut déclencher plusieurs actions.** Jusqu'à 4 étapes d'outils par message (« crée cette idée et planifie un point jeudi »).

**Le doute vaut mieux que l'action.** Une consigne dédiée interdit de créer une idée ou un jalon sur une intention ambiguë : le modèle pose d'abord une question courte. Validé en conditions réelles.

**Une seule personnalité.** Deux prompts de personnage (l'un exigeant, l'autre protecteur, choisis selon l'heure) ont été fusionnés en un seul, `friday.ts`, rédigé par l'utilisateur : le prompt dit à Soza que « Soza » est son nom, qu'elle parle à la première personne, et fixe son registre. Moins de code : le choix du personnage et la détection du mode ont disparu.

**Le modèle décide des détails qu'il peut décider.** La taille d'un projet (Petit / Moyen / Grand) est estimée par le modèle selon une grille donnée dans la description de l'outil, au lieu d'être demandée à l'utilisateur. À l'inverse, il lui est interdit d'inventer le contenu d'une note.

**Les entrées d'un LLM ne respectent pas votre schéma.** Groq renvoie parfois `null` pour un paramètre optionnel au lieu de l'omettre ; avec `.optional()`, toute la validation échouait et l'action se perdait sans message. Passage à `.nullish()` sur les six paramètres concernés.

**Un modèle ne connaît pas la date du jour.** En ajoutant les pauses, on s'est rendu compte que le prompt de conversation ne contenait aucune date : « ce week-end » ou « demain » ne pouvaient pas être convertis en dates réelles pour les outils. La date du jour (fuseau de Paris) est désormais injectée.

**Le briefing : faits en code, rédaction par le modèle.** Voir l'étude de cas dans [Bugs et causes racines](#bugs-et-causes-racines). Si le modèle est indisponible (quota, panne), un briefing basique est envoyé plutôt que de faire échouer le cron.

**Le briefing du soir, avec ses garde-fous (08/10).** Le soir aussi, Soza rédige : la journée (tâches faites sur le total), le prochain jalon, l'agenda des 7 jours, puis la question du bilan. Les faits sont calculés dans le code, et le prompt interdit d'inventer du travail ou de conclure qu'une journée est improductive parce que l'agenda est vide. Si le texte ne contient pas le mot « bilan », une question de bilan est ajoutée, car le briefing du matin en dépend ; si le modèle est indisponible, la phrase fixe d'origine part quand même. Une version courte (deux à trois phrases) est gardée pour le dashboard.

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
| **Des tests sans aucun vrai service** | Tester contre les vrais Notion, Redis, Groq | Rapides (moins d'une seconde pour 263 tests), reproductibles, sans risque pour les vraies données ; tout appel réseau non prévu fait échouer le test | Un seul test (`test:live`), lancé à la main, valide les vraies APIs |

### Ce qui a été retiré, et pourquoi

Savoir retirer est autant une compétence que savoir ajouter. Chaque retrait est daté et motivé dans `STATUS.md`.

- **Le « Proof of Work »** (preuve tangible d'une journée : lien, capture, export 3D, commit) : jugé trop lourd à l'usage, remplacé par un contrôle de cohérence conversationnel, puis supprimé.
- **Le streak (compteur de jours consécutifs)** : retiré *en entier*, pas seulement son affichage. La machinerie qui le justifiait (contrôle d'horaire, vérification de cohérence) est partie avec, `record_progress` redevenant un simple enregistrement, et la colonne a été supprimée de la base Notion de production plutôt que laissée morte.
- **Le mode ACTIF/PAUSE et les deux personnalités (07/10/2026)** : un mode qui basculait le ton du modèle selon les horaires de travail. Retiré en entier : le module de détection, le type, le champ dans Notion et dans l'API, l'outil qui le pilotait, les composants du dashboard. L'utilisateur tenait sa cadence de travail : le mécanisme n'avait plus d'utilité pour lui, et un mécanisme inutilisé reste du code à maintenir et à tester.
- **Les réglages de shift (08/10/2026)** : le code, la réponse de l'API, le type du dashboard et les colonnes Notion correspondantes. Les colonnes ont été supprimées par un script de migration qui **simule d'abord** (aucune écriture), affiche ce qu'il ferait, puis s'applique avec `--apply` et relit les schémas ; il est idempotent. Supprimer une colonne efface ses valeurs sans retour possible, et le code avait été nettoyé *avant* qu'il soit écrit, pour que l'ordre avec le déploiement n'ait pas d'importance.
- **L'ancien dashboard plat et son code mort (07/10/2026)** : 20 fichiers, repérés par une cartographie des imports à partir du point d'entrée plutôt que « à l'œil ». Et 5 dépendances inutilisées le 08/10, le build du front restant identique à l'octet près.
- **La dégradation visuelle de l'interface après un jalon manqué** : envisagée, puis abandonnée le 08/10, hors V1 comme hors V2. Une décision explicite vaut mieux qu'une idée qui traîne dans la liste des « à faire ».
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
286 tests en quatre familles plus du Rust, ajoutés le 08/10, en fin de V1 :

| Famille | Ce qu'elle couvre | Rapidité |
| --- | --- | --- |
| **Unitaires** | dates, lignes du briefing (bilan, agenda, journée, jalon), flux RSS, validation et accès, logos par mots-clés, classement du temps d'écran, calendrier, mémoire Redis | instantané |
| **Intégration** | webhook Telegram (secret, `chat_id`, publication dans la file), worker (signature, réponse), crons du matin et du soir, `/api/dashboard` : le vrai code tourne de bout en bout, seuls Notion, Redis, Telegram, Groq et le réseau sont simulés | instantané |
| **Régression** | un fichier par **famille de bugs déjà corrigés** : paramètres `null` de Groq, fuseau horaire, bilan périmé et rappels d'agenda, URL de livraison QStash, garde-fous fermés par défaut, requêtes Notion, champs retirés du payload, plafonds de requêtes des crons | instantané |
| **Acceptation** | 20 scénarios utilisateur dans un vrai navigateur (Playwright) : dashboard complet, briefings, détail Écran, bascule Écran ↔ Jalons, liens, calendrier, backend en panne ou clé refusée, intro | ~2 min |
| **Rust** | 3 tests | — |

Principes qui valent d'être retenus :
- **Aucun test n'utilise le `.env` ni un vrai service** : variables factices, et tout appel réseau non prévu fait échouer le test. Un seul script, lancé à la main, appelle les vraies APIs (`test:live`, la suite historique, 37 vérifications au 30/09, qui avait elle-même remplacé dix scripts ad hoc).
- **Un test de régression se vérifie en réintroduisant le bug** : l'un des tests d'acceptation a été validé en remettant l'ancien code, sur lequel il échoue bien. Un test qui ne peut pas échouer ne protège de rien.
- **Les bugs sont rangés par famille**, pas par date : chaque bug du chapitre précédent a son garde-fou.
- Les 263 tests rapides tournent en moins d'une seconde ; la vérification de types stricte (`tsc --noEmit`) accompagne chaque étape.

### Sécurité
- **Trois barrières successives sur le webhook Telegram** : la méthode doit être POST, un secret partagé doit figurer dans l'en-tête (`x-telegram-bot-api-secret-token`), puis le `chat_id` doit être celui de l'utilisateur autorisé. Un message d'un autre utilisateur reçoit une réponse « ignoré » sans aucune action ni erreur révélatrice. Le corps de la requête est aussi validé par un schéma Zod avant d'être utilisé.
- Les crons exigent une signature QStash valide, ou un secret en `Bearer` pour un déclenchement manuel.
- L'endpoint du dashboard est protégé par une clé. **Compromis assumé** : cette clé est embarquée dans le build de l'application, ce qui est acceptable en usage mono-utilisateur mais ne le serait pas pour un produit public.
- **Application de bureau** : politique de sécurité de contenu (CSP) stricte en production, limitée à l'application, à l'API de production, au service météo et à la communication interne de Tauri ; un appel vers un autre site est bloqué (vérifié). L'ouverture de liens est une permission explicite, limitée à `https://`.

### Observabilité
Les appels d'outils sont journalisés avec leurs paramètres ; la suite d'intégration vérifie le comportement bout en bout.

---

## Limites assumées

Les relecteurs expérimentés y regarderont en premier ; autant les dire.

- **Des zones non testées automatiquement** : le suivi réel de la fenêtre active (il dépend du système d'exploitation), le rendu visuel du verre et des particules (WebGL logiciel), le menu de la zone de notification et le démarrage automatique (visibles seulement dans l'app installée).
- **Le texte produit par le modèle n'est pas testé automatiquement** : seul le contexte qui lui est envoyé l'est. La qualité de rédaction se juge à l'usage.
- **Pas de limitation de débit** au-delà du filtre `chat_id` : risque faible en usage à un utilisateur, à traiter si le bot devient accessible à d'autres.
- **Un seul projet « En cours » à la fois** : limite choisie pour la simplicité, documentée plutôt que contournée.
- **Dépendance à des services tiers gratuits** (Vercel, QStash, Upstash, Notion, Groq) avec leurs quotas.
- **Détection des icônes par mots-clés** : fragile par construction. La colonne « Catégorie » existe dans Notion mais le code ne la lit pas encore.
- **L'installeur existe mais n'a été ni lancé ni installé** : démarrage automatique, zone de notification et suivi du temps d'écran restent à valider dans l'app installée, et la fluidité (4 500 particules et 9 verres à réfraction) n'est pas mesurée sur la durée, en particulier le CPU quand la fenêtre est masquée.
- **Le suivi du temps d'écran ne mesure que Windows et que l'application Tauri** (dans un navigateur le bloc affiche « — »), et seulement tant que Soza tourne.

---

## Méthode de travail

**La documentation comme source de vérité, tenue à jour pendant le travail.** `STATUS.md` consigne ce qui est fait, ce qui reste, et surtout **pourquoi** chaque décision a été prise, avec la date. Chaque entrée distingue ce qui a été **vérifié** de ce qui **ne l'est pas**. C'est ce qui permet de reprendre le projet à froid, y compris pour un assistant IA.

**Un garde-fou contre la dispersion.** Le projet s'est donné une règle écrite : ne pas commencer une idée de la V2 avant d'avoir fini la V1. Elle est inscrite en tête de `SozaV2.md` et rappelée à chaque nouvelle ambition. Les idées sont notées, discutées, cadrées, mais pas implémentées tant que le socle n'est pas fini.

**Des décisions prises en discussion, puis écrites.** Les choix structurants (retrait du streak, retrait du mode ACTIF/PAUSE au profit d'une personnalité unique, moteur de détection du mot d'activation) sont discutés avec leurs alternatives, tranchés, puis consignés avec leur raison.

**Développement assisté par IA.** Le projet a été mené avec un assistant de code IA (Claude Code), guidé par des fichiers de contexte versionnés dans le dépôt (`CLAUDE.md`, `docs/ai/`). Les règles de sécurité (validation du `chat_id`, aucune tâche longue dans le webhook) y sont écrites noir sur blanc. Le dépôt montre aussi les limites de ce mode de travail : un correctif « fini » mais jamais déployé (voir bug 8), un modèle auquel on avait oublié de donner la date du jour (voir plus haut).

**Les pièges de l'outillage.** Un `\n` dans une chaîne TypeScript écrite par un script collé dans le shell devenait un vrai saut de ligne (arrivé deux fois, dans deux fichiers) : désormais, `tsc --noEmit` après tout script de ce genre. Autre piège de dev noté : `tauri dev` relance le serveur de développement sur un port fixe, et un serveur déjà ouvert fait échouer le démarrage.

**Ce que l'historique montre.** 8 commits en un jour pour trouver un fond « à l'œil », contre un résultat mesuré (0,978 de corrélation) quand une référence a été fournie. Itérer contre une référence converge ; itérer contre une impression, beaucoup moins.

---

## Vision V2 (résumé)

La V2 rapproche Soza d'un assistant du type Jarvis/FRIDAY : une seule personnalité, des fonctionnalités qui servent l'utilisateur plutôt qu'un rôle de coach. Le premier pas, la personnalité unique et le retrait du mode ACTIF/PAUSE, a été fait dès le 07/10, en fin de V1. Le détail est dans [`SozaV2.md`](../ai/SozaV2.md). Les décisions d'architecture déjà prises, avant la moindre ligne de code :

- **Hybride local/cloud, pas une IA locale complète.** Détection du mot d'activation et exécution d'actions sur la machine en local (accès OS obligatoire) ; raisonnement dans le cloud ; commandes simples reconnues en local pour la rapidité et le fonctionnement hors ligne.
- **Principe « local plutôt que cloud »** : Notion reste la source de vérité pour ce qui doit être accessible à distance, le reste (réglages, défauts) vit sur la machine.
- **Les fondations de l'agent local existent déjà**, posées en V1 par le suivi du temps d'écran : un thread Rust résident, une icône de zone de notification, le démarrage avec Windows et un installeur. La V2 s'y greffe.
- **Deux canaux d'entrée distincts** : la voix en local, Telegram à distance. Un protocole qui démarre un PC éteint ne peut pas passer par la voix locale, puisque le micro est éteint avec la machine.
- **Détection stricte des commandes à effet réel**, sur le modèle de l'ancienne commande `/mode` (supprimée avec le mode ACTIF/PAUSE, à réintroduire), pour qu'une phrase qui *parle* d'un protocole ne le déclenche jamais.
- **Gestes de la main par caméra**, avec un détecteur de mains dont le rendu de contrôle est le prérequis de tout geste, un geste d'engagement contre les déclenchements accidentels, et un traitement 100 % local.
- **Sécurité traitée avant la fonctionnalité** : exécuter des actions sur une machine réelle depuis une commande à distance est sensible, le modèle de menace est posé en premier.

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

Pour le lancer : voir le [`README.md`](../../README.md) (variables d'environnement, commandes `npm run dev`, `npm run tauri dev`, `npm test`, scripts de configuration Notion et QStash).

**Trois habitudes à reprendre de ce projet** : écrire pourquoi on retire quelque chose en même temps qu'on le retire ; séparer « calculé » de « rédigé » quand on utilise un LLM ; ne jamais déclarer terminé ce qui n'a pas été observé là où il tourne vraiment.
