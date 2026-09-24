# État Soza

Dernière mise à jour : session du 24/09/2026. Soza est déployé et fonctionnel en production.

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

### Actualités
- Remplacé l'unique flux généraliste par deux flux mondiaux réels : Tech (TechCrunch) et Mode (Vogue). Parsing réécrit pour cibler les titres à l'intérieur des balises `<item>` (un flux dupliquait son titre dans un bloc `<image>`, faussant l'ancien découpage positionnel).

### Nettoyage
- 10 scripts de test ad hoc à la racine supprimés, remplacés par `scripts/full-mechanics-test.ts` (batterie complète réutilisable, 37 vérifications contre les vraies APIs, nettoyage automatique de ses propres données de test).
- `docs/ai/STATUS.md` et `HANDOFF.md` (obsolètes) supprimés puis ce fichier recréé à jour ; `docs/ai/CONTEXT.md` conservé.
- Les 4 bases Notion (Idées, Agenda, Milestones, Progress) ont été vidées pour repartir sur une base propre, plus quelques pages résiduelles vides retrouvées et nettoyées en cours de session.

## Reste à faire

### Dashboard Tauri
- Toujours déconnecté de tout backend réel (données factices). Aucun écran pour la config Réglages (mode/horaires) — actuellement pilotable uniquement par conversation Telegram.
- Le stockage (Notion) est déjà prêt à être lu/écrit par un futur écran de réglages, sans changement backend nécessaire.

### Fonctionnalités produit
- Soumission et validation de Proof of Work (lien, capture, analyse vision) — non implémenté.
- Dégradation visuelle de l'UI après un jalon manqué — non implémentée.

### Qualité / robustesse
- Aucun test unitaire isolé (seulement le script d'intégration `full-mechanics-test.ts` contre les vraies APIs).
- Pas de rate-limiting au-delà du filtre `chat_id` (risque faible vu l'usage mono-utilisateur, mais à garder en tête si le bot devient accessible plus largement).
- `scripts/full-mechanics-test.ts` : les blocs Shift créés par le test n'ont pas de marqueur `[TEST]` (le titre est toujours littéralement "Shift") — la portée par plage de dates limite déjà le risque de collision avec un vrai planning, mais rester vigilant si le modèle de test évolue.
