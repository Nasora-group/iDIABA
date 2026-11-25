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

Démo : admin@demo.sn / admin123 · caisse@demo.sn / caisse123 · PIN gérant 1234.

La base Supabase de production reste intacte. Un instantané des données a été créé dans le schéma privé idiaba_backup_20261125. Les données Supabase ne sont pas encore importées dans SQLite : effectuer la migration avant bascule opérationnelle. En production, prévoir un disque persistant, un secret JWT fort, CORS restreint et des sauvegardes externes.
