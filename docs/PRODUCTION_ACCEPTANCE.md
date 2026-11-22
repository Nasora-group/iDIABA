# iDIABA — Checklist de validation avant exploitation

Cette checklist distingue les contrôles automatisés des tests manuels qui nécessitent des comptes et des données réelles.

## Contrôles automatisés

- [ ] CI : lint
- [ ] CI : TypeScript
- [ ] CI : build Next.js
- [ ] CI : validation Edge Function et Deno
- [ ] Déploiement Render confirmé `live`
- [ ] Migrations Supabase vérifiées
- [ ] Vérifier logs Render après déploiement

## Sécurité multi-entreprise

- [ ] Créer deux entreprises de test avec deux utilisateurs différents.
- [ ] Vérifier qu'un utilisateur ne voit ni ventes, produits, clients, stocks, fournisseurs, achats ou documents comptables de l'autre entreprise.
- [ ] Tester chaque rôle (owner/admin/manager/cashier/stock) avec permissions positives et négatives.
- [ ] Affecter un utilisateur à un seul dépôt et vérifier que les données opérationnelles des autres dépôts sont refusées.
- [ ] Vérifier les transferts : expédition par équipe source, réception par équipe destination.
- [ ] Confirmer que les RPC sensibles rejettent les appels sans authentification et sans rôle requis.

## Catalogue

- [ ] Créer un produit avec SKU et code-barres.
- [ ] Modifier nom, SKU, code-barres, catégorie, unité, prix et taxe.
- [ ] Archiver puis réactiver le produit; vérifier que l'historique reste intact.
- [ ] Créer, modifier, archiver et réactiver une catégorie.
- [ ] Modifier un produit affecté à une catégorie archivée et vérifier que l'affectation n'est pas perdue par inadvertance.
- [ ] Vérifier les doublons SKU/code-barres.

## Stock et achats

- [ ] Saisir une réception d'achat et vérifier l'augmentation du stock.
- [ ] Réceptionner partiellement puis compléter une commande.
- [ ] Vérifier qu'une quantité supérieure au reliquat est refusée.
- [ ] Définir un seuil par produit et dépôt.
- [ ] Vérifier l'alerte lorsque stock <= seuil, y compris stock nul sans mouvement.
- [ ] Vérifier le calcul de la quantité à commander.
- [ ] Archiver/réactiver un fournisseur et vérifier qu'il est exclu des nouvelles commandes lorsqu'il est archivé.
- [ ] Modifier les coordonnées d'un fournisseur et vérifier les commandes historiques.

## Caisse

- [ ] Ouvrir une session de caisse et saisir un fonds initial.
- [ ] Vendre en espèces, Wave manuel et Orange Money manuel.
- [ ] Tester un paiement partagé.
- [ ] Vérifier le refus de vente si stock insuffisant.
- [ ] Scanner un code-barres/SKU avec scanner USB ou Bluetooth.
- [ ] Tester quantité invalide au scan et confirmer qu'aucun produit n'est ajouté.
- [ ] Imprimer un ticket et choisir « Enregistrer en PDF ».
- [ ] Vérifier ticket, total, taxes, paiement, caissier et dépôt.

## Mode hors connexion

- [ ] Préparer le catalogue et la session, puis couper Internet.
- [ ] Scanner des produits et saisir une vente hors connexion.
- [ ] Vérifier que la vente reste dans la file locale après fermeture/réouverture.
- [ ] Rétablir Internet et synchroniser.
- [ ] Vérifier qu'une vente ne se synchronise qu'une fois (idempotence).
- [ ] Tester une vente en conflit de stock et confirmer que l'erreur est visible et que la file ne perd pas la vente.
- [ ] Vérifier la synchronisation des paiements et la session de caisse.

## Comptabilité et abonnements

- [ ] Vérifier la balance comptable (débits = crédits).
- [ ] Saisir une dépense et vérifier les écritures.
- [ ] Enregistrer un règlement de facture fournisseur et vérifier le solde restant.
- [ ] Tester demande/validation/rejet d'abonnement avec compte Platform Admin.
- [ ] Vérifier le plafond de deux utilisateurs du plan d'essai et les limites du plan souscrit.
- [ ] Wave/Orange Money restent manuels tant que les API et credentials marchands ne sont pas disponibles.

## Configuration de sécurité / exploitation

- [ ] Activer la protection contre les mots de passe compromis dans Supabase Auth.
- [ ] Tester la procédure de sauvegarde et restauration (backup/restore).
- [ ] Vérifier les comptes Platform Admin et MFA si disponible.
- [ ] Vérifier les paramètres de l'entreprise (logo, adresse, RCCM, NINEA, téléphone).
- [ ] Tester l'application sur smartphone et tablette, particulièrement les formulaires POS, stock et achats.
- [ ] Vérifier les alertes, logs et erreurs après les scénarios de test.

**État au 22 novembre 2026 :** les contrôles CI sont exécutés pour chaque PR; les tests de bout en bout ci-dessus restent à effectuer avec des comptes de test et les paramètres d'exploitation.
