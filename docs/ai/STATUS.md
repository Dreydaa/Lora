# État Soza

Le socle TypeScript, Vercel, React et Tauri est créé. Le build web passe avec `npm run build`.

## Reste à faire

### Configuration indispensable

- [ ] Copier `.env.example` vers `.env` et renseigner les secrets, sans jamais les commiter.
- [ ] Créer une page Notion partagée avec l'intégration Soza, puis renseigner `NOTION_PARENT_PAGE_ID`.
- [ ] Exécuter `npm run notion:create`, récupérer les quatre identifiants retournés et compléter les variables `NOTION_*_DATABASE_ID`.
- [ ] Créer le bot avec BotFather et définir `TELEGRAM_BOT_TOKEN` et `TELEGRAM_ALLOWED_CHAT_ID`.
- [ ] Générer un `TELEGRAM_WEBHOOK_SECRET` aléatoire et le conserver dans Vercel et Telegram.
- [ ] Créer le compte QStash, puis renseigner le token et les deux clés de signature.
- [ ] Créer une clé Gemini et définir `GEMINI_API_KEY`; `GEMINI_MODEL` est par défaut `gemini-2.5-flash`.

### Tests locaux

- [ ] Lancer le dashboard avec `npm run dev` puis vérifier http://localhost:1420.
- [ ] Installer Rust si nécessaire, puis lancer la fenêtre native avec `npm run tauri dev`.
- [ ] Installer/configurer Vercel CLI et lancer `npx vercel dev` pour tester les routes API localement.
- [ ] Tester le webhook Telegram avec un seul `chat_id` autorisé et confirmer qu'un autre identifiant est ignoré.
- [ ] Vérifier un cycle complet: Telegram -> QStash -> IA -> Notion -> réponse Telegram.

### Avant déploiement

- [ ] Déployer sur Vercel et ajouter toutes les variables d'environnement de production.
- [ ] Enregistrer l'URL Vercel comme webhook Telegram avec le secret correspondant.
- [ ] Définir `APP_URL` ou laisser Vercel fournir `VERCEL_URL` pour QStash.
- [ ] Configurer `CRON_SECRET` et vérifier les deux crons du matin et du soir.
- [ ] Ajouter une vraie icône PNG dans `src-tauri/icons/` avant de créer un installeur Windows.
- [ ] Corriger les vulnérabilités signalées par `npm audit` après examen des mises à jour proposées.

### MVP encore à enrichir

- [ ] Brancher le dashboard sur une API de lecture Notion; il affiche actuellement un état local minimal.
- [ ] Finaliser les outils IA et leurs confirmations utilisateur pour les actions sensibles.
- [ ] Ajouter la soumission et la validation de Proof of Work (lien, capture, analyse vision).
- [ ] Ajouter l'état de dégradation visuelle après un jalon manqué.
- [ ] Ajouter des tests unitaires pour la validation, les modes et le pipeline webhook.
