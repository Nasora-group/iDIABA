# Administration de la plateforme iDIABA

## Donner l'accès à l'administrateur plateforme
L'accès plateforme est distinct du rôle propriétaire d'une entreprise.

1. Ouvrir le projet Supabase iDIABA.
2. Aller dans **Authentication → Users**.
3. Sélectionner le compte qui doit administrer iDIABA.
4. Modifier les **App Metadata** (pas les User Metadata) et ajouter :
   `{"role":"platform_admin"}`
5. Enregistrer, puis déconnecter/reconnecter le compte dans iDIABA pour renouveler le JWT.

Ne donnez ce rôle qu'au responsable de la plateforme : il permet de consulter les demandes de toutes les entreprises et de modifier les tarifs et quotas.

## Traiter les demandes de paiement
1. Configurer les prix mensuels et annuels dans **Administration iDIABA → Formules et tarifs**.
2. Vérifier le paiement reçu sur le compte Wave, Orange Money ou bancaire indiqué par l'entreprise.
3. Contrôler la référence saisie dans la demande.
4. Cliquer sur **Valider le paiement et activer** uniquement après vérification.

L'activation démarre une nouvelle période mensuelle ou annuelle. Les paiements ne sont pas encore encaissés automatiquement par iDIABA; la vérification est manuelle.
