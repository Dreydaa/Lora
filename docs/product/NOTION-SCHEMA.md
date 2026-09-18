# Schéma Notion

## Connexion locale

1. Crée une connexion interne `Soza` dans le portail développeur Notion.
2. Crée ou choisis une page parent `Soza`, puis partage-la avec la connexion via `...` → `Add connections`.
3. Mets le token dans `NOTION_TOKEN` et l'identifiant de la page dans `NOTION_PARENT_PAGE_ID` de `.env`.
4. Vérifie l'accès avec `npm run notion:check`, puis crée les bases avec `npm run notion:create`.
5. Recopie les quatre identifiants affichés par le script dans les variables `NOTION_*_DATABASE_ID` de `.env`.

| Base | Propriétés |
| --- | --- |
| Agenda | Titre (title), Date (date), Statut (select), Mode (select) |
| Idées | Titre (title), Taille (select: Petit/Moyen/Grand), Notes (rich_text) |
| Jalons | Titre (title), Échéance (date), Statut (select), Preuve (url) |
| Progression | Date (title), Streak (number), Bilan (rich_text), Mode (select) |
