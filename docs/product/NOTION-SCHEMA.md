# Schéma Notion

## Connexion locale

1. Crée une connexion interne `Soza` dans le portail développeur Notion.
2. Crée ou choisis une page parent `Soza`, puis partage-la avec la connexion via `...` → `Add connections`.
3. Mets le token dans `NOTION_TOKEN` et l'identifiant de la page dans `NOTION_PARENT_PAGE_ID` de `.env`.
4. Vérifie l'accès avec `npm run notion:check`, puis crée les bases avec `npm run notion:create`.
5. Recopie les quatre identifiants affichés par le script dans les variables `NOTION_*_DATABASE_ID` de `.env`.

La base Réglages est créée à part par `npm run notion:create-settings` (`scripts/create-settings-database.ts`).

Propriétés lues ou écrites par le code (`lib/notion/*.ts`, état du 12/10/2026) :

| Base | Propriétés |
| --- | --- |
| Agenda | Titre (title), Date (date, avec fin possible), Statut (select : À faire / Fait), Type (select : Perso / Shift), Catégorie (select) |
| Idées | Titre (title), Taille (select : Petit/Moyen/Grand), Statut (select : Brute / En cours / **Terminé** / Archivée), Date d'entrée (date), Notes (rich_text), Catégorie (select) |
| Jalons | Titre (title), Échéance (date), Statut (select : À faire / Validé), Preuve (url), Idée liée (relation vers Idées), Catégorie (select) |
| Progression | Date (title), Bilan (rich_text) |
| Réglages | Nom (title, une seule ligne « Config »), Heure briefing matin, Heure bilan soir, QStash id briefing, QStash id bilan (rich_text) |

- **Statut d'une idée** : `Terminé` = projet fini (outil `complete_project`), `Archivée` = abandonné. Le compteur « Finis » du dashboard ne compte que les `Terminé`.
- **Catégorie** : 15 options, les mêmes noms que les pastilles de logos (`CATEGORIES` dans `lib/types.ts`). Le code la lit et elle prime sur la détection par mots-clés ; `Autre` veut dire « pas de logo ». Les outils `create_idea`, `add_agenda_item` et `create_milestone` l'écrivent. Les 52 idées existantes ont une catégorie ; les entrées d'Agenda et de Jalons créées avant le 12/10/2026 n'en ont pas.
- **Vérifié le 13/10/2026** : `Catégorie` écrite puis relue sur le vrai Notion dans Idées, Agenda et Jalons ; `npm run test:live` a donné 48/48 après l'ajout du statut `Terminé` dans la base Idées (à refaire si la base est recréée). Le script `test:live` ne couvre pas `Catégorie` (test ponctuel).
