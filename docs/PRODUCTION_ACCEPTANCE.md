# iDIABA V2 — Checklist de validation avant exploitation

Cette checklist décrit la pile réellement déployée : React 19 + Vite + TypeScript + Dexie/PWA, API FastAPI + SQLAlchemy async, PostgreSQL managé Render. Elle sépare les contrôles CI des essais fonctionnels qui nécessitent des comptes dédiés.

## Contrôles automatisés CI

Le workflow `.github/workflows/ci.yml` exécute actuellement :

- [ ] Backend : installation des dépendances Python 3.12.
- [ ] Backend : compilation Python (`compileall`).
- [ ] Backend : import de l'application FastAPI.
- [ ] Backend : initialisation du seed et exécution de `smoke_test.py`.
- [ ] Frontend : installation des dépendances Node 22.
- [ ] Frontend : `npm run build` (TypeScript `tsc -b` puis Vite).
- [ ] Déploiement Render confirmé `live` sur le commit attendu.
- [ ] Route `/api/health` répond HTTP 200.
- [ ] Journaux Render vérifiés après déploiement.

## Données et bascule

- [ ] Confirmer la base source historique et son périmètre avant toute migration.
- [ ] Exporter et vérifier une sauvegarde restaurable de la base source.
- [ ] Établir le mapping des tables et identifiants vers le schéma iDIABA V2.
- [ ] Tester l'import sur une base de préproduction, sans écraser les données de V2.
- [ ] Comparer les nombres d'entreprises, utilisateurs, produits, mouvements, ventes, paiements et soldes avant/après.
- [ ] Vérifier les totaux financiers et les stocks par dépôt.
- [ ] Ne basculer les utilisateurs qu'après validation métier et technique.

**État constaté le 25 novembre 2026 :** iDIABA V2 utilise PostgreSQL Render. L'ancien projet Supabase et son schéma de sauvegarde ne sont pas la base de données runtime de V2. Aucune migration des données historiques Supabase vers PostgreSQL Render n'est déclarée terminée. La base V2 observée contient encore les données de démonstration (1 entreprise, 3 comptes, 13 produits et 4 ventes). Cette étape doit être traitée avant une mise en exploitation avec les données historiques.

## Sécurité multi-entreprise et profils

- [ ] Vérifier que le Super Admin plateforme n'est rattaché à aucune entreprise et n'accède pas aux données métier.
- [ ] Créer deux entreprises de test et des utilisateurs distincts.
- [ ] Vérifier qu'un utilisateur ne lit ni ne modifie les ventes, produits, clients, stocks, fournisseurs, achats ou documents d'une autre entreprise.
- [ ] Tester les profils ADMIN, GERANT, CAISSIER, VENDEUR et STOCK.
- [ ] Vérifier les autorisations positives et négatives pour chaque module.
- [ ] Affecter un utilisateur à un seul dépôt et refuser l'accès opérationnel aux autres dépôts.
- [ ] Vérifier que les actions sensibles sont journalisées dans audit_logs.
- [ ] Vérifier les limites d'utilisateurs et les droits selon l'abonnement.

## Catalogue et commerce universel

- [ ] Créer et modifier un produit avec SKU, code-barres, catégorie, unité, prix et taxe.
- [ ] Vérifier les produits simples, variantes, services et produits composés/recettes.
- [ ] Vérifier les doublons SKU/code-barres dans une même entreprise.
- [ ] Archiver puis réactiver un produit sans perdre l'historique.
- [ ] Vérifier les tarifs et prix par liste lorsque configurés.
- [ ] Tester les articles de restauration et la déduction des ingrédients selon la recette.

## Stock, inventaires et achats

- [ ] Vérifier les entrées, sorties et ajustements avec historique des mouvements.
- [ ] Réaliser un inventaire, contrôler les écarts puis valider.
- [ ] Vérifier les seuils d'alerte et les propositions de réapprovisionnement.
- [ ] Créer une commande fournisseur, réceptionner partiellement puis totalement.
- [ ] Refuser une réception supérieure au reliquat.
- [ ] Vérifier le coût d'achat et la valorisation du stock.
- [ ] Tester les lots, dates de péremption et sortie FEFO si le suivi par lot est activé.
- [ ] Tester un transfert multi-articles : expédition, réception partielle et réception finale.
- [ ] Vérifier qu'un transfert ne crée pas de stock disponible avant sa réception.

## Caisse et ventes

- [ ] Ouvrir une caisse avec ou sans fonds initial, selon la configuration de l'entreprise.
- [ ] Vendre en espèces, Wave manuel, Orange Money manuel, carte ou crédit selon les moyens activés.
- [ ] Tester les paiements partagés et contrôler le reste à payer.
- [ ] Refuser une vente si le stock disponible est insuffisant lorsque le contrôle est activé.
- [ ] Tester la recherche et le scan SKU/code-barres.
- [ ] Imprimer un ticket et utiliser l'enregistrement PDF.
- [ ] Contrôler le ticket, les taxes, le paiement, le caissier, le dépôt et le total.
- [ ] Tester l'annulation, le remboursement partiel et total, avec le moyen de remboursement correct.
- [ ] Vérifier les mouvements de caisse, le comptage de clôture et les écarts.

## Restaurant

- [ ] Créer et gérer les tables.
- [ ] Ouvrir une commande sur table et ajouter/modifier des articles.
- [ ] Envoyer les articles en préparation et suivre les commandes cuisine.
- [ ] Encaisser une commande et vérifier la libération de la table.
- [ ] Vérifier la consommation des ingrédients selon les recettes.

## Mode hors connexion et synchronisation

- [ ] Précharger le catalogue et les données nécessaires.
- [ ] Couper Internet et vérifier l'accès aux écrans essentiels.
- [ ] Vérifier la conservation locale des opérations après fermeture/réouverture.
- [ ] Rétablir Internet et synchroniser.
- [ ] Vérifier l'idempotence : aucune vente ou paiement en double.
- [ ] Tester les conflits de stock et afficher clairement les opérations à résoudre.
- [ ] Vérifier qu'aucune opération en attente n'est perdue.

## Comptabilité, rapports et abonnements

- [ ] Vérifier les totaux de ventes, marges, achats, dépenses et stocks.
- [ ] Vérifier que les écritures comptables sont équilibrées lorsque la comptabilité est activée.
- [ ] Saisir une dépense et contrôler son impact sur les comptes.
- [ ] Enregistrer un règlement fournisseur et contrôler le solde restant.
- [ ] Vérifier les rapports par période, entreprise et dépôt.
- [ ] Tester la création, l'activation et la suspension d'un abonnement depuis l'espace plateforme.
- [ ] Confirmer les limites du plan d'essai et des plans payants.
- [ ] Garder les paiements Wave/Orange Money en mode manuel tant que les API et identifiants marchands ne sont pas configurés.

## Exploitation et appareils

- [ ] Vérifier les sauvegardes PostgreSQL Render et réaliser un test de restauration contrôlé.
- [ ] Vérifier la robustesse du secret JWT et la politique de renouvellement des sessions.
- [ ] Vérifier les paramètres de l'entreprise : logo, adresse, RCCM, NINEA, téléphone et devise.
- [ ] Tester sur smartphone, tablette et ordinateur, en priorité la caisse.
- [ ] Tester les imprimantes tickets et les scanners USB/Bluetooth disponibles.
- [ ] Vérifier les journaux, erreurs et alertes après les scénarios de recette.

**Règle de validation :** une case n'est cochée qu'après un test réellement exécuté et documenté. Les tests de recette doivent être réalisés avec des comptes et des données dédiés, jamais en modifiant les données historiques de production.
