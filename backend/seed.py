import asyncio
from sqlalchemy import select
from app.main import Base,engine,Session,Tenant,User,Warehouse,WarehouseStock,Product,Recipe,Customer,Movement,hasher
async def seed():
 async with engine.begin() as c: await c.run_sync(Base.metadata.create_all)
 async with Session() as db:
  if await db.scalar(select(Tenant).where(Tenant.name=="Ndiaye Distribution & Resto - Dakar")): print("Seed déjà exécuté");return
  t=Tenant(name="Ndiaye Distribution & Resto - Dakar",mode="HYBRIDE",address="Plateau, Dakar, Sénégal",phone="+221 77 000 00 00",ninea="0098765432A2",rc="SN-DKR-2026-B-00000");db.add(t);await db.flush()
  db.add_all([User(tenant_id=t.id,email="admin@demo.sn",name="Administrateur",password_hash=hasher.hash("admin123"),role="ADMIN",pin_hash=hasher.hash("1234")),User(tenant_id=t.id,email="caisse@demo.sn",name="Caissier",password_hash=hasher.hash("caisse123"),role="CAISSIER")])
  w=Warehouse(tenant_id=t.id,name="Boutique Plateau",code="PLT");r=Warehouse(tenant_id=t.id,name="Réserve",code="RES");db.add_all([w,r]);await db.flush()
  data=[("RIZ25","Riz parfumé 25 kg","Alimentation",18000,22000,80),("HUI5","Huile végétale 5 L","Alimentation",6500,8000,50),("SUC1","Sucre 1 kg","Alimentation",600,750,100),("EAU15","Eau minérale 1,5 L","Boissons",250,400,120),("JUS1","Jus de fruits 1 L","Boissons",900,1200,60),("SAV1","Savon de toilette","Cosmétiques",350,500,80),("CRE1","Crème hydratante","Cosmétiques",1800,2500,20),("LAI400","Lait en poudre 400 g","Alimentation",2500,3200,30),("PAP4","Papier hygiénique x4","Hygiène",900,1200,40),("CAF100","Café soluble 100 g","Alimentation",1500,2000,25),("BUR","Burger maison","Restaurant",1100,2500,0),("THI","Thiéboudienne","Restaurant",1600,3500,0),("SAN","Sandwich poulet","Restaurant",900,2000,0)]
  ps={}
  for sku,name,cat,cost,price,stock in data:
   p=Product(tenant_id=t.id,sku=sku,name=name,category=cat,purchase_price=cost,sale_price=price,stock=stock,min_stock=5,kind="COMPOSE" if sku in ("BUR","THI","SAN") else "SIMPLE");db.add(p);await db.flush();ps[sku]=p
   if stock: db.add_all([WarehouseStock(tenant_id=t.id,warehouse_id=w.id,product_id=p.id,quantity=stock),Movement(tenant_id=t.id,warehouse_id=w.id,product_id=p.id,kind="ENTREE_INITIALE",quantity=stock,unit_cost=cost,reference="SEED")])
  for sku,ing,q in [("BUR","RIZ25",.03),("BUR","HUI5",.02),("THI","RIZ25",.12),("THI","HUI5",.03),("SAN","RIZ25",.02),("SAN","HUI5",.01)]: db.add(Recipe(tenant_id=t.id,product_id=ps[sku].id,ingredient_id=ps[ing].id,quantity=q))
  db.add_all([Customer(tenant_id=t.id,name="Client comptoir",phone="+221 77 111 11 11"),Customer(tenant_id=t.id,name="Aminata Fall",phone="+221 76 222 22 22",credit_limit=100000,balance_due=25000),Customer(tenant_id=t.id,name="Entreprise Baobab",phone="+221 78 333 33 33",credit_limit=250000)])
  await db.commit();print("Seed OK. Admin admin@demo.sn/admin123 · Caissier caisse@demo.sn/caisse123 · PIN gérant 1234")
if __name__=="__main__": asyncio.run(seed())
