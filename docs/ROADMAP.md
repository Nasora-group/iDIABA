# Roadmap — iDIABA commerce universel

## Phase 1 — Socle universel
- Profil d'activité par entreprise et modules configurables.
- Paramètres de devise, fiscalité, identité et établissements.
- Navigation simplifiée et tableau de bord orienté tâches.
- Catalogue générique produits/services, variantes et unités configurables.

## Phase 2 — Opérations quotidiennes
- Caisse rapide, tickets, paiements, retours et clôtures.
- Stocks, achats, réceptions, inventaires et alertes.
- Clients, fournisseurs, crédits et historique.
- Rapports de ventes, marges et trésorerie.

## Phase 3 — Adaptateurs sectoriels
- Alimentation : lots, dates limites et promotions.
- Quincaillerie : unités fractionnaires et conditionnements.
- Mode : tailles, couleurs et variantes.
- Restaurant : menus, recettes et commandes.
- Pharmacie : traçabilité et contraintes réglementaires.
- Automobile : compatibilité et équivalences.
- Services : prestations et devis sans stock obligatoire.

## Phase 4 — SaaS et croissance
- Abonnements, quotas, facturation et paiements mobile money.
- Boutique en ligne, commandes et livraisons.
- Multi-sites, droits par établissement et consolidation.
- Exports comptables et intégrations.

## Règles de livraison
- Audit avant suppression de code ou de table.
- Migrations additives uniquement; sauvegarde avant changement de données.
- PR dédiée par fonctionnalité, lint, typecheck, build et tests SQL.
- Fusion uniquement après contrôles verts.
- Vérifier le déploiement Render et les migrations Supabase séparément.
