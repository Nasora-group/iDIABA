# Sauvegardes externes Supabase

## Situation
Le projet Supabase iDIABA est sur l'offre Free. Ne pas considérer cette offre comme une sauvegarde quotidienne indépendante. Cette procédure décrit une sauvegarde logique chiffrée à conserver hors de Supabase.

Cette documentation ne crée pas encore de tâche automatique : aucun secret de connexion à la base ni destination de stockage externe n'a été configuré/validé dans GitHub ou Render.

## Prérequis
- PostgreSQL client compatible avec le serveur (pg_dump et pg_restore).
- age installé : https://age-encryption.org/
- URL PostgreSQL Supabase conservée dans un gestionnaire de secrets local ou CI. Ne jamais la coller dans le dépôt, un ticket ou une conversation.
- Clé publique age de sauvegarde (recipient). Garder la clé privée correspondante hors du serveur et séparée des sauvegardes.
- Stockage externe privé avec chiffrement au repos, versioning et accès limité.

Utiliser une connexion directe ou un pooler en mode session compatible avec pg_dump. Éviter le pooler en mode transaction pour les opérations de dump/restauration.

## Créer une sauvegarde chiffrée
Définir SUPABASE_DB_URL et AGE_RECIPIENT dans un terminal sécurisé, sans les inscrire dans un fichier versionné.

    set -euo pipefail
    umask 077
    mkdir -p backups
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    pg_dump --format=custom --no-owner --no-acl "$SUPABASE_DB_URL" \
      | age --encrypt --recipient "$AGE_RECIPIENT" \
      > "backups/idiaba-supabase-$stamp.dump.age"
    test -s "backups/idiaba-supabase-$stamp.dump.age"
    sha256sum "backups/idiaba-supabase-$stamp.dump.age" \
      > "backups/idiaba-supabase-$stamp.dump.age.sha256"

Téléverser uniquement le fichier .dump.age et son empreinte vers le stockage externe privé. Ne pas téléverser un dump non chiffré.

## Vérifier et restaurer
Vérifier l'empreinte puis lister le contenu du dump déchiffré :

    sha256sum --check idiaba-supabase-YYYYMMDDTHHMMSSZ.dump.age.sha256
    age --decrypt --identity /chemin/hors-ligne/backup-identity.txt \
      idiaba-supabase-YYYYMMDDTHHMMSSZ.dump.age | pg_restore --list

Pour un test de restauration, utiliser une base de test vide et une identité age conservée hors ligne :

    age --decrypt --identity /chemin/hors-ligne/backup-identity.txt \
      idiaba-supabase-YYYYMMDDTHHMMSSZ.dump.age \
      | pg_restore --clean --if-exists --no-owner --no-acl \
          --dbname "$SUPABASE_RESTORE_TEST_URL"

Ne jamais exécuter une restauration destructive sur la base de production pour un simple test. Vérifier les tables, volumes de données, fonctions, politiques RLS, extensions et migrations attendues.

## Politique minimale recommandée
- Sauvegarde quotidienne, plus une sauvegarde avant toute migration importante.
- Conserver 7 sauvegardes quotidiennes, 4 hebdomadaires et 3 mensuelles, selon les capacités et coûts du stockage.
- Activer le versioning et limiter l'accès au bucket à l'identité de sauvegarde.
- Conserver la clé privée age dans un gestionnaire de secrets ou un coffre hors ligne, jamais dans le même bucket.
- Alerter en cas d'échec ou d'absence de sauvegarde récente.
- Tester une restauration au moins une fois par mois et après tout changement majeur.

## Avant d'automatiser dans GitHub Actions
Configurer explicitement les secrets du dépôt :
- SUPABASE_DB_URL : URL PostgreSQL dédiée à la sauvegarde, avec privilèges suffisants pour lire schéma et données.
- AGE_RECIPIENT : clé publique age uniquement (pas la clé privée).
- Identifiants du stockage externe privé, avec droits d'écriture limités au seul emplacement des sauvegardes.

Le workflow devra chiffrer avant tout téléversement, ne jamais publier le dump comme artefact public ou non chiffré, appliquer une rétention vérifiable et échouer clairement si un secret manque. Ne pas activer de planification tant que la destination, les secrets, les coûts éventuels et le test de restauration ne sont pas validés.

## Procédure d'incident
1. Suspendre les opérations de restauration automatique ou de nettoyage.
2. Identifier la sauvegarde chiffrée la plus récente dont l'empreinte est valide.
3. Restaurer d'abord dans un environnement isolé et vérifier les données.
4. Documenter le point de restauration et l'écart de données potentiel.
5. N'envisager la production qu'après validation explicite et plan de retour arrière.
