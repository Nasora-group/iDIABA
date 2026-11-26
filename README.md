# iDIABA 2.0
Gestion commerciale et caisse universelle pour commerces, négoce, retail et restauration au Sénégal.

- Frontend : React + Vite + TypeScript + Zustand + Dexie + PWA.
- Backend : FastAPI + SQLAlchemy async + Pydantic + JWT.
- Base locale : SQLite. FCFA, NINEA, RC, TVA paramétrable.
- Rôles : ADMIN, GERANT, CAISSIER.
- Dépôts, catalogue, recettes, stock journalisé, clients/fournisseurs, sessions de caisse, paiements Wave/Orange Money/Free Money/espèces/carte/crédit, ventes et dashboard.

## Lancement
Terminal backend : `cd backend && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && python seed.py && uvicorn app.main:app --reload`
Terminal frontend : `cd frontend && npm install && npm run dev`

Comptes de démonstration : créés uniquement en environnement local/CI. Le seed de démonstration est désactivé sur Render ; pour l'activer explicitement en environnement de test, définir ENABLE_DEMO_SEED=true.

En local et en CI, l'application utilise SQLite. La production iDIABA V2 utilise PostgreSQL managé sur Render (défini par DATABASE_URL). Le projet Supabase historique est distinct et n'est pas la base runtime de cette version ; son schéma de sauvegarde doit être conservé jusqu'à validation séparée d'une éventuelle reprise de données. Ne pas effectuer de bascule ni de suppression de données sans sauvegarde restaurable et rapprochement des stocks, ventes et soldes.

## Exploitation, sécurité et sauvegardes de production

- La base runtime de production est le PostgreSQL managé Render. Les évolutions de schéma applicatives sont additives ; ne jamais réinitialiser ni supprimer les tables historiques.
- Avant une évolution structurelle sensible : déclencher un export logique depuis Render Dashboard → PostgreSQL → Recovery → Create export, puis télécharger une copie hors de Render.
- Le PostgreSQL de production est sur une offre payante. Render fournit le Point-in-Time Recovery selon le plan de l'espace (fenêtre Hobby : 3 jours ; Pro ou supérieur : 7 jours). Vérifier la fenêtre effective dans Recovery avant toute maintenance.
- Une restauration PITR crée une nouvelle instance. La valider isolément (entreprises, utilisateurs, ventes, soldes clients/fournisseurs, stocks et mouvements) avant de modifier DATABASE_URL. Ne jamais restaurer un export avec des options de suppression dans la base de production active.
- Les exports logiques Render sont conservés 7 jours : télécharger les exports destinés à l'archivage long terme vers un stockage durable sécurisé.
- Les secrets (JWT_SECRET, DATABASE_URL, clés de paiement) restent dans les variables d'environnement Render et ne doivent jamais être committés ou partagés.
- Les routes métier filtrent par tenant_id et les profils personnalisés reçoivent uniquement les permissions nécessaires. Tester les refus 403 et l'impossibilité de lire les données d'une autre entreprise avant chaque mise en production.
- La CI compile le backend, importe l'application, exécute les smoke tests et construit le frontend. Compléter par un test de restauration périodique et un test manuel complet caisse/achats/stock/finance avant une version majeure.

