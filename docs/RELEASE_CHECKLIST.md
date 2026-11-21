# iDIABA — Checklist de recette avant ouverture

## État technique
- [x] Dépôt GitHub Nasora-group/iDIABA.
- [x] Application Next.js déployée sur Render.
- [x] Authentification Supabase et séparation des entreprises par RLS.
- [x] Catalogue, stock, caisse, achats, comptabilité et inventaires.
- [x] Clients, tickets et retours partiels.
- [x] PWA et mécanisme de fonctionnement hors connexion.
- [x] Abonnements, essai de 14 jours et quotas en base.
- [x] Console plateforme et demandes de changement de formule.
- [x] Journal d'audit append-only.
- [x] Rapports de gestion et export CSV.
- [x] Index de clés étrangères et optimisations RLS.
- [x] Endpoint de santé HTTP /api/health.

## Recette métier à effectuer avec un compte connecté
- [ ] Créer une entreprise et vérifier l'attribution automatique de l'essai.
- [ ] Créer un dépôt, une catégorie, un fournisseur et des produits.
- [ ] Ouvrir une session de caisse, réaliser une vente et vérifier le paiement.
- [ ] Vérifier la diminution du stock et l'écriture comptable de la vente.
- [ ] Créer une commande fournisseur, réceptionner les articles et vérifier le stock.
- [ ] Réaliser un inventaire, constater un écart et valider l'ajustement.
- [ ] Créer un client, associer un ticket et enregistrer un retour partiel.
- [ ] Fermer une session de caisse et contrôler l'écart.
- [ ] Consulter le journal d'audit et vérifier les données avant/après.
- [ ] Générer un rapport sur une période et ouvrir le CSV dans Excel.
- [ ] Installer la PWA, charger les écrans utiles, passer hors connexion, saisir une opération puis reconnecter et vérifier la synchronisation sans doublon.
- [ ] Tester l'isolation : un utilisateur d'une entreprise ne doit jamais voir les données d'une autre.
- [ ] Tester les quotas en dépassant volontairement une limite sur une entreprise de test.

## Paramètres commerciaux et sécurité à finaliser
- [ ] Attribuer app_metadata.role = platform_admin au compte responsable, puis se reconnecter.
- [ ] Configurer les tarifs mensuels et annuels des formules dans la console plateforme.
- [ ] Vérifier les paiements manuellement avant activation; connecter les API Wave/Orange Money seulement après réception des accès marchands.
- [ ] Activer la protection contre les mots de passe compromis dans Supabase Auth.
- [ ] Définir une politique de sauvegarde et réaliser un test de restauration.
- [ ] Effectuer une recette complète sur ordinateur et téléphone.

## Limites connues
- Les parcours authentifiés n'ont pas encore été exécutés de bout en bout avec un compte utilisateur réel dans cet environnement.
- Les encaissements automatiques Wave/Orange Money ne sont pas branchés.
- La marge brute n'est pas calculée tant que le coût d'achat historique n'est pas enregistré sur chaque ligne de vente.
- L'activation des sauvegardes dépend du plan et des paramètres Supabase choisis.
