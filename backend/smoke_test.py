import asyncio
from sqlalchemy import select,func
from app.main import Session,Tenant,User,Warehouse,WarehouseStock,Product,Customer,Recipe

async def main():
 async with Session() as db:
  assert await db.scalar(select(func.count(Tenant.id))) == 1
  assert await db.scalar(select(func.count(User.id))) == 2
  assert await db.scalar(select(func.count(Warehouse.id))) == 2
  assert await db.scalar(select(func.count(Product.id))) == 13
  assert await db.scalar(select(func.count(WarehouseStock.id))) == 10
  assert await db.scalar(select(func.count(Customer.id))) == 3
  assert await db.scalar(select(func.count(Recipe.id))) == 6
 print("SMOKE OK: 1 entreprise, 2 utilisateurs, 2 dépôts, 10 stocks-dépôt, 13 produits, 3 clients, 6 composants recette")
asyncio.run(main())
