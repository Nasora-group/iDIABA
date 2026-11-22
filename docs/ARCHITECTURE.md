# Architecture iDIABA — plateforme universelle

## Socle technique conservé
- Next.js App Router + TypeScript.
- Supabase Auth et PostgreSQL avec Row Level Security.
- Render pour l'hébergement applicatif.
- PWA / IndexedDB pour les opérations hors connexion compatibles.
- API et traitements serveur comme frontière d'autorisation.

## Multi-tenant
Chaque donnée métier est rattachée à un tenant. Les rôles sont attribués par entreprise et, si nécessaire, par établissement. Les politiques RLS limitent chaque lecture/écriture au tenant autorisé. Les contrôles de permission doivent aussi être faits côté serveur; masquer un bouton n'est jamais une protection.

## Architecture fonctionnelle
1. Noyau commun : identité entreprise, membres, rôles, établissements, paramètres pays/devise.
2. Commerce : catalogue, unités, variantes, tarifs, clients et fournisseurs.
3. Opérations : ventes, caisse, achats, réceptions, mouvements et inventaires.
4. Finance : dépenses, trésorerie, comptabilité et rapports.
5. Extensions sectorielles : lots/péremption, recettes, numéros de série, compatibilités, prestations.
6. Plateforme SaaS : abonnements, quotas, support, audit et supervision.

## Configuration sectorielle
La table `tenant_business_profiles` stocke le secteur et les modules activés. Le modèle de données reste commun. Les extensions spécialisées utilisent des tables liées au tenant et des migrations additives; aucune colonne polymorphe non contrôlée ni table métier sans RLS.

## Règles d'intégrité
- Montants en NUMERIC ou entiers de sous-unités, jamais en float.
- Une vente validée n'est pas modifiée directement : retour, annulation ou écriture corrective.
- Le stock est calculé à partir d'un journal de mouvements append-only.
- Chaque opération hors connexion possède une clé d'idempotence.
- Les données historiques et les comptes ne sont pas supprimés pour simplifier l'interface.
- Toute évolution du schéma est additive, avec RLS, index, contraintes et tests.
