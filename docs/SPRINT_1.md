# Sprint 1 — Authentification, espaces et accès

## Inclus
- Connexion et inscription via Supabase Auth.
- Création d'un espace entreprise (workspace) et attribution automatique du rôle owner.
- Profil utilisateur alimenté à la création du compte.
- Rôles initiaux : owner, admin, manager, cashier, stock, accountant, viewer.
- Middleware de rafraîchissement de session et protection de /app.
- RLS activée sur profils, entreprises et memberships.
- Fonctions SQL de contrôle d'appartenance/permissions et création d'espace.
- Variables d'environnement documentées dans .env.example.

## Mise en place Supabase
1. Créer un projet Supabase.
2. Exécuter le SQL de `supabase/migrations/0001_saas_auth_tenants.sql` dans SQL Editor ou appliquer les migrations via Supabase CLI.
3. Copier URL du projet et clé anon/public dans .env.local.
4. Dans Auth > URL Configuration, configurer l'URL du site et les redirect URLs locales et production.
5. Installer les dépendances : `npm install`; lancer `npm run dev`.

## Sécurité / limites
- Les tables applicatives doivent utiliser tenant_id et RLS dans les prochains sprints.
- Le RPC create_tenant vérifie l'utilisateur connecté et crée le membership owner dans la même transaction.
- Les invitations et changement de rôle nécessiteront un flux serveur vérifié et audit.
- Le formulaire d'inscription dépend du paramètre Supabase de confirmation e-mail. Si confirmation activée, l'entreprise sera créée après connexion (à traiter dans le flux de confirmation/complétion du profil lors d'une prochaine étape).
- Aucun secret service-role ne doit être utilisé côté navigateur ni versionné.
