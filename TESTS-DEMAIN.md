# Tests à faire — reset quota Gemini

Quota gratuit `gemini-3.6-flash` : 20 requêtes/jour. Chaque test ci-dessous consomme au moins 1 requête (parfois 2 avec `maxSteps`) — grouper les tests plutôt que les lancer un par un dans le désordre, pour ne pas re-épuiser le quota avant d'avoir tout vérifié.

## 1. Fix du client IA (le plus important — jamais confirmé)

- [ ] Envoyer "Ajoute une idée : refaire le rig du perso, taille moyenne" via le webhook.
- [ ] Vérifier la réponse Telegram : doit être dans le ton Ikkaku/Jarvis, **pas** "Action enregistrée." générique.
- [ ] Vérifier dans Notion que l'idée est bien créée, avec `Date d'entrée` renseignée automatiquement.

## 2. Mémoire courte durée + instruction de doute

- [ ] Envoyer une phrase ambiguë : "je devrais reprendre le rig un de ces jours".
- [ ] Vérifier que l'agent pose une question de confirmation, **sans** créer l'idée immédiatement.
- [ ] Répondre "oui" au message suivant.
- [ ] Vérifier que l'agent comprend de quoi il parle (grâce à Redis) et crée bien l'idée cette fois.

## 3. complete_project

- [ ] Dire à l'agent qu'un projet existant est terminé (utiliser le titre exact d'une idée test).
- [ ] Vérifier dans Notion : l'idée passe en Statut "Archivée".
- [ ] Vérifier le jalon lié (si créé après le fix du lien Idée↔Jalon) : Statut "Validé".
- [ ] Si le jalon ne se met pas à jour, vérifier qu'il a bien été créé avec `ideaTitle` renseigné (les jalons créés avant le fix ne sont pas liés).
- [ ] Créer deux idées de test à titres proches (ex. "refaire le rig" et "refaire le rig du perso") et vérifier que `complete_project` cible la bonne.
- [ ] Demander de terminer un projet avec un titre qui ne correspond à aucune idée : vérifier que l'agent dit clairement que le projet est introuvable, sans prétendre l'avoir archivé.

## 4. suggest_projects — cas normal

- [ ] Avoir au moins une idée "Brute" de chaque taille (Grand/Moyen/Petit) dans Notion.
- [ ] Demander "propose-moi des projets à commencer".
- [ ] Vérifier : exactement 3 propositions, une par taille, la plus ancienne de chaque catégorie.

## 5. suggest_projects — cas fallback

- [ ] Vider ou changer temporairement le statut de toutes les idées "Brute" d'une taille (ex: aucune idée "Petit" disponible).
- [ ] Redemander une suggestion.
- [ ] Vérifier : 3 idées les plus anciennes toutes tailles confondues, au lieu d'une répartition par taille.
- [ ] Remettre les données de test comme avant.

## 6. add_agenda_item

- [ ] Demander à l'agent de planifier quelque chose à une date précise.
- [ ] Vérifier l'apparition dans la base Agenda avec la bonne date et le bon mode.

## 7. list_milestones

- [ ] Demander "où j'en suis sur mes jalons ?".
- [ ] Vérifier que la réponse reflète les jalons réels non validés (et qu'un jalon validé n'apparaît pas).
- [ ] Créer un jalon de test avec une échéance dans le passé : vérifier qu'il apparaît bien (jalon en retard), pas filtré silencieusement.

## 8. record_progress (via cron-evening)

- [ ] Déclencher `cron-evening` (ou attendre l'horaire réel).
- [ ] Répondre avec ce qui a été fait dans la journée.
- [ ] Vérifier dans Notion (base Progress) : nouvelle entrée avec le bon streak (incrémenté si preuve fournie, sinon remis à 0) et le bilan texte.

## 9. Briefing du matin généré par IA (cron-morning)

- [ ] Déclencher `cron-morning`.
- [ ] Vérifier que le message est rédigé naturellement (pas juste des lignes "Streak: X / Météo: Y"), dans le ton du persona.
- [ ] Si le bilan de la veille (test 8) mentionne une tâche inachevée, vérifier que l'agent propose explicitement de la reprendre.
- [ ] Vérifier que la météo et les prochains points d'agenda apparaissent bien dans le message.
- [ ] Couper temporairement la clé du provider actif (`GROQ_API_KEY` ou `GEMINI_API_KEY`) et redéclencher `cron-morning` : vérifier que le message de secours brut (streak/météo/agenda en texte simple) part quand même, sans planter le cron. Remettre la clé ensuite.

## Si le quota s'épuise à nouveau avant la fin

Noter où on s'est arrêté dans cette liste plutôt que de tout relancer depuis le début le jour suivant.
