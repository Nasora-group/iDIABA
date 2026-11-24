# iDIABA

**Logiciel de caisse enregistreuse et de gestion commerciale (ERP) pour tous types de commerces.**

La caisse est le poste de vente quotidien. L'administrateur de chaque entreprise dispose d'un back-office complet pour gérer les ventes, achats, stocks, fournisseurs, clients, caisses, finances, personnel et rapports. Le Super Admin gère la plateforme SaaS et ses entreprises clientes.

- Pas de boutique en ligne ni de commandes clients en ligne.
- Architecture multi-entreprises avec isolation stricte des données.
- Plusieurs établissements, dépôts et caisses.
- Paiements configurables, notamment espèces, Wave et Orange Money.
- Interface caisse rapide et back-office complet, dans l'esprit de gestion de Sage 100.

Le périmètre fonctionnel, les règles métier et les critères de validation sont décrits dans [docs/PRODUCT_SCOPE.md](docs/PRODUCT_SCOPE.md).

Le développement doit préserver les données existantes, privilégier les migrations additives et valider les cycles vente-caisse-stock et achat-réception-stock avant tout déploiement de production.
