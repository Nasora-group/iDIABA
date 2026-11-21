# Sprint 17 — Multi-entreprise

Un même compte utilisateur peut appartenir à plusieurs entreprises, avec un rôle différent dans chacune. Chaque entreprise reste totalement isolée (produits, stocks, caisses, comptabilité, équipe, abonnement, audit).

## Ce qui existait déjà
`tenants`, `tenant_memberships`, rôles, RLS sur toutes les tables métier, abonnement et quotas par entreprise.

## Ce que ce sprint ajoute
- **Entreprise active** : un bandeau commun à toutes les pages `/app` permet de changer d'entreprise. Chaque module (produits, stocks, caisse, achats, comptabilité, inventaires, clients, rapports, audit, abonnement) n'affiche que l'entreprise active.
- **Nouvelle entreprise** : `/app/company/new`. L'utilisateur en devient propriétaire et l'essai de 14 jours démarre. Plafond : 5 entreprises créées par compte (anti-abus de l'essai gratuit).
- **Entreprise & équipe** : `/app/company`. Renommer l'entreprise, lister les membres, changer un rôle, retirer un membre, quitter l'entreprise.
- **Invitations** : lien à usage unique, valable 7 jours, lié à l'adresse e-mail invitée (`/app/invite/<token>`). Le lien est copié puis envoyé manuellement (aucun service d'e-mail n'est configuré). Les invitations en attente comptent dans le quota d'utilisateurs de la formule.
- **Connexion / inscription** : le paramètre `next` ramène l'invité sur son lien après authentification. À l'inscription via invitation, le nom d'entreprise est facultatif.
- **Profils** : les membres d'une même entreprise voient leurs noms (ex. caissier sur les tickets).

## Règles de droits
| Action | Propriétaire | Administrateur | Autres rôles |
|---|---|---|---|
| Renommer l'entreprise, voir l'équipe, inviter | oui | oui | non |
| Attribuer/retirer les rôles propriétaire et administrateur | oui | non | non |
| Changer le rôle / retirer un membre non-admin | oui | oui | non |
| Quitter l'entreprise | oui (sauf dernier propriétaire) | oui | oui |

Une entreprise conserve toujours au moins un propriétaire.

## Sécurité
- Le cookie `idiaba_tenant` n'est qu'une préférence d'affichage : il est ignoré s'il ne correspond pas à une entreprise dont l'utilisateur est membre, et toutes les requêtes passent toujours par la RLS.
- Toutes les écritures sur les membres et invitations passent par des fonctions SQL `SECURITY DEFINER` qui vérifient les rôles (`create_invitation`, `revoke_invitation`, `accept_invitation`, `set_member_role`, `remove_member`). Aucun droit d'écriture direct sur `tenant_memberships` ni `tenant_invitations`.
- Les invitations ne sont lisibles que par les propriétaires/administrateurs de l'entreprise ; l'acceptation vérifie l'e-mail du JWT.
- Les redirections `next` sont limitées aux chemins `/app`.
- Les changements d'équipe sont tracés dans le journal d'audit.

## Déploiement
Appliquer `supabase/migrations/0023_multi_company.sql` (SQL Editor ou Supabase CLI), puis déployer l'application.

## Recette multi-entreprise
- [ ] Créer une 2ᵉ entreprise, basculer de l'une à l'autre : les produits/ventes ne se mélangent pas.
- [ ] Inviter un second compte (rôle caissier), ouvrir le lien, vérifier l'accès limité à l'entreprise invitée.
- [ ] Ouvrir le lien avec un autre compte : refus (e-mail différent).
- [ ] Dépasser le quota d'utilisateurs : l'invitation est refusée.
- [ ] Tenter de retirer/rétrograder le dernier propriétaire : refus.
- [ ] Vérifier le journal d'audit après un changement de rôle.
