# iDIABA — périmètre produit cible

## Positionnement

iDIABA est un logiciel de caisse enregistreuse et de gestion commerciale/ERP destiné aux commerces de toutes tailles et de tous secteurs. La caisse est le poste de travail quotidien des vendeurs et caissiers. L'administrateur dispose d'un back-office complet pour piloter l'entreprise, dans l'esprit fonctionnel de Sage 100, avec une interface plus simple et adaptée au terrain.

Ce produit n'est ni une boutique en ligne, ni une plateforme de commandes clients en ligne.

## Les trois espaces

### 1. Super Admin iDIABA (éditeur SaaS)
- Entreprises et espaces de travail
- Abonnements, facturation SaaS et statut des paiements
- Utilisateurs et assistance
- Activation des modules et limites par formule
- Statistiques globales et supervision technique
- Paramètres de la plateforme

Le Super Admin intervient sur la plateforme. Il ne doit pas être confondu avec l'administrateur d'un commerce.

### 2. Back-office de l'entreprise
L'administrateur de l'entreprise dispose d'une vue transversale et de droits complets sur son organisation :
- **Pilotage** : tableau de bord, chiffre d'affaires, marges, résultats, alertes, activité des caisses.
- **Ventes** : tickets, factures, devis si activés, retours, avoirs, remises, clients et comptes clients.
- **Caisse et trésorerie** : points de vente, sessions, ouverture/fermeture, mouvements, dépenses, écarts, moyens de paiement et rapprochements.
- **Catalogue** : articles, services, variantes, catégories, codes-barres, tarifs, taxes et tarifs par établissement.
- **Achats** : fournisseurs, demandes/commandes d'achat, réceptions, factures fournisseurs et retours fournisseurs.
- **Stocks** : dépôts, magasins, niveaux, mouvements, inventaires, transferts, lots et dates de péremption lorsque pertinents.
- **Finances et comptabilité** : dépenses, comptes, journaux, balance et états comptables selon le périmètre retenu.
- **Personnel et contrôle** : employés, profils personnalisés, droits, historique et journal d'audit.
- **Configuration** : identité légale, établissements, devises, taxes, séquences de documents, imprimantes et paramètres métier.

Les fonctions sont regroupées dans quelques espaces de navigation cohérents. Les sous-fonctions ne doivent pas devenir une multitude d'onglets de premier niveau. Aucune fonction métier existante utile ne doit être supprimée simplement pour raccourcir le menu.

### 3. Poste de caisse (POS)
L'écran de caisse doit rester rapide et focalisé :
1. Choix du point de vente et ouverture de session si nécessaire.
2. Lecture code-barres ou recherche article/service.
3. Panier, quantités et remises autorisées.
4. Sélection du client si nécessaire.
5. Paiement espèces, Wave, Orange Money, carte ou paiement mixte selon les moyens activés.
6. Validation atomique de la vente, paiement, ticket et mise à jour du stock.
7. Impression/téléchargement du ticket et passage à la vente suivante.

Le caissier ne voit que les opérations permises par son profil. Il ne voit pas les réglages d'entreprise, les écritures comptables ni les outils de supervision. Les fonctions sensibles (annulation, remise exceptionnelle, remboursement, réouverture, clôture d'une autre caisse) sont contrôlées par permission et journalisées.

## Règles métier structurantes
- Multi-entreprises avec cloisonnement strict par entreprise (tenant_id).
- Multi-établissements, multi-dépôts et multi-caisses.
- Les ventes validées sont historisées et traçables ; les corrections passent par annulation/avoir/retour, jamais par effacement silencieux.
- Une vente met à jour ses paiements, sa session de caisse et les stocks suivis dans une même transaction serveur.
- Les réceptions d'achat mettent à jour le stock et le coût d'achat ; les transferts et inventaires produisent des mouvements traçables.
- Le coût des marchandises vendues et les marges doivent être calculés à partir d'un coût documenté (méthode de valorisation à confirmer et appliquer uniformément).
- Les droits sont définis par l'administrateur de l'entreprise à partir d'opérations explicites ; l'interface et les règles serveur/RLS doivent appliquer les mêmes droits.
- L'administrateur de l'entreprise garde le contrôle de ses données et de son personnel ; le Super Admin ne devient pas un administrateur métier ordinaire.
- Préserver les données existantes et faire évoluer le schéma uniquement par migrations additives et vérifiées.
- Mobile-first pour les opérations terrain, écran large optimisé pour le back-office.
- Interface sobre, lisible, sans dégradés.

## État du code existant — constat initial
Le dépôt contient déjà plusieurs briques métier réutilisables : caisse avec panier et paiements, sessions et mouvements de caisse, catalogue, fournisseurs et commandes d'achat, stocks, inventaires, clients et retours, rapports, dépenses et comptabilité. Le problème principal est leur cohérence produit et leur orchestration : le tableau de bord et la navigation ne donnent pas encore à l'administrateur une vue unifiée de l'ensemble du commerce, et certaines pages combinent trop de responsabilités.

La refonte doit donc commencer par cartographier les flux et les dépendances existants, puis les réunir dans un back-office cohérent. Elle ne doit pas repartir de zéro ni remplacer les données et fonctions déjà opérationnelles.

## Ordre de réalisation
1. **Cartographie et audit métier** : pages, actions serveur, tables, RPC, politiques RLS, statuts et flux de données. Identifier les doublons, fonctions incomplètes et contrôles de droits divergents.
2. **Architecture de navigation** : un tableau de bord administrateur complet, des espaces métier regroupés et un poste POS séparé.
3. **Cycle vente-caisse-stock** : vente, paiement, ticket, session, stock, retour et traçabilité.
4. **Cycle achat-réception-stock** : fournisseur, commande, réception, coût et mise à jour du stock.
5. **Pilotage financier** : rapprochement des caisses, dépenses, marges, comptabilité et rapports cohérents.
6. **Personnel et sécurité** : profils personnalisés, permissions granulaires appliquées aux actions serveur et à RLS.
7. **Tests bout en bout et déploiement** : plusieurs commerces isolés, plusieurs caisses, rôles distincts, paiements, retours, inventaires et contrôles de non-régression.

## Critères de validation
Le produit ne sera considéré conforme que lorsqu'un scénario complet peut être exécuté : l'administrateur configure un commerce, crée ses articles, reçoit un achat, affecte du stock à un magasin, crée un caissier, ouvre une caisse, réalise une vente payée, imprime un ticket, consulte le rapport, contrôle la caisse et retrouve l'ensemble de l'historique. Les mêmes tests doivent être passés avec deux entreprises distinctes pour vérifier l'isolation des données.