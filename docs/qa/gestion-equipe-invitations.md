# Gestion des utilisateurs d'entreprise

## Parcours administrateur
1. Ouvrir **Utilisateurs & équipe**.
2. Pour un nouvel employé, saisir son e-mail, son nom et son rôle puis envoyer l'invitation.
3. Pour un utilisateur déjà inscrit, utiliser **Ajouter un compte existant**.
4. Modifier un rôle ou retirer son accès depuis sa fiche. Le retrait n'efface aucune vente ni donnée associée.

## Invitation e-mail
L'Edge Function `invite-tenant-member` valide le JWT du demandeur, vérifie son rôle owner/admin dans le tenant ciblé, vérifie le quota et crée l'invitation via Supabase Auth Admin. Le membre est ajouté au tenant sans créer un espace entreprise personnel pour l'invité.

Avant d'utiliser les invitations en production:
- Configurer le SMTP personnalisé de Supabase Auth (sinon les e-mails peuvent être soumis aux restrictions du service par défaut).
- Configurer le Site URL Supabase Auth sur l'URL de l'application et autoriser la redirection vers `https://idiaba.onrender.com/login` (ou définir `APP_URL` dans les secrets Edge Functions et autoriser cette URL).
- Vérifier les modèles e-mail d'invitation et le lien de confirmation.
- Ne jamais mettre la clé service-role dans les variables `NEXT_PUBLIC_*` ni dans le navigateur.

## Recette
- Administrateur de tenant: invitation d'un caissier -> l'e-mail est reçu -> compte activé -> connexion.
- Un administrateur ne peut inviter ni modifier des membres d'un autre tenant.
- Caissier/responsable non-admin: invitation refusée.
- Adresse déjà inscrite: invitation refusée avec indication d'utiliser l'association d'un compte existant.
- Quota atteint: invitation et ajout bloqués.
- Formule Entreprise illimitée: ajout autorisé si l'abonnement est valide.
- Rôle Propriétaire non assignable; retrait de son propre accès admin bloqué.
- Retrait d'accès d'un membre: ses anciennes ventes/écritures restent conservées.
