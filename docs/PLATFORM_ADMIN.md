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


## Paiements automatiques Wave

Le parcours Wave est intégré au module Abonnements :
- Le serveur crée une session Checkout en XOF avec une référence interne unique.
- Le client est redirigé vers l'URL Wave officielle.
- L'abonnement n'est activé qu'après réception d'un webhook Wave signé et vérification du montant, de la devise et de la référence.
- Les retours navigateur ne déclenchent jamais l'activation à eux seuls.

Variables secrètes à configurer dans Render (service `idiaba`) :
- `WAVE_API_KEY` : clé API Wave Business Checkout.
- `WAVE_WEBHOOK_SECRET` : secret de signature fourni lors de l'enregistrement du webhook.
- `SUPABASE_SERVICE_ROLE_KEY` : clé serveur Supabase, jamais exposée au navigateur.
- `NEXT_PUBLIC_APP_URL` : URL publique, par exemple `https://idiaba.onrender.com`.

Dans le portail Wave Business, enregistrer l'URL HTTPS :
`https://idiaba.onrender.com/api/webhooks/wave`
et activer les événements `checkout.session.completed` et `checkout.session.payment_failed`.

Utiliser une clé Wave Business dédiée au Checkout et activer la signature des webhooks. Ne jamais coller ces secrets dans GitHub, un ticket ou un message public.

## Orange Money

Le choix Orange Money est disponible avec traitement manuel : la demande et la référence sont transmises à l'administration, qui confirme le paiement après vérification sur le compte marchand.

Pour automatiser Orange Money, iDIABA doit être enregistré auprès de Sonatel comme marchand Paiement Internet et recevoir les identifiants ainsi que la documentation technique de production. Les endpoints de paiement sont remis dans le cadre de l'accès marchand et ne doivent pas être devinés. La mise en service automatique sera ajoutée après réception de ces éléments.
