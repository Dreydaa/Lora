# Construire Soza — journal de bord

Ce document raconte comment Soza a été conçu et construit : l'architecture, les choix techniques et pourquoi, les bugs rencontrés, et l'évolution du design de l'avatar (Blender → particules → app). Écrit au fil de l'eau plutôt qu'en fin de projet, pour servir de matière première à une présentation portfolio plus tard.

## Le projet

Soza est un assistant personnel piloté par Telegram, pour un unique utilisateur. Son rôle : aider à garder une discipline de travail sur un projet en cours, sans ignorer la fatigue liée à des horaires de travail postés (shifts). Deux tensions à tenir en même temps — exiger de la régularité, mais ne pas mettre la pression pendant les périodes où le corps est épuisé — qui ont structuré une bonne partie des décisions produit décrites plus bas.

Notion sert de source de vérité unique pour toutes les données (idées de projets, agenda, jalons, progression, réglages). Le backend ne fait qu'y lire et écrire ; aucun état métier n'est dupliqué ailleurs.

## Architecture

```
Telegram ──▶ api/telegram-webhook.ts ──▶ QStash (file) ──▶ api/qstash-worker.ts ──▶ Groq (LLM + tools) ──▶ Notion
                    │                                              │
                    ▼                                              ▼
             valide chat_id                                  répond sur Telegram

QStash Schedules ──▶ api/cron-morning.ts / api/cron-evening.ts ──▶ Notion + Telegram

Dashboard Tauri (React) ──▶ api/dashboard.ts ──▶ Notion (lecture agrégée)
```

Le principe directeur, posé dès le départ et rappelé dans `CLAUDE.md` : **le webhook Telegram ne fait jamais de travail long**. Il valide le `chat_id` autorisé et publie immédiatement un job dans QStash ; c'est un worker séparé qui appelle le LLM et écrit dans Notion. Ce découplage évite qu'un appel IA lent (ou un pic de charge) ne fasse timeout ou retry le webhook Telegram lui-même, et rend le système rejouable (QStash retente un job qui échoue).

Deux crons QStash (pas des crons Vercel, voir plus bas) déclenchent le briefing du matin et le bilan du soir aux horaires configurés dynamiquement dans la base Notion **Soza Réglages** — pas en dur dans le code.

## Choix techniques et pourquoi

**QStash plutôt que les crons Vercel natifs.** Le plan gratuit Vercel limite les crons à une exécution par jour avec ±59 minutes d'imprécision — inutilisable pour un briefing censé arriver à une heure précise. QStash Schedules offre une précision correcte et surtout une **API** pour créer/modifier un schedule sans redéploiement : changer l'heure du briefing depuis une conversation Telegram (tool `update_briefing_schedule`) devient possible.

**Notion comme unique source de vérité, y compris pour la config.** Les horaires de la fenêtre pause (mode ACTIF/PAUSE) et des briefings/bilans vivent dans une base Notion **Soza Réglages**, pas dans des variables d'environnement. Ça permet à l'utilisateur de changer son rythme de travail en conversation naturelle ("je change mes horaires la semaine prochaine") sans toucher au déploiement, avec un changement immédiat ou différé à une date donnée.

**Redis pour une mémoire courte, pas pour l'état métier.** Chaque conversation Telegram garde ~10 messages / 6h de contexte dans Redis, assez pour qu'une demande en plusieurs messages reste cohérente, sans réinjecter tout l'historique Notion à chaque appel LLM. L'état métier durable (idées, agenda, progression) reste exclusivement dans Notion.

**Le dashboard Tauri en lecture seule, branché en dernier.** L'application de bureau (React + Vite dans Tauri) a d'abord tourné entièrement sur des données factices (`mockData.ts`) le temps que le backend Telegram/Notion soit stabilisé en production. Le branchement sur les vraies données (`api/dashboard.ts`) n'est arrivé qu'une fois le reste éprouvé — délibérément, pour ne pas construire une UI contre une base mouvante.

**Un seul provider LLM (Groq).** Le projet a démarré avec deux providers (Gemini + Groq) sélectionnables par variable d'env, pour se prémunir d'un quota. Gemini a ensuite été retiré entièrement une fois l'usage réel de Groq validé en production — code de branchement par provider, dépendance et variable d'env supprimés plutôt que laissés en jachère "au cas où".

## Bugs rencontrés (et ce qu'ils ont appris)

**QStash livrait vers une URL protégée.** Les jobs QStash étaient adressés à `VERCEL_URL`, une URL par déploiement protégée par défaut par Vercel Deployment Protection — les requêtes échouaient en 401 silencieux (QStash retentait, sans jamais aboutir). Correction : une URL fixe (`APP_URL`) pointant sur l'alias de production. Le même piège a failli se reproduire avec le premier essai de test des déploiements Preview de ce projet (protégés eux aussi, injoignables depuis l'extérieur) — signe que la protection par défaut de Vercel est facile à oublier tant qu'on ne teste pas un vrai appel externe.

**Décalage horaire silencieux en production.** Vercel exécute les fonctions en UTC. Utiliser `date.getHours()` ou `new Date().toISOString()` pour dériver l'heure ou la date "du jour" donnait l'heure UTC, pas l'heure de Paris — la fenêtre pause se déclenchait avec 1 à 2h de décalage selon la saison (heure d'été/hiver) par rapport à la config voulue. Corrigé en centralisant la conversion de fuseau via `Intl` (`lib/date.ts`) plutôt que de laisser chaque appelant faire son propre calcul d'heure.

**Un `null` explicite fait échouer une validation Zod silencieusement.** Groq peut renvoyer `null` pour un paramètre optionnel de tool call au lieu de l'omettre. Avec `.optional()` (qui n'accepte que "absent" ou `undefined`), la validation Zod du tool call entier échouait — et donc l'action demandée par l'utilisateur, sans message d'erreur visible côté conversation. Remplacé par `.nullish()` sur les six paramètres concernés. Une bonne illustration qu'une validation de schéma trop stricte sur l'input d'un LLM peut faire échouer une action de façon invisible, plutôt que de la rejeter proprement.

**Des secrets corrompus par un espace de tête.** La plupart des valeurs `.env` du projet étaient écrites `CLE= valeur` (espace après le `=`), un détail qui passe inaperçu en local mais corrompt le secret une fois repoussé tel quel vers la config Vercel. Corrigé en retirant l'espace et en repoussant proprement — un rappel que la copie de secrets entre environnements mérite une vérification explicite, pas une confiance aveugle dans le copier-coller.

**Un flux RSS qui dupliquait son propre titre.** Le flux TechCrunch répétait le titre du `<channel>` à l'intérieur d'un bloc `<image>`, ce qui faussait un découpage positionnel naïf des balises `<title>` du document. Corrigé en isolant explicitement chaque titre à l'intérieur de ses balises `<item>` plutôt que de parcourir tous les `<title>` du flux sans distinction.

## Décisions produit et leur raison

**Mode ACTIF/PAUSE dynamique plutôt que codé en dur.** Le rythme de travail posté (shifts) change dans le temps ; figer les horaires dans le code aurait demandé un redéploiement à chaque changement de planning. La config vit dans Notion et se pilote en conversation naturelle.

**Proof of Work mis de côté.** L'idée initiale demandait une preuve tangible (lien, capture, export `.glb`, lecture d'un commit GitHub) pour valider une journée de progression. Mise de côté après discussion — jugée trop lourde à l'usage réel — au profit d'un contrôle de cohérence conversationnel, puis retirée avec le reste du système de streak (voir plus bas). Réévaluable en v2 une fois l'usage réel plus mûr.

**Mécanique de streak retirée entièrement (30/09/2026).** Un compteur de jours consécutifs, gagné sous trois conditions (bilan avant minuit, bon projet, cohérence avec les jours précédents), existait pour matérialiser la régularité. Décision de le retirer *complètement* plutôt que juste son affichage : la mécanique de gating qu'il justifiait (contrôle d'horaire, vérification de cohérence avant chaque bilan) a été retirée avec lui plutôt que laissée orpheline. `record_progress` est redevenu un simple enregistrement du bilan du jour. Le champ Notion correspondant a été supprimé de la base de production (pas seulement ignoré côté code) — un choix délibéré de ne pas laisser une colonne morte dans la source de vérité.

**Une limite assumée : un seul projet "En cours" à la fois.** Le contrôle de cohérence du bilan du soir (et avant lui, le streak) ne gérait qu'un seul projet actif simultanément. Limite acceptée en échange de la simplicité du contrôle, documentée comme telle plutôt que contournée en silence — à lever plus tard si le besoin de mener plusieurs projets en parallèle se confirme.

## Évolution du design de l'avatar : Blender → particules → app

L'avatar visuel de Soza (actuellement un ruban de Möbius) suit un chemin de prototypage à dessein indirect :

1. **Blender** sert à concevoir et documenter la forme — c'est un outil de prototypage et de portfolio, pas la source de l'asset final. Une scène Blender ne peut pas s'embarquer telle quelle comme fond de widget dans une app Tauri.
2. Le rendu final est un système de particules en **three.js**, recalculé au repos par une équation paramétrique du ruban de Möbius plutôt que rejoué depuis un export Blender — plus léger, et permettant de faire varier la densité et le mouvement en temps réel.
3. **Pas de vidéo pour l'intro.** Un seul système de particules anime toute la séquence : chaque particule a une position de départ (une trajectoire calquée sur la vue caméra Blender) et une position cible sur le ruban, interpolées par un paramètre de progression continu. Une fois la transformation achevée, le hub du dashboard *est* ce même système au repos — l'intro n'est que son état initial, sans raccord vidéo→canvas.
4. Le calcul du ruban (génération des points, position au repos avec rotation/inclinaison/flottement) a été extrait dans un module partagé (`src/features/particles/ribbon.ts`) une fois qu'un second cas d'usage (le hub statique du dashboard, indépendant de l'intro) en a eu besoin — pas anticipé avant d'être réellement nécessaire.
5. La réactivité prévue (le ruban qui bouge avec la voix de Soza) est pensée pour écouter la **sortie TTS**, pas le micro de l'utilisateur — un `AnalyserNode` Web Audio sur le buffer audio généré, sans permission micro à gérer. Ce choix précède l'existence même du TTS dans la stack ; il attend que le pipeline vocal soit construit.

Le design visuel du dashboard, lui, a fait l'aller-retour inverse : une première refonte éditoriale complète (palette, polices, popovers, kanban, jauges SVG) a été entièrement retirée à la demande de l'utilisateur pour repartir d'une maquette Figma dessinée de zéro — le dashboard tourne aujourd'hui sur un rendu HTML brut, volontairement minimal, en attendant cette livraison.

## Où trouver la suite

Ce journal documente les choix déjà faits. L'état d'avancement détaillé (ce qui reste à faire, dans quel ordre, et pourquoi) vit dans [`docs/ai/STATUS.md`](../ai/STATUS.md) — il change plus vite que ce document et fait foi sur l'avancement réel.
