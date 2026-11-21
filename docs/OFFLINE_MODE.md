# Mode hors connexion iDIABA

## Préparation obligatoire sur chaque appareil
1. Connectez-vous à iDIABA avec le compte qui utilisera la caisse.
2. Ouvrez une session de caisse et rendez-vous dans **Caisse**.
3. Cliquez sur **Préparer / ouvrir la caisse hors connexion**.
4. Attendez que la page hors connexion s'affiche une première fois. Cette étape met en cache son interface et ses ressources.
5. Sur téléphone, ajoutez iDIABA à l'écran d'accueil depuis le menu du navigateur.

## Utilisation sans réseau
- Ouvrez l'application installée ou rendez-vous sur la caisse.
- Les produits et la session disponibles lors de la dernière préparation sont affichés.
- Les ventes saisies sont conservées dans IndexedDB sur cet appareil.
- Chaque vente reste en attente jusqu'à confirmation par le serveur.
- Au retour du réseau, la synchronisation est automatique; le bouton **Synchroniser maintenant** permet de la relancer.

## Points de contrôle
- Le stock et les prix sont revérifiés par le serveur à la synchronisation.
- Une session clôturée, un stock insuffisant ou un changement de prix peut bloquer une vente en attente.
- Une vente bloquée reste conservée localement; ne videz pas les données du navigateur avant sa résolution.
- Les données hors connexion ne sont pas partagées entre appareils avant synchronisation.
- Le mode hors connexion est limité à la caisse; les achats, inventaires et écritures comptables nécessitent le réseau.
