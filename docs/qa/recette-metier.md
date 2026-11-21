# Recette métier iDIABA

## Règles de test

- Exécuter cette recette uniquement sur un environnement de test avec des entreprises, utilisateurs, produits et fournisseurs fictifs.
- Ne jamais utiliser de véritables paiements Wave, Orange Money ou des fonds réels pendant les essais.
- Conserver les identifiants des opérations et les captures des résultats.
- Refaire les tests de non-régression après chaque migration.
- Une opération financière ou de stock doit être atomique : si une étape échoue, aucune écriture partielle ne doit rester.

## 1. Comptes, rôles et isolation des entreprises

- [ ] Créer deux entreprises de test indépendantes.
- [ ] Créer un propriétaire, un administrateur, un manager, un comptable, un caissier et un gestionnaire de stock.
- [ ] Vérifier que chaque membre ne voit que les données de ses entreprises.
- [ ] Tenter de consulter ou modifier un produit, fournisseur, achat, facture, caisse ou écriture d'une autre entreprise : l'accès doit être refusé.
- [ ] Vérifier que les rôles non autorisés ne peuvent ni créer ni régler une facture fournisseur.
- [ ] Vérifier qu'un utilisateur non connecté ne peut accéder à aucun écran privé ni RPC métier.

## 2. Catalogue, stocks et inventaires

- [ ] Créer un produit avec référence, prix de vente, coût d'achat et taxe.
- [ ] Vérifier les validations des champs obligatoires et des montants négatifs.
- [ ] Effectuer une entrée de stock et vérifier le solde du dépôt.
- [ ] Tenter une sortie supérieure au stock disponible : l'opération doit être refusée.
- [ ] Créer un inventaire, saisir les quantités comptées et publier les écarts.
- [ ] Vérifier que chaque ajustement crée un mouvement traçable et que les mouvements historiques ne sont pas modifiables.

## 3. Achats et réceptions (PR #33)

- [ ] Créer un fournisseur actif.
- [ ] Créer une commande avec un seul article.
- [ ] Créer une commande avec cinq articles différents.
- [ ] Tenter d'ajouter deux fois le même produit : le formulaire doit refuser la commande.
- [ ] Tester une quantité nulle, négative ou un coût invalide : la commande doit être refusée.
- [ ] Réceptionner une partie des quantités : le statut doit devenir « partiellement reçue » et seul le stock reçu doit augmenter.
- [ ] Réceptionner le reliquat : le statut doit devenir « réceptionnée ».
- [ ] Tenter de réceptionner plus que le reliquat : l'opération doit être refusée sans mouvement de stock.
- [ ] Vérifier qu'une réception n'est pas modifiable ou supprimable après validation.

## 4. Factures fournisseurs (PR #34)

- [ ] Enregistrer une facture liée à une commande partiellement ou totalement réceptionnée.
- [ ] Tenter de sélectionner un fournisseur différent de celui de la commande : l'opération doit être refusée.
- [ ] Tenter d'enregistrer deux fois le même numéro pour le même fournisseur : le doublon doit être refusé.
- [ ] Refuser une facture dont la date d'échéance précède la date de facture.
- [ ] Enregistrer une facture sans TVA et vérifier l'écriture : débit achats HT, crédit fournisseurs.
- [ ] Enregistrer une facture avec TVA et vérifier l'écriture équilibrée : débit achats HT, débit TVA récupérable, crédit fournisseurs.
- [ ] Vérifier que le montant HT est comparé à la valeur des marchandises effectivement réceptionnées.
- [ ] Vérifier que l'écart positif ou négatif est visible sans modifier les coûts historiques de la commande.
- [ ] Vérifier que le montant restant dû, le statut et les indicateurs de retard sont exacts.

## 5. Règlements fournisseurs

- [ ] Enregistrer un règlement partiel par banque : le solde dû doit diminuer du montant exact.
- [ ] Enregistrer le règlement du solde : la facture doit passer à « réglée ».
- [ ] Enregistrer un paiement en espèces avec une session de caisse ouverte appartenant à l'utilisateur : le règlement et une sortie de caisse doivent être créés ensemble.
- [ ] Tenter un paiement en espèces sans session ouverte : l'opération doit être refusée.
- [ ] Tenter un paiement supérieur au solde disponible de la caisse : l'opération doit être refusée.
- [ ] Tenter un paiement supérieur au solde de la facture : l'opération doit être refusée.
- [ ] Soumettre deux fois le même formulaire avec la même clé d'idempotence : un seul paiement et une seule écriture comptable doivent exister.
- [ ] Réutiliser la même clé d'idempotence avec un montant ou un compte différent : l'opération doit être refusée.
- [ ] Vérifier qu'un paiement bancaire ne crée pas de sortie dans une session de caisse.
- [ ] Clôturer la caisse après un paiement fournisseur en espèces : le solde théorique doit inclure la sortie fournisseur.
- [ ] Vérifier que chaque règlement produit une écriture équilibrée et qu'il reste traçable.

## 6. Caisse et ventes

- [ ] Ouvrir une session de caisse avec un fond initial.
- [ ] Réaliser une vente en espèces et une vente avec paiement mixte.
- [ ] Vérifier que le total des moyens de paiement correspond exactement au total TTC.
- [ ] Vérifier la diminution du stock et la création des écritures de vente.
- [ ] Enregistrer une entrée puis une sortie d'espèces.
- [ ] Vérifier que la clôture calcule le solde théorique avec les ventes en espèces, entrées et sorties.
- [ ] Tenter une sortie supérieure au solde disponible : elle doit être refusée.
- [ ] Vérifier qu'une session clôturée ne peut plus recevoir de mouvement.

## 7. Clients, retours et comptabilité

- [ ] Créer un client et le rattacher à une vente.
- [ ] Effectuer un retour partiel puis un retour complet.
- [ ] Vérifier les quantités retournables, les mouvements de stock et les écritures de contrepassation.
- [ ] Vérifier la balance comptable : total débits égal total crédits.
- [ ] Vérifier que les écritures validées sont immuables et que les corrections passent par une écriture de contrepassation.
- [ ] Vérifier les exports et rapprocher les totaux exportés des écrans.

## 8. Mode hors connexion et synchronisation

- [ ] Charger l'application et les données de caisse lorsque l'appareil est connecté.
- [ ] Couper la connexion et effectuer plusieurs ventes de test.
- [ ] Fermer puis rouvrir l'application hors connexion : les ventes en attente doivent être conservées.
- [ ] Rétablir la connexion : chaque vente doit être synchronisée une seule fois.
- [ ] Vérifier qu'une nouvelle tentative de synchronisation ne crée pas de doublon.
- [ ] Vérifier le traitement d'une vente devenue impossible à synchroniser (stock insuffisant, produit désactivé ou session fermée).

## 9. Abonnements et quotas

- [ ] Créer une entreprise d'essai et vérifier la formule attribuée.
- [ ] Vérifier les quotas utilisateurs, produits et opérations selon la formule.
- [ ] Atteindre une limite : l'application doit expliquer le blocage sans perdre la saisie.
- [ ] Soumettre une demande de changement de formule et vérifier le traitement par l'administration plateforme.
- [ ] Vérifier qu'un utilisateur d'une entreprise ne peut pas consulter l'abonnement d'une autre entreprise.

## Critères de validation avant mise en production

- [ ] Toutes les étapes bloquantes passent sur un environnement de test.
- [ ] Aucune donnée d'une autre entreprise n'est accessible.
- [ ] Les opérations de stock et de comptabilité sont cohérentes et équilibrées.
- [ ] Les paiements ne peuvent pas être dupliqués et les sorties de caisse sont rapprochées.
- [ ] Les migrations sont appliquées sur un environnement de test avant la production.
- [ ] Une sauvegarde exploitable et une procédure de restauration sont vérifiées.
- [ ] La PR est relue, tous les contrôles CI passent et le responsable valide explicitement la mise en production.

**État initial :** recette à exécuter. Les cases ne doivent être cochées qu'après un test réel documenté.
