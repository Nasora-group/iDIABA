# Vision produit iDIABA — commerce universel

iDIABA est une plateforme SaaS de gestion commerciale destinée aux commerces indépendants, boutiques, magasins spécialisés, restaurants, grossistes, distributeurs et petites chaînes multi-sites.

Le produit est universel par son socle, et spécialisé par configuration : chaque entreprise choisit son secteur, ses unités, ses règles de vente et les modules avancés dont elle a besoin. Aucun secteur ne doit imposer une application séparée.

## Socle commun
- Entreprise, établissements, utilisateurs, rôles et permissions.
- Catalogue générique : articles, services, variantes, SKU, code-barres, unités et taxes.
- Achats, fournisseurs, réceptions et coûts d'acquisition.
- Stocks, mouvements, inventaires et transferts multi-sites.
- Point de vente : panier, remises contrôlées, tickets, paiements, retours et clôture.
- Clients, historique, fidélité et comptes à crédit.
- Dépenses, trésorerie, rapports et exports.
- Abonnements SaaS, quotas, support et administration plateforme.
- PWA mobile-first et mode hors connexion pour les opérations autorisées.

## Profils d'activité
- Commerce général et alimentation : unités, lots, péremption et promotions.
- Quincaillerie / matériaux : unités fractionnaires, longueur, surface, poids, volume et conditionnements.
- Mode : tailles, couleurs, déclinaisons et collections.
- Pharmacie / parapharmacie : lots, péremption, traçabilité et contrôles métier/réglementaires spécifiques.
- Restaurant : menus, suppléments, recettes, ingrédients, tables et commandes.
- Pièces automobiles : références constructeur, compatibilités et équivalences.
- Électronique : numéros de série, garanties et accessoires.
- Beauté : variantes, lots, kits et prestations.
- Grossiste : tarifs par quantité, conditionnements, clients professionnels et livraisons.
- Services : prestations, rendez-vous, devis et facturation, sans stock obligatoire.

## Modules essentiels et avancés
Les fonctions essentielles sont catalogue, ventes, stock, achats, clients, caisse et rapports. Les fonctions avancées (inventaires détaillés, multi-sites, transferts, factures fournisseurs, comptabilité détaillée, audit et boutique en ligne) sont activables selon les besoins et l'offre souscrite.

## Principes produit
- Configuration par entreprise, pas de code métier dupliqué par secteur.
- Le stock est optionnel pour les prestataires de services.
- Les unités et quantités sont configurables; ne pas supposer que tout article se vend à l'unité.
- Montants en unités monétaires exactes, jamais en float côté calcul métier.
- Historique transactionnel conservé; annulation et correction tracées plutôt que suppression physique.
- Isolation stricte des tenants et permissions vérifiées côté serveur et RLS.
- Langue française et devise paramétrable (XOF par défaut), fiscalité configurable par pays.
- Interface claire, rapide, accessible et utilisable au téléphone.

## Hors périmètre du socle initial
- Gestion médicale, CRM de prospection terrain, fonctionnalités de force de vente pharmaceutique.
- ERP industriel complet, paie/RH avancée, marketplace multi-vendeurs.
- Intégrations de paiement automatiques sans API et identifiants marchands fournis.
