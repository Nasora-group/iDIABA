import os
import json
from datetime import datetime,date,timedelta,timezone
from typing import Optional
from fastapi import FastAPI,Depends,HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel,Field
from jose import jwt,JWTError
from pwdlib import PasswordHash
from sqlalchemy import String,Float,Integer,Boolean,DateTime,Date,ForeignKey,UniqueConstraint,select,func,cast,text
from sqlalchemy.orm import DeclarativeBase,Mapped,mapped_column
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker,AsyncSession

URL=os.getenv("DATABASE_URL","sqlite+aiosqlite:///./idiaba.db")
if URL.startswith("postgres://"): URL=URL.replace("postgres://","postgresql+asyncpg://",1)
elif URL.startswith("postgresql://"): URL=URL.replace("postgresql://","postgresql+asyncpg://",1)
engine=create_async_engine(URL,connect_args={"check_same_thread":False} if URL.startswith("sqlite") else {})
Session=async_sessionmaker(engine,expire_on_commit=False)
SECRET=os.getenv("JWT_SECRET","dev-secret-change-before-production")
if os.getenv("RENDER") and SECRET=="dev-secret-change-before-production": raise RuntimeError("JWT_SECRET must be configured in production")
hasher=PasswordHash.recommended()
oauth=OAuth2PasswordBearer(tokenUrl="/api/auth/login")
class Base(DeclarativeBase): pass
class Tenant(Base):
 __tablename__="tenants"
 id:Mapped[int]=mapped_column(primary_key=True);name:Mapped[str]=mapped_column(String(160));mode:Mapped[str]=mapped_column(String(20),default="HYBRIDE");address:Mapped[str]=mapped_column(String(200),default="");phone:Mapped[str]=mapped_column(String(40),default="");ninea:Mapped[str]=mapped_column(String(50),default="");rc:Mapped[str]=mapped_column(String(50),default="");currency:Mapped[str]=mapped_column(String(10),default="FCFA");tax_rate:Mapped[float]=mapped_column(Float,default=18)
class User(Base):
 __tablename__="users"
 id:Mapped[int]=mapped_column(primary_key=True);tenant_id:Mapped[Optional[int]]=mapped_column(ForeignKey("tenants.id"),index=True,nullable=True);email:Mapped[str]=mapped_column(String(160),unique=True,index=True);name:Mapped[str]=mapped_column(String(120));password_hash:Mapped[str]=mapped_column(String(255));role:Mapped[str]=mapped_column(String(20),default="CAISSIER");pin_hash:Mapped[Optional[str]]=mapped_column(String(255),nullable=True);active:Mapped[bool]=mapped_column(Boolean,default=True)
class Warehouse(Base):
 __tablename__="warehouses"
 id:Mapped[int]=mapped_column(primary_key=True);tenant_id:Mapped[int]=mapped_column(ForeignKey("tenants.id"),index=True);name:Mapped[str]=mapped_column(String(100));code:Mapped[str]=mapped_column(String(20))
class WarehouseStock(Base):
 __tablename__="warehouse_stocks"
 id:Mapped[int]=mapped_column(primary_key=True);tenant_id:Mapped[int]=mapped_column(ForeignKey("tenants.id"),index=True);warehouse_id:Mapped[int]=mapped_column(ForeignKey("warehouses.id"));product_id:Mapped[int]=mapped_column(ForeignKey("products.id"));quantity:Mapped[float]=mapped_column(Float,default=0)
 __table_args__=(UniqueConstraint("tenant_id","warehouse_id","product_id"),)
class Product(Base):
 __tablename__="products"
 id:Mapped[int]=mapped_column(primary_key=True);tenant_id:Mapped[int]=mapped_column(ForeignKey("tenants.id"),index=True);sku:Mapped[str]=mapped_column(String(50));barcode:Mapped[str]=mapped_column(String(80),default="");name:Mapped[str]=mapped_column(String(150));category:Mapped[str]=mapped_column(String(80),default="Général");unit:Mapped[str]=mapped_column(String(20),default="Pièce");purchase_price:Mapped[float]=mapped_column(Float,default=0);sale_price:Mapped[float]=mapped_column(Float,default=0);tax_rate:Mapped[float]=mapped_column(Float,default=18);stock:Mapped[float]=mapped_column(Float,default=0);min_stock:Mapped[float]=mapped_column(Float,default=0);kind:Mapped[str]=mapped_column(String(20),default="SIMPLE");active:Mapped[bool]=mapped_column(Boolean,default=True)
class Recipe(Base):
 __tablename__="recipes"
 id:Mapped[int]=mapped_column(primary_key=True);tenant_id:Mapped[int]=mapped_column(ForeignKey("tenants.id"),index=True);product_id:Mapped[int]=mapped_column(ForeignKey("products.id"));ingredient_id:Mapped[int]=mapped_column(ForeignKey("products.id"));quantity:Mapped[float]=mapped_column(Float)
class Customer(Base):
 __tablename__="customers"
 id:Mapped[int]=mapped_column(primary_key=True);tenant_id:Mapped[int]=mapped_column(ForeignKey("tenants.id"),index=True);name:Mapped[str]=mapped_column(String(140));phone:Mapped[str]=mapped_column(String(40),default="");credit_limit:Mapped[float]=mapped_column(Float,default=0);balance_due:Mapped[float]=mapped_column(Float,default=0)
class Supplier(Base):
 __tablename__="suppliers"
 id:Mapped[int]=mapped_column(primary_key=True);tenant_id:Mapped[int]=mapped_column(ForeignKey("tenants.id"),index=True);name:Mapped[str]=mapped_column(String(140));phone:Mapped[str]=mapped_column(String(40),default="");balance_due:Mapped[float]=mapped_column(Float,default=0)
class Movement(Base):
 __tablename__="stock_movements"
 id:Mapped[int]=mapped_column(primary_key=True);tenant_id:Mapped[int]=mapped_column(ForeignKey("tenants.id"),index=True);warehouse_id:Mapped[int]=mapped_column(ForeignKey("warehouses.id"));product_id:Mapped[int]=mapped_column(ForeignKey("products.id"));kind:Mapped[str]=mapped_column(String(30));quantity:Mapped[float]=mapped_column(Float);unit_cost:Mapped[float]=mapped_column(Float,default=0);reference:Mapped[str]=mapped_column(String(80),default="");created_at:Mapped[datetime]=mapped_column(DateTime,default=datetime.utcnow)
class Cash(Base):
 __tablename__="cash_sessions"
 id:Mapped[int]=mapped_column(primary_key=True);tenant_id:Mapped[int]=mapped_column(ForeignKey("tenants.id"),index=True);user_id:Mapped[int]=mapped_column(ForeignKey("users.id"));opening:Mapped[float]=mapped_column(Float,default=0);expected:Mapped[float]=mapped_column(Float,default=0);counted:Mapped[Optional[float]]=mapped_column(Float,nullable=True);variance:Mapped[Optional[float]]=mapped_column(Float,nullable=True);status:Mapped[str]=mapped_column(String(12),default="OPEN");opened_at:Mapped[datetime]=mapped_column(DateTime,default=datetime.utcnow);closed_at:Mapped[Optional[datetime]]=mapped_column(DateTime,nullable=True)
class Sale(Base):
 __tablename__="sales"
 __table_args__=(UniqueConstraint("tenant_id","client_sale_id",name="uq_sales_tenant_client_sale"),)
 id:Mapped[int]=mapped_column(primary_key=True);tenant_id:Mapped[int]=mapped_column(ForeignKey("tenants.id"),index=True);user_id:Mapped[int]=mapped_column(ForeignKey("users.id"));customer_id:Mapped[Optional[int]]=mapped_column(ForeignKey("customers.id"),nullable=True);cash_id:Mapped[int]=mapped_column(ForeignKey("cash_sessions.id"));warehouse_id:Mapped[int]=mapped_column(ForeignKey("warehouses.id"));channel:Mapped[str]=mapped_column(String(20),default="COMMERCE");table_name:Mapped[str]=mapped_column(String(40),default="");status:Mapped[str]=mapped_column(String(24),default="PAYE");subtotal:Mapped[float]=mapped_column(Float);tax:Mapped[float]=mapped_column(Float);total:Mapped[float]=mapped_column(Float);client_sale_id:Mapped[Optional[str]]=mapped_column(String(64),nullable=True);change_amount:Mapped[float]=mapped_column(Float,default=0);created_at:Mapped[datetime]=mapped_column(DateTime,default=datetime.utcnow)
class SaleLine(Base):
 __tablename__="sale_lines"
 id:Mapped[int]=mapped_column(primary_key=True);sale_id:Mapped[int]=mapped_column(ForeignKey("sales.id"));product_id:Mapped[int]=mapped_column(ForeignKey("products.id"));label:Mapped[str]=mapped_column(String(150));quantity:Mapped[float]=mapped_column(Float);unit_price:Mapped[float]=mapped_column(Float);total:Mapped[float]=mapped_column(Float)
class Payment(Base):
 __tablename__="payments"
 id:Mapped[int]=mapped_column(primary_key=True);sale_id:Mapped[int]=mapped_column(ForeignKey("sales.id"));method:Mapped[str]=mapped_column(String(24));amount:Mapped[float]=mapped_column(Float);reference:Mapped[str]=mapped_column(String(100),default="")
class Audit(Base):
 __tablename__="audit_logs"
 id:Mapped[int]=mapped_column(primary_key=True);tenant_id:Mapped[int]=mapped_column(ForeignKey("tenants.id"),index=True);user_id:Mapped[int]=mapped_column(ForeignKey("users.id"));action:Mapped[str]=mapped_column(String(80));detail:Mapped[str]=mapped_column(String(500),default="");created_at:Mapped[datetime]=mapped_column(DateTime,default=datetime.utcnow)

async def dbdep():
 async with Session() as s: yield s
async def init():
 async with engine.begin() as c: await c.run_sync(Base.metadata.create_all)
async def auth(token:str=Depends(oauth),db:AsyncSession=Depends(dbdep)):
 try: uid=int(jwt.decode(token,SECRET,algorithms=["HS256"])["sub"])
 except (JWTError,ValueError,KeyError): raise HTTPException(401,"Session invalide")
 u=await db.get(User,uid)
 if not u or not u.active: raise HTTPException(401,"Compte inactif")
 return u
async def tenant_auth(u:User=Depends(auth),db:AsyncSession=Depends(dbdep)):
 if u.role == "SUPER_ADMIN" or u.tenant_id is None:
  raise HTTPException(403,"Le Super Admin doit utiliser exclusivement le portail de gestion des entreprises")
 subscription=(await db.execute(text("SELECT status, ends_at FROM subscriptions WHERE tenant_id = :tenant_id"),{"tenant_id":u.tenant_id})).mappings().first()
 if not subscription:
  raise HTTPException(402,"Abonnement introuvable. Contactez l'administrateur de la plateforme.")
 status=str(subscription["status"] or "").upper()
 if status in {"SUSPENDU","RESILIE"}:
  raise HTTPException(402,"Abonnement suspendu ou résilié. Contactez l'administrateur de la plateforme.")
 if status not in {"ESSAI","ACTIF"}:
  raise HTTPException(402,"Statut d'abonnement non valide. Contactez l'administrateur de la plateforme.")
 ends_at=subscription["ends_at"]
 if ends_at is not None:
  if ends_at.tzinfo is None:
   ends_at=ends_at.replace(tzinfo=timezone.utc)
  if ends_at <= datetime.now(timezone.utc):
   raise HTTPException(402,"Abonnement arrivé à échéance. Renouvelez votre abonnement.")
 return u
def roles(*allowed, permission=None):
 async def check(u:User=Depends(tenant_auth),db:AsyncSession=Depends(dbdep)):
  if u.role in allowed: return u
  from app.advanced import RoleProfile
  profile=await db.scalar(select(RoleProfile).where(RoleProfile.tenant_id==u.tenant_id,RoleProfile.role_key==u.role,RoleProfile.active.is_(True)))
  permissions=set(json.loads(profile.permissions or "[]")) if profile else set()
  required=permission or ("users.write" if allowed==("ADMIN",) else ("stock.write" if "STOCK" in allowed else "reports.read"))
  if required not in permissions: raise HTTPException(403,"Droit insuffisant pour cette opération")
  return u
 return check
app=FastAPI(title="iDIABA API",version="2.0")
app.add_middleware(CORSMiddleware,allow_origins=os.getenv("CORS_ORIGINS","http://localhost:5173").split(","),allow_credentials=True,allow_methods=["*"],allow_headers=["*"])
@app.on_event("startup")
async def startup():
 print("[startup] Initialisation du schéma", flush=True)
 await init()
 if engine.dialect.name == "postgresql":
  async with engine.begin() as connection:
   await connection.execute(text("ALTER TABLE users ALTER COLUMN tenant_id DROP NOT NULL"))
   await connection.execute(text("UPDATE users SET tenant_id = NULL WHERE role = 'SUPER_ADMIN' AND tenant_id IS NOT NULL"))
   await connection.execute(text("ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_sale_id VARCHAR(64)"))
   await connection.execute(text("ALTER TABLE sales ADD COLUMN IF NOT EXISTS change_amount DOUBLE PRECISION NOT NULL DEFAULT 0"))
   await connection.execute(text("ALTER TABLE registration_requests ALTER COLUMN password_hash DROP NOT NULL"))
   await connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_tenant_client_sale ON sales (tenant_id, client_sale_id) WHERE client_sale_id IS NOT NULL"))
   await connection.execute(text("INSERT INTO subscriptions (tenant_id, plan, status, monthly_price, starts_at) SELECT id, 'ESSENTIEL', 'ESSAI', 0, CURRENT_TIMESTAMP FROM tenants ON CONFLICT (tenant_id) DO NOTHING"))
   # Neutralise uniquement les deux comptes de démonstration publics historiques.
   # Les entreprises, ventes et autres données associées sont conservées.
   demo_result=await connection.execute(text("UPDATE users SET active = FALSE WHERE lower(email) IN ('admin@demo.sn','caisse@demo.sn') AND active = TRUE"))
   if demo_result.rowcount:
    print(f"[startup] {demo_result.rowcount} compte(s) de démonstration désactivé(s)", flush=True)
  print("[startup] Isolation du compte Super Admin et contrôle des abonnements appliqués", flush=True)
 elif engine.dialect.name == "sqlite":
  async with engine.begin() as connection:
   columns={row[1] for row in (await connection.execute(text("PRAGMA table_info(sales)"))).all()}
   if "client_sale_id" not in columns:
    await connection.execute(text("ALTER TABLE sales ADD COLUMN client_sale_id VARCHAR(64)"))
   if "change_amount" not in columns:
    await connection.execute(text("ALTER TABLE sales ADD COLUMN change_amount FLOAT NOT NULL DEFAULT 0"))
   await connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_tenant_client_sale ON sales (tenant_id, client_sale_id) WHERE client_sale_id IS NOT NULL"))
   await connection.execute(text("INSERT OR IGNORE INTO subscriptions (tenant_id, plan, status, monthly_price, starts_at) SELECT id, 'ESSENTIEL', 'ESSAI', 0, CURRENT_TIMESTAMP FROM tenants"))
 print("[startup] Initialisation des données de démonstration", flush=True)
 # Import différé : seed.py réutilise les modèles et la session de ce module.
 from seed import seed
 await seed()
 print("[startup] Application prête", flush=True)
@app.get("/api/health")
async def health(): return {"status":"ok","service":"idiaba"}
class Login(BaseModel): email:str;password:str
@app.post("/api/auth/login")
async def login(x:Login,db:AsyncSession=Depends(dbdep)):
 u=await db.scalar(select(User).where(User.email==x.email.lower(),User.active.is_(True)))
 if not u or not hasher.verify(x.password,u.password_hash): raise HTTPException(401,"Identifiants incorrects")
 if u.tenant_id is not None:
  subscription=(await db.execute(text("SELECT status, ends_at FROM subscriptions WHERE tenant_id = :tenant_id"),{"tenant_id":u.tenant_id})).mappings().first()
  if not subscription: raise HTTPException(402,"Compte en attente de validation par la plateforme.")
  status=str(subscription["status"] or "").upper()
  if status not in {"ESSAI","ACTIF"}: raise HTTPException(402,"Entreprise enregistree. Acces disponible apres activation de l abonnement par iDIABA.")
  ends_at=subscription["ends_at"]
  if ends_at is not None:
   if ends_at.tzinfo is None: ends_at=ends_at.replace(tzinfo=timezone.utc)
   if ends_at <= datetime.now(timezone.utc): raise HTTPException(402,"Abonnement arrive a echeance. Contactez iDIABA.")
 exp=datetime.now(timezone.utc)+timedelta(hours=12)
 t=await db.get(Tenant,u.tenant_id) if u.tenant_id is not None else None
 tenant_data=None if t is None else {"name":t.name,"mode":t.mode,"currency":t.currency}
 return {"access_token":jwt.encode({"sub":str(u.id),"exp":exp},SECRET,algorithm="HS256"),"user":{"id":u.id,"name":u.name,"email":u.email,"role":u.role,"tenant_id":u.tenant_id},"tenant":tenant_data}
@app.get("/api/auth/me")
async def me(u:User=Depends(auth)): return {"id":u.id,"name":u.name,"email":u.email,"role":u.role,"tenant_id":u.tenant_id}
@app.get("/api/warehouses")
async def warehouses(u:User=Depends(tenant_auth),db:AsyncSession=Depends(dbdep)):
 return [{"id":x.id,"name":x.name,"code":x.code} for x in (await db.scalars(select(Warehouse).where(Warehouse.tenant_id==u.tenant_id))).all()]
@app.get("/api/products")
async def products(u:User=Depends(roles("ADMIN","GERANT","STOCK","CAISSIER","VENDEUR",permission="catalog.read")),db:AsyncSession=Depends(dbdep)):
 return [{"id":p.id,"sku":p.sku,"barcode":p.barcode,"name":p.name,"category":p.category,"unit":p.unit,"purchase_price":p.purchase_price,"sale_price":p.sale_price,"tax_rate":p.tax_rate,"stock":p.stock,"min_stock":p.min_stock,"kind":p.kind} for p in (await db.scalars(select(Product).where(Product.tenant_id==u.tenant_id,Product.active.is_(True)).order_by(Product.name))).all()]
class ProductIn(BaseModel):
 sku:str=Field(min_length=1,max_length=50);name:str=Field(min_length=1,max_length=150);barcode:str="";category:str="Général";unit:str=Field(default="Pièce",min_length=1,max_length=20);purchase_price:float=Field(default=0,ge=0);sale_price:float=Field(ge=0);tax_rate:float=Field(default=18,ge=0,le=100);min_stock:float=Field(default=0,ge=0);kind:str="SIMPLE"
@app.post("/api/products")
async def add_product(x:ProductIn,u:User=Depends(roles("ADMIN","GERANT","STOCK",permission="catalog.write")),db:AsyncSession=Depends(dbdep)):
 p=Product(tenant_id=u.tenant_id,**x.model_dump());db.add(p)
 try:
  await db.commit()
 except IntegrityError:
  await db.rollback();raise HTTPException(409,"Cette référence existe déjà")
 await db.refresh(p);return {"id":p.id,"name":p.name}
def unit_conversion(old_unit:str,new_unit:str):
 scales={"mg":("mass",0.000001),"g":("mass",0.001),"kg":("mass",1),"ml":("volume",0.001),"L":("volume",1),"cm":("length",0.01),"m":("length",1),"Pièce":("count",1),"Unité":("count",1)}
 if old_unit==new_unit:return 1.0
 old=scales.get(old_unit);new=scales.get(new_unit)
 if not old or not new or old[0]!=new[0]: raise HTTPException(409,"Changement d'unité impossible : choisissez une unité de la même famille. Les unités de stock ne sont pas interchangeables.")
 return old[1]/new[1]
@app.put("/api/products/{product_id}")
async def update_product(product_id:int,x:ProductIn,u:User=Depends(roles("ADMIN","GERANT","STOCK",permission="catalog.write")),db:AsyncSession=Depends(dbdep)):
 p=await db.scalar(select(Product).where(Product.id==product_id,Product.tenant_id==u.tenant_id).with_for_update())
 if not p: raise HTTPException(404,"Produit introuvable")
 factor=unit_conversion(p.unit,x.unit)
 if abs(factor-1.0)>1e-12:
  from app.advanced import PurchaseLine,InventoryLine,StockTransferLine,RefundLine,KitchenOrderLine
  stocks=(await db.scalars(select(WarehouseStock).where(WarehouseStock.tenant_id==u.tenant_id,WarehouseStock.product_id==p.id).with_for_update())).all()
  for row in stocks: row.quantity*=factor
  recipes=(await db.scalars(select(Recipe).where(Recipe.tenant_id==u.tenant_id,Recipe.ingredient_id==p.id))).all()
  for row in recipes: row.quantity*=factor
  purchases=(await db.scalars(select(PurchaseLine).where(PurchaseLine.product_id==p.id))).all()
  for row in purchases: row.quantity*=factor;row.received*=factor;row.unit_cost/=factor
  sales=(await db.scalars(select(SaleLine).where(SaleLine.product_id==p.id))).all()
  for row in sales: row.quantity*=factor;row.unit_price/=factor
  movements=(await db.scalars(select(Movement).where(Movement.tenant_id==u.tenant_id,Movement.product_id==p.id))).all()
  for row in movements: row.quantity*=factor;row.unit_cost/=factor
  inventory_lines=(await db.scalars(select(InventoryLine).where(InventoryLine.product_id==p.id))).all()
  for row in inventory_lines: row.theoretical*=factor;row.counted*=factor;row.difference*=factor
  transfer_lines=(await db.scalars(select(StockTransferLine).where(StockTransferLine.product_id==p.id))).all()
  for row in transfer_lines: row.quantity*=factor;row.unit_cost/=factor
  refund_lines=(await db.scalars(select(RefundLine).where(RefundLine.product_id==p.id))).all()
  for row in refund_lines: row.quantity*=factor
  p.stock*=factor;p.min_stock*=factor;p.purchase_price/=factor;p.sale_price/=factor
 for key,value in x.model_dump().items(): setattr(p,key,value)
 try:
  await db.commit()
 except IntegrityError:
  await db.rollback();raise HTTPException(409,"Référence ou code-barres déjà utilisé")
 return {"id":p.id,"name":p.name,"updated":True,"unit_converted":abs(factor-1.0)>1e-12,"conversion_factor":factor}
class ProductImportLine(BaseModel):
 sku:str=Field(min_length=1,max_length=50);name:str=Field(min_length=1,max_length=150);barcode:str="";category:str="Général";unit:str=Field(default="Pièce",min_length=1,max_length=20);purchase_price:float=Field(default=0,ge=0);sale_price:float=Field(default=0,ge=0);tax_rate:float=Field(default=18,ge=0,le=100);min_stock:float=Field(default=0,ge=0);quantity:float=Field(default=0,ge=0);kind:str="SIMPLE"
class ProductImport(BaseModel):
 warehouse_id:int;mode:str="REPLACE";items:list[ProductImportLine]=Field(min_length=1,max_length=2000)
@app.post("/api/products/import")
async def import_products(x:ProductImport,u:User=Depends(roles("ADMIN","GERANT","STOCK")),db:AsyncSession=Depends(dbdep)):
 if x.mode not in {"REPLACE","ADD"}: raise HTTPException(400,"Mode d'importation invalide")
 warehouse=await db.scalar(select(Warehouse).where(Warehouse.id==x.warehouse_id,Warehouse.tenant_id==u.tenant_id))
 if not warehouse: raise HTTPException(404,"Dépôt introuvable")
 normalized=[item.sku.strip().casefold() for item in x.items]
 if len(normalized)!=len(set(normalized)): raise HTTPException(400,"Le fichier contient des références en double")
 created=updated=stock_changes=0
 try:
  for item in x.items:
   values=item.model_dump();quantity=values.pop("quantity");sku=values["sku"].strip()
   product=await db.scalar(select(Product).where(Product.tenant_id==u.tenant_id,Product.sku==sku).with_for_update())
   if product is None:
    product=Product(tenant_id=u.tenant_id,**values);db.add(product);await db.flush();created+=1
   else:
    if product.unit!=values["unit"]:
     raise HTTPException(409,f"Unité différente pour {sku}. Modifiez d'abord l'unité dans le catalogue pour appliquer la conversion correctement.")
    for key,value in values.items(): setattr(product,key,value)
    updated+=1
   stock=await db.scalar(select(WarehouseStock).where(WarehouseStock.tenant_id==u.tenant_id,WarehouseStock.warehouse_id==warehouse.id,WarehouseStock.product_id==product.id).with_for_update())
   current=stock.quantity if stock else 0.0
   target=quantity if x.mode=="REPLACE" else current+quantity
   delta=target-current
   if stock is None:
    stock=WarehouseStock(tenant_id=u.tenant_id,warehouse_id=warehouse.id,product_id=product.id,quantity=target);db.add(stock)
   else: stock.quantity=target
   product.stock=(product.stock or 0)+delta
   if abs(delta)>1e-9:
    db.add(Movement(tenant_id=u.tenant_id,warehouse_id=warehouse.id,product_id=product.id,kind="IMPORT_CATALOGUE",quantity=delta,unit_cost=product.purchase_price,reference="IMPORT-EXCEL"))
    stock_changes+=1
  db.add(Audit(tenant_id=u.tenant_id,user_id=u.id,action="IMPORT_CATALOGUE",detail=f"Import {len(x.items)} produits · {created} créés · {updated} modifiés"))
  await db.commit()
 except IntegrityError:
  await db.rollback();raise HTTPException(409,"Import annulé : référence ou code-barres déjà utilisé. Aucune ligne n'a été enregistrée.")
 except Exception:
  await db.rollback();raise
 return {"imported":len(x.items),"created":created,"updated":updated,"stock_changes":stock_changes,"mode":x.mode}
@app.get("/api/customers")
async def customers(u:User=Depends(roles("ADMIN","GERANT","CAISSIER","VENDEUR",permission="customers.read")),db:AsyncSession=Depends(dbdep)):
 return [{"id":x.id,"name":x.name,"phone":x.phone,"credit_limit":x.credit_limit,"balance_due":x.balance_due} for x in (await db.scalars(select(Customer).where(Customer.tenant_id==u.tenant_id))).all()]
class CustomerIn(BaseModel):
 name:str;phone:str="";credit_limit:float=Field(ge=0)
@app.post("/api/customers")
async def customer_create(x:CustomerIn,u:User=Depends(roles("ADMIN","GERANT",permission="customers.write")),db:AsyncSession=Depends(dbdep)):
 c=Customer(tenant_id=u.tenant_id,**x.model_dump());db.add(c);await db.commit();await db.refresh(c);return {"id":c.id,"name":c.name}
@app.get("/api/suppliers")
async def suppliers(u:User=Depends(roles("ADMIN","GERANT",permission="suppliers.read")),db:AsyncSession=Depends(dbdep)):
 return [{"id":x.id,"name":x.name,"phone":x.phone,"balance_due":x.balance_due} for x in (await db.scalars(select(Supplier).where(Supplier.tenant_id==u.tenant_id))).all()]
class SupplierIn(BaseModel):
 name:str;phone:str=""
@app.post("/api/suppliers")
async def supplier_create(x:SupplierIn,u:User=Depends(roles("ADMIN","GERANT",permission="suppliers.write")),db:AsyncSession=Depends(dbdep)):
 c=Supplier(tenant_id=u.tenant_id,**x.model_dump());db.add(c);await db.commit();await db.refresh(c);return {"id":c.id,"name":c.name}
class OpenCash(BaseModel): opening:float=Field(ge=0)
@app.get("/api/cash/current")
async def cash_current(u:User=Depends(roles("ADMIN","GERANT","CAISSIER",permission="cash.read")),db:AsyncSession=Depends(dbdep)):
 c=await db.scalar(select(Cash).where(Cash.tenant_id==u.tenant_id,Cash.user_id==u.id,Cash.status=="OPEN"))
 return None if not c else {"id":c.id,"opening":c.opening,"expected":c.expected}
@app.post("/api/cash/open")
async def cash_open(x:OpenCash,u:User=Depends(roles("ADMIN","GERANT","CAISSIER",permission="cash.open")),db:AsyncSession=Depends(dbdep)):
 if await db.scalar(select(Cash).where(Cash.tenant_id==u.tenant_id,Cash.user_id==u.id,Cash.status=="OPEN")): raise HTTPException(409,"Caisse déjà ouverte")
 c=Cash(tenant_id=u.tenant_id,user_id=u.id,opening=x.opening,expected=x.opening);db.add(c);await db.commit();await db.refresh(c);return {"id":c.id,"status":c.status}
class CloseCash(BaseModel): counted:float=Field(ge=0)
@app.post("/api/cash/{cid}/close")
async def cash_close(cid:int,x:CloseCash,u:User=Depends(roles("ADMIN","GERANT","CAISSIER",permission="cash.close")),db:AsyncSession=Depends(dbdep)):
 c=await db.scalar(select(Cash).where(Cash.id==cid,Cash.tenant_id==u.tenant_id,Cash.user_id==u.id,Cash.status=="OPEN"))
 if not c: raise HTTPException(404,"Session introuvable")
 c.counted=x.counted;c.variance=x.counted-c.expected;c.status="CLOSED";c.closed_at=datetime.utcnow();await db.commit();return {"expected":c.expected,"counted":c.counted,"variance":c.variance}
class LineIn(BaseModel): product_id:int;quantity:float=Field(gt=0)
class PayIn(BaseModel): method:str;amount:float=Field(gt=0);reference:str=""
class SaleIn(BaseModel):
 warehouse_id:int;customer_id:Optional[int]=None;channel:str="COMMERCE";table_name:str="";lines:list[LineIn];payments:list[PayIn];client_sale_id:Optional[str]=Field(default=None,min_length=8,max_length=64)
def aggregate_sale_lines(lines:list[LineIn]):
 combined={}
 for line in lines:
  combined[line.product_id]=combined.get(line.product_id,0)+line.quantity
 return sorted(combined.items())
def payment_settlement(total:float,payments:list[PayIn]):
 credit=round(sum(p.amount for p in payments if p.method=="CREDIT_CLIENT"),2)
 if credit>total: raise HTTPException(400,"Le crédit client dépasse le total de la vente")
 amount_due=round(total-credit,2)
 paid=round(sum(p.amount for p in payments if p.method!="CREDIT_CLIENT"),2)
 if paid<amount_due: raise HTTPException(400,"Paiement insuffisant")
 change=round(paid-amount_due,2)
 cash_tendered=sum(p.amount for p in payments if p.method=="ESPECES")
 if change>cash_tendered: raise HTTPException(400,"La monnaie doit être rendue sur le paiement en espèces")
 return credit,change
@app.post("/api/sales")
async def sale_create(x:SaleIn,u:User=Depends(roles("ADMIN","GERANT","CAISSIER","VENDEUR",permission="sales.write")),db:AsyncSession=Depends(dbdep)):
 tenant_id=u.tenant_id
 if x.client_sale_id:
  existing=await db.scalar(select(Sale).where(Sale.tenant_id==tenant_id,Sale.client_sale_id==x.client_sale_id))
  if existing:
   return {"id":existing.id,"status":existing.status,"total":existing.total,"change":existing.change_amount}
 if not x.lines or not x.payments: raise HTTPException(400,"La vente doit contenir au moins un article et un paiement")
 allowed_methods={"ESPECES","WAVE","ORANGE_MONEY","FREE_MONEY","CARTE_BANCAIRE","CREDIT_CLIENT"}
 if any(p.method not in allowed_methods for p in x.payments): raise HTTPException(400,"Mode de paiement non pris en charge")
 cash=await db.scalar(select(Cash).where(Cash.tenant_id==u.tenant_id,Cash.user_id==u.id,Cash.status=="OPEN").with_for_update())
 wh=await db.scalar(select(Warehouse).where(Warehouse.id==x.warehouse_id,Warehouse.tenant_id==u.tenant_id))
 if not cash or not wh: raise HTTPException(409,"Ouvrez la caisse et sélectionnez un dépôt")
 customer=None
 if x.customer_id:
  customer=await db.scalar(select(Customer).where(Customer.id==x.customer_id,Customer.tenant_id==u.tenant_id).with_for_update())
  if not customer: raise HTTPException(404,"Client introuvable")
 items=[];subtotal=0;tax=0
 for product_id,quantity in aggregate_sale_lines(x.lines):
  p=await db.scalar(select(Product).where(Product.id==product_id,Product.tenant_id==u.tenant_id,Product.active.is_(True)).with_for_update())
  if not p: raise HTTPException(404,"Article introuvable")
  warehouse_stock=await db.scalar(select(WarehouseStock).where(WarehouseStock.tenant_id==u.tenant_id,WarehouseStock.warehouse_id==wh.id,WarehouseStock.product_id==p.id).with_for_update())
  recipe=[]
  if p.kind=="COMPOSE":
   recipe=(await db.scalars(select(Recipe).where(Recipe.tenant_id==u.tenant_id,Recipe.product_id==p.id).order_by(Recipe.ingredient_id))).all()
   if not recipe: raise HTTPException(409,f"Fiche recette absente : {p.name}")
   for part in recipe:
    ingredient=await db.scalar(select(Product).where(Product.id==part.ingredient_id,Product.tenant_id==u.tenant_id).with_for_update())
    ingredient_stock=await db.scalar(select(WarehouseStock).where(WarehouseStock.tenant_id==u.tenant_id,WarehouseStock.warehouse_id==wh.id,WarehouseStock.product_id==part.ingredient_id).with_for_update())
    if not ingredient or not ingredient_stock or ingredient_stock.quantity<part.quantity*quantity: raise HTTPException(409,f"Stock ingrédient insuffisant : {ingredient.name if ingredient else 'inconnu'}")
  elif not warehouse_stock or warehouse_stock.quantity<quantity: raise HTTPException(409,f"Stock insuffisant : {p.name}")
  st=p.sale_price*quantity;items.append((p,quantity,st,recipe));subtotal+=st;tax+=st*p.tax_rate/100
 total=round(subtotal+tax,2)
 credit,change=payment_settlement(total,x.payments)
 if credit and not customer: raise HTTPException(400,"Client obligatoire pour un crédit")
 if credit and customer.balance_due+credit>customer.credit_limit: raise HTTPException(409,"Plafond crédit dépassé")
 async def duplicate_result():
  await db.rollback()
  if x.client_sale_id:
   existing=await db.scalar(select(Sale).where(Sale.tenant_id==tenant_id,Sale.client_sale_id==x.client_sale_id))
   if existing:
    return {"id":existing.id,"status":existing.status,"total":existing.total,"change":existing.change_amount}
  raise HTTPException(409,"Conflit lors de l’enregistrement de la vente. Vérifiez la vente avant de recommencer.")
 s=Sale(tenant_id=u.tenant_id,user_id=u.id,customer_id=x.customer_id,cash_id=cash.id,warehouse_id=wh.id,channel=x.channel,table_name=x.table_name,status="PAYE",subtotal=subtotal,tax=tax,total=total,client_sale_id=x.client_sale_id,change_amount=change);db.add(s)
 try:
  await db.flush()
 except IntegrityError:
  return await duplicate_result()
 for p,q,st,recipe in items:
  db.add(SaleLine(sale_id=s.id,product_id=p.id,label=p.name,quantity=q,unit_price=p.sale_price,total=st))
  if recipe:
   for part in recipe:
    ingredient=await db.scalar(select(Product).where(Product.id==part.ingredient_id,Product.tenant_id==u.tenant_id).with_for_update())
    ingredient.stock-=part.quantity*q
    ingredient_stock=await db.scalar(select(WarehouseStock).where(WarehouseStock.tenant_id==u.tenant_id,WarehouseStock.warehouse_id==wh.id,WarehouseStock.product_id==ingredient.id))
    ingredient_stock.quantity-=part.quantity*q
    db.add(Movement(tenant_id=u.tenant_id,warehouse_id=wh.id,product_id=ingredient.id,kind="SORTIE_VENTE_RECETTE",quantity=-part.quantity*q,unit_cost=ingredient.purchase_price,reference=f"VTE-{s.id}"))
  else:
   p.stock-=q
   warehouse_stock=await db.scalar(select(WarehouseStock).where(WarehouseStock.tenant_id==u.tenant_id,WarehouseStock.warehouse_id==wh.id,WarehouseStock.product_id==p.id).with_for_update())
   warehouse_stock.quantity-=q
   db.add(Movement(tenant_id=u.tenant_id,warehouse_id=wh.id,product_id=p.id,kind="SORTIE_VENTE",quantity=-q,unit_cost=p.purchase_price,reference=f"VTE-{s.id}"))
 change_remaining=change
 for p in x.payments:
  applied=round(p.amount,2)
  if p.method=="ESPECES" and change_remaining>0:
   reduction=min(applied,change_remaining)
   applied=round(applied-reduction,2)
   change_remaining=round(change_remaining-reduction,2)
  db.add(Payment(sale_id=s.id,method=p.method,amount=applied,reference=p.reference))
  if p.method=="ESPECES": cash.expected+=applied
 if credit: customer.balance_due+=credit
 db.add(Audit(tenant_id=u.tenant_id,user_id=u.id,action="VENTE",detail=f"Vente {s.id} - {total:.0f} FCFA"))
 try:
  await db.commit()
 except IntegrityError:
  return await duplicate_result()
 return {"id":s.id,"status":s.status,"total":total,"change":change}
class StockIn(BaseModel): warehouse_id:int;product_id:int;quantity:float;unit_cost:float=0;kind:str="ENTREE_ACHAT"
@app.get("/api/stock/movements")
async def stock_movements(u:User=Depends(roles("ADMIN","GERANT","STOCK",permission="stock.read")),db:AsyncSession=Depends(dbdep)):
 rows=(await db.scalars(select(Movement).where(Movement.tenant_id==u.tenant_id).order_by(Movement.created_at.desc()).limit(200))).all()
 return [{"id":x.id,"warehouse_id":x.warehouse_id,"product_id":x.product_id,"kind":x.kind,"quantity":x.quantity,"unit_cost":x.unit_cost,"reference":x.reference,"created_at":x.created_at} for x in rows]
@app.post("/api/stock/movements")
async def stock_move(x:StockIn,u:User=Depends(roles("ADMIN","GERANT","STOCK",permission="stock.write")),db:AsyncSession=Depends(dbdep)):
 p=await db.scalar(select(Product).where(Product.id==x.product_id,Product.tenant_id==u.tenant_id));w=await db.scalar(select(Warehouse).where(Warehouse.id==x.warehouse_id,Warehouse.tenant_id==u.tenant_id))
 if not p or not w: raise HTTPException(404,"Article ou dépôt introuvable")
 ws=await db.scalar(select(WarehouseStock).where(WarehouseStock.tenant_id==u.tenant_id,WarehouseStock.warehouse_id==w.id,WarehouseStock.product_id==p.id))
 if not ws: ws=WarehouseStock(tenant_id=u.tenant_id,warehouse_id=w.id,product_id=p.id,quantity=0);db.add(ws)
 if x.kind=="PERTE_CASSE" and ws.quantity<x.quantity: raise HTTPException(409,"Stock insuffisant dans ce dépôt")
 delta=-x.quantity if x.kind=="PERTE_CASSE" else x.quantity
 p.stock+=delta;ws.quantity+=delta
 db.add(Movement(tenant_id=u.tenant_id,**x.model_dump()));await db.commit();return {"stock":p.stock}
class TransferIn(BaseModel): from_warehouse_id:int;to_warehouse_id:int;product_id:int;quantity:float=Field(gt=0)
@app.post("/api/stock/transfers")
async def transfer(x:TransferIn,u:User=Depends(roles("ADMIN","GERANT","STOCK",permission="stock.write")),db:AsyncSession=Depends(dbdep)):
 p=await db.scalar(select(Product).where(Product.id==x.product_id,Product.tenant_id==u.tenant_id))
 wh=(await db.scalars(select(Warehouse).where(Warehouse.tenant_id==u.tenant_id,Warehouse.id.in_([x.from_warehouse_id,x.to_warehouse_id])))).all()
 if not p or len(wh)!=2 or x.from_warehouse_id==x.to_warehouse_id: raise HTTPException(409,"Transfert impossible")
 source=await db.scalar(select(WarehouseStock).where(WarehouseStock.tenant_id==u.tenant_id,WarehouseStock.warehouse_id==x.from_warehouse_id,WarehouseStock.product_id==p.id))
 target=await db.scalar(select(WarehouseStock).where(WarehouseStock.tenant_id==u.tenant_id,WarehouseStock.warehouse_id==x.to_warehouse_id,WarehouseStock.product_id==p.id))
 if not source or source.quantity<x.quantity: raise HTTPException(409,"Stock insuffisant dans le dépôt source")
 source.quantity-=x.quantity
 if not target: target=WarehouseStock(tenant_id=u.tenant_id,warehouse_id=x.to_warehouse_id,product_id=p.id,quantity=0);db.add(target) 
 target.quantity+=x.quantity
 for wid,k,q in [(x.from_warehouse_id,"TRANSFERT_SORTIE",-x.quantity),(x.to_warehouse_id,"TRANSFERT_ENTREE",x.quantity)]: db.add(Movement(tenant_id=u.tenant_id,warehouse_id=wid,product_id=p.id,kind=k,quantity=q,unit_cost=p.purchase_price,reference="Transfert"))
 await db.commit();return {"status":"OK"}
@app.get("/api/dashboard")
async def dashboard(u:User=Depends(roles("ADMIN","GERANT",permission="reports.read")),db:AsyncSession=Depends(dbdep)):
 today=date.today()
 # Comparaison DATE/DATE explicite : PostgreSQL refuse DATE = VARCHAR.
 today_filter=cast(Sale.created_at,Date)==today
 rev=await db.scalar(select(func.coalesce(func.sum(Sale.total),0)).where(Sale.tenant_id==u.tenant_id,today_filter))
 sales=await db.scalar(select(func.count(Sale.id)).where(Sale.tenant_id==u.tenant_id,today_filter))
 low=(await db.scalars(select(Product).where(Product.tenant_id==u.tenant_id,Product.stock<=Product.min_stock))).all()
 debts=(await db.scalars(select(Customer).where(Customer.tenant_id==u.tenant_id,Customer.balance_due>0))).all()
 return {"revenue_today":rev or 0,"sales_today":sales or 0,"low_stock":[{"name":p.name,"stock":p.stock} for p in low],"receivables":[{"name":c.name,"balance_due":c.balance_due} for c in debts]}
@app.get("/api/sales")
async def sales(u:User=Depends(roles("ADMIN","GERANT","CAISSIER","VENDEUR",permission="sales.read")),db:AsyncSession=Depends(dbdep)):
 return [{"id":s.id,"total":s.total,"status":s.status,"created_at":s.created_at} for s in (await db.scalars(select(Sale).where(Sale.tenant_id==u.tenant_id).order_by(Sale.created_at.desc()).limit(100))).all()]



# Administration des comptes : les comptes sont toujours isolés par entreprise.
USER_ROLES={"ADMIN","GERANT","CAISSIER","STOCK","VENDEUR"}
class UserCreate(BaseModel):
 name:str=Field(min_length=2,max_length=120)
 email:str=Field(min_length=5,max_length=160)
 password:str=Field(min_length=8,max_length=128)
 role:str="CAISSIER"
class UserUpdate(BaseModel):
 name:Optional[str]=Field(default=None,min_length=2,max_length=120)
 role:Optional[str]=None
 active:Optional[bool]=None
 password:Optional[str]=Field(default=None,min_length=8,max_length=128)
@app.get("/api/users")
async def users_list(u:User=Depends(roles("ADMIN",permission="users.read")),db:AsyncSession=Depends(dbdep)):
 rows=(await db.scalars(select(User).where(User.tenant_id==u.tenant_id).order_by(User.name))).all()
 return [{"id":x.id,"name":x.name,"email":x.email,"role":x.role,"active":x.active} for x in rows]
@app.post("/api/users")
async def users_create(x:UserCreate,u:User=Depends(roles("ADMIN",permission="users.write")),db:AsyncSession=Depends(dbdep)):
 email=x.email.strip().lower()
 if x.role not in USER_ROLES:
  from app.advanced import RoleProfile
  if not await db.scalar(select(RoleProfile).where(RoleProfile.tenant_id==u.tenant_id,RoleProfile.role_key==x.role,RoleProfile.active.is_(True))): raise HTTPException(400,"Profil non autorisé")
 if await db.scalar(select(User).where(User.email==email)): raise HTTPException(409,"Cette adresse e-mail est déjà utilisée")
 item=User(tenant_id=u.tenant_id,name=x.name.strip(),email=email,password_hash=hasher.hash(x.password),role=x.role,active=True)
 db.add(item);await db.flush()
 db.add(Audit(tenant_id=u.tenant_id,user_id=u.id,action="CREATION_UTILISATEUR",detail=f"Compte créé : {email} ({x.role})"))
 await db.commit();await db.refresh(item)
 return {"id":item.id,"name":item.name,"email":item.email,"role":item.role,"active":item.active}
@app.post("/api/users/{uid}/update")
async def users_update(uid:int,x:UserUpdate,u:User=Depends(roles("ADMIN",permission="users.write")),db:AsyncSession=Depends(dbdep)):
 item=await db.scalar(select(User).where(User.id==uid,User.tenant_id==u.tenant_id))
 if not item: raise HTTPException(404,"Utilisateur introuvable")
 changes=x.model_dump(exclude_unset=True)
 if "role" in changes and changes["role"] not in USER_ROLES:
  from app.advanced import RoleProfile
  if not await db.scalar(select(RoleProfile).where(RoleProfile.tenant_id==u.tenant_id,RoleProfile.role_key==changes["role"],RoleProfile.active.is_(True))): raise HTTPException(400,"Profil non autorisé")
 if uid==u.id and changes.get("active") is False: raise HTTPException(400,"Vous ne pouvez pas désactiver votre propre compte")
 if item.role=="ADMIN" and item.active and (changes.get("active") is False or changes.get("role") not in (None,"ADMIN")):
  admins=await db.scalar(select(func.count(User.id)).where(User.tenant_id==u.tenant_id,User.role=="ADMIN",User.active.is_(True)))
  if admins<=1: raise HTTPException(409,"Impossible de désactiver le dernier administrateur")
 password=changes.pop("password",None)
 for key,value in changes.items(): setattr(item,key,value)
 if password: item.password_hash=hasher.hash(password)
 db.add(Audit(tenant_id=u.tenant_id,user_id=u.id,action="MODIFICATION_UTILISATEUR",detail=f"Compte modifié : {item.email}"))
 await db.commit()
 return {"id":item.id,"name":item.name,"email":item.email,"role":item.role,"active":item.active}

# Modules métier additionnels (modèles chargés avant create_all au démarrage).
from app import advanced  # noqa: F401

# En production, l'API sert aussi l'application React compilée.
_frontend=os.path.abspath(os.path.join(os.path.dirname(__file__),"../../frontend/dist"))
if os.path.isdir(_frontend):
 app.mount("/",StaticFiles(directory=_frontend,html=True),name="frontend")
