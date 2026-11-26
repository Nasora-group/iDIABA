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
