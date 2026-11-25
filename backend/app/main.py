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
 id:Mapped[int]=mapped_column(primary_key=True);tenant_id:Mapped[int]=mapped_column(ForeignKey("tenants.id"),index=True);user_id:Mapped[int]=mapped_column(ForeignKey("users.id"));customer_id:Mapped[Optional[int]]=mapped_column(ForeignKey("customers.id"),nullable=True);cash_id:Mapped[int]=mapped_column(ForeignKey("cash_sessions.id"));warehouse_id:Mapped[int]=mapped_column(ForeignKey("warehouses.id"));channel:Mapped[str]=mapped_column(String(20),default="COMMERCE");table_name:Mapped[str]=mapped_column(String(40),default="");status:Mapped[str]=mapped_column(String(24),default="PAYE");subtotal:Mapped[float]=mapped_column(Float);tax:Mapped[float]=mapped_column(Float);total:Mapped[float]=mapped_column(Float);created_at:Mapped[datetime]=mapped_column(DateTime,default=datetime.utcnow)
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
async def tenant_auth(u:User=Depends(tenant_auth)):
 if u.role == "SUPER_ADMIN" or u.tenant_id is None:
  raise HTTPException(403,"Le Super Admin doit utiliser exclusivement le portail de gestion des entreprises")
 return u
def roles(*allowed):
 async def check(u:User=Depends(tenant_auth),db:AsyncSession=Depends(dbdep)):
  if u.role in allowed: return u
  from app.advanced import RoleProfile
  profile=await db.scalar(select(RoleProfile).where(RoleProfile.tenant_id==u.tenant_id,RoleProfile.role_key==u.role,RoleProfile.active.is_(True)))
  permissions=set(json.loads(profile.permissions or "[]")) if profile else set()
  required="users.write" if allowed==("ADMIN",) else ("stock.write" if "STOCK" in allowed else "reports.read")
  if required not in permissions: raise HTTPException(403,"Accès refusé")
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
  print("[startup] Isolation du compte Super Admin appliquée", flush=True)
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
async def products(u:User=Depends(tenant_auth),db:AsyncSession=Depends(dbdep)):
 return [{"id":p.id,"sku":p.sku,"barcode":p.barcode,"name":p.name,"category":p.category,"unit":p.unit,"purchase_price":p.purchase_price,"sale_price":p.sale_price,"tax_rate":p.tax_rate,"stock":p.stock,"min_stock":p.min_stock,"kind":p.kind} for p in (await db.scalars(select(Product).where(Product.tenant_id==u.tenant_id,Product.active.is_(True)).order_by(Product.name))).all()]
class ProductIn(BaseModel):
 sku:str;name:str;barcode:str="";category:str="Général";unit:str="Pièce";purchase_price:float=0;sale_price:float=Field(ge=0);tax_rate:float=18;min_stock:float=0;kind:str="SIMPLE"
@app.post("/api/products")
async def add_product(x:ProductIn,u:User=Depends(roles("ADMIN","GERANT")),db:AsyncSession=Depends(dbdep)):
 p=Product(tenant_id=u.tenant_id,**x.model_dump());db.add(p);await db.commit();return {"id":p.id,"name":p.name}
@app.get("/api/customers")
async def customers(u:User=Depends(tenant_auth),db:AsyncSession=Depends(dbdep)):
 return [{"id":x.id,"name":x.name,"phone":x.phone,"credit_limit":x.credit_limit,"balance_due":x.balance_due} for x in (await db.scalars(select(Customer).where(Customer.tenant_id==u.tenant_id))).all()]
class CustomerIn(BaseModel):
 name:str;phone:str="";credit_limit:float=Field(ge=0)
@app.post("/api/customers")
async def customer_create(x:CustomerIn,u:User=Depends(roles("ADMIN","GERANT")),db:AsyncSession=Depends(dbdep)):
 c=Customer(tenant_id=u.tenant_id,**x.model_dump());db.add(c);await db.commit();await db.refresh(c);return {"id":c.id,"name":c.name}
@app.get("/api/suppliers")
async def suppliers(u:User=Depends(roles("ADMIN","GERANT")),db:AsyncSession=Depends(dbdep)):
 return [{"id":x.id,"name":x.name,"phone":x.phone,"balance_due":x.balance_due} for x in (await db.scalars(select(Supplier).where(Supplier.tenant_id==u.tenant_id))).all()]
class SupplierIn(BaseModel):
 name:str;phone:str=""
@app.post("/api/suppliers")
async def supplier_create(x:SupplierIn,u:User=Depends(roles("ADMIN","GERANT")),db:AsyncSession=Depends(dbdep)):
 c=Supplier(tenant_id=u.tenant_id,**x.model_dump());db.add(c);await db.commit();await db.refresh(c);return {"id":c.id,"name":c.name}
class OpenCash(BaseModel): opening:float=Field(ge=0)
@app.get("/api/cash/current")
async def cash_current(u:User=Depends(tenant_auth),db:AsyncSession=Depends(dbdep)):
 c=await db.scalar(select(Cash).where(Cash.tenant_id==u.tenant_id,Cash.user_id==u.id,Cash.status=="OPEN"))
 return None if not c else {"id":c.id,"opening":c.opening,"expected":c.expected}
@app.post("/api/cash/open")
async def cash_open(x:OpenCash,u:User=Depends(tenant_auth),db:AsyncSession=Depends(dbdep)):
 if await db.scalar(select(Cash).where(Cash.tenant_id==u.tenant_id,Cash.user_id==u.id,Cash.status=="OPEN")): raise HTTPException(409,"Caisse déjà ouverte")
 c=Cash(tenant_id=u.tenant_id,user_id=u.id,opening=x.opening,expected=x.opening);db.add(c);await db.commit();await db.refresh(c);return {"id":c.id,"status":c.status}
class CloseCash(BaseModel): counted:float=Field(ge=0)
@app.post("/api/cash/{cid}/close")
async def cash_close(cid:int,x:CloseCash,u:User=Depends(tenant_auth),db:AsyncSession=Depends(dbdep)):
 c=await db.scalar(select(Cash).where(Cash.id==cid,Cash.tenant_id==u.tenant_id,Cash.user_id==u.id,Cash.status=="OPEN"))
 if not c: raise HTTPException(404,"Session introuvable")
 c.counted=x.counted;c.variance=x.counted-c.expected;c.status="CLOSED";c.closed_at=datetime.utcnow();await db.commit();return {"expected":c.expected,"counted":c.counted,"variance":c.variance}
class LineIn(BaseModel): product_id:int;quantity:float=Field(gt=0)
class PayIn(BaseModel): method:str;amount:float=Field(gt=0);reference:str=""
class SaleIn(BaseModel):
 warehouse_id:int;customer_id:Optional[int]=None;channel:str="COMMERCE";table_name:str="";lines:list[LineIn];payments:list[PayIn]
@app.post("/api/sales")
async def sale_create(x:SaleIn,u:User=Depends(tenant_auth),db:AsyncSession=Depends(dbdep)):
 cash=await db.scalar(select(Cash).where(Cash.tenant_id==u.tenant_id,Cash.user_id==u.id,Cash.status=="OPEN"))
 wh=await db.scalar(select(Warehouse).where(Warehouse.id==x.warehouse_id,Warehouse.tenant_id==u.tenant_id))
 if not cash or not wh: raise HTTPException(409,"Ouvrez la caisse et sélectionnez un dépôt")
 customer=None
 if x.customer_id:
  customer=await db.scalar(select(Customer).where(Customer.id==x.customer_id,Customer.tenant_id==u.tenant_id))
  if not customer: raise HTTPException(404,"Client introuvable")
 items=[];subtotal=0;tax=0
 for line in x.lines:
  p=await db.scalar(select(Product).where(Product.id==line.product_id,Product.tenant_id==u.tenant_id,Product.active.is_(True)))
  if not p: raise HTTPException(404,"Article introuvable")
  warehouse_stock=await db.scalar(select(WarehouseStock).where(WarehouseStock.tenant_id==u.tenant_id,WarehouseStock.warehouse_id==wh.id,WarehouseStock.product_id==p.id))
  recipe=[]
  if p.kind=="COMPOSE":
   recipe=(await db.scalars(select(Recipe).where(Recipe.tenant_id==u.tenant_id,Recipe.product_id==p.id))).all()
   if not recipe: raise HTTPException(409,f"Fiche recette absente : {p.name}")
   for part in recipe:
    ingredient=await db.scalar(select(Product).where(Product.id==part.ingredient_id,Product.tenant_id==u.tenant_id))
    ingredient_stock=await db.scalar(select(WarehouseStock).where(WarehouseStock.tenant_id==u.tenant_id,WarehouseStock.warehouse_id==wh.id,WarehouseStock.product_id==part.ingredient_id))
    if not ingredient or not ingredient_stock or ingredient_stock.quantity<part.quantity*line.quantity: raise HTTPException(409,f"Stock ingrédient insuffisant : {ingredient.name if ingredient else 'inconnu'}")
  elif not warehouse_stock or warehouse_stock.quantity<line.quantity: raise HTTPException(409,f"Stock insuffisant : {p.name}")
  st=p.sale_price*line.quantity;items.append((p,line.quantity,st,recipe));subtotal+=st;tax+=st*p.tax_rate/100
 total=round(subtotal+tax,2);paid=sum(p.amount for p in x.payments)
 if paid<total: raise HTTPException(400,"Paiement insuffisant")
 credit=sum(p.amount for p in x.payments if p.method=="CREDIT_CLIENT")
 if credit and not customer: raise HTTPException(400,"Client obligatoire pour un crédit")
 if credit and customer.balance_due+credit>customer.credit_limit: raise HTTPException(409,"Plafond crédit dépassé")
 s=Sale(tenant_id=u.tenant_id,user_id=u.id,customer_id=x.customer_id,cash_id=cash.id,warehouse_id=wh.id,channel=x.channel,table_name=x.table_name,status="PAYE",subtotal=subtotal,tax=tax,total=total);db.add(s);await db.flush()
 for p,q,st,recipe in items:
  db.add(SaleLine(sale_id=s.id,product_id=p.id,label=p.name,quantity=q,unit_price=p.sale_price,total=st))
  if recipe:
   for part in recipe:
    ingredient=await db.scalar(select(Product).where(Product.id==part.ingredient_id,Product.tenant_id==u.tenant_id))
    ingredient.stock-=part.quantity*q
    ingredient_stock=await db.scalar(select(WarehouseStock).where(WarehouseStock.tenant_id==u.tenant_id,WarehouseStock.warehouse_id==wh.id,WarehouseStock.product_id==ingredient.id))
    ingredient_stock.quantity-=part.quantity*q
    db.add(Movement(tenant_id=u.tenant_id,warehouse_id=wh.id,product_id=ingredient.id,kind="SORTIE_VENTE_RECETTE",quantity=-part.quantity*q,unit_cost=ingredient.purchase_price,reference=f"VTE-{s.id}"))
  else:
   p.stock-=q
   warehouse_stock=await db.scalar(select(WarehouseStock).where(WarehouseStock.tenant_id==u.tenant_id,WarehouseStock.warehouse_id==wh.id,WarehouseStock.product_id==p.id))
   warehouse_stock.quantity-=q
   db.add(Movement(tenant_id=u.tenant_id,warehouse_id=wh.id,product_id=p.id,kind="SORTIE_VENTE",quantity=-q,unit_cost=p.purchase_price,reference=f"VTE-{s.id}"))
 for p in x.payments:
  db.add(Payment(sale_id=s.id,method=p.method,amount=p.amount,reference=p.reference))
  if p.method=="ESPECES": cash.expected+=p.amount
 if credit: customer.balance_due+=credit
 db.add(Audit(tenant_id=u.tenant_id,user_id=u.id,action="VENTE",detail=f"Vente {s.id} - {total:.0f} FCFA"))
 await db.commit();return {"id":s.id,"status":s.status,"total":total,"change":max(0,paid-total)}
class StockIn(BaseModel): warehouse_id:int;product_id:int;quantity:float;unit_cost:float=0;kind:str="ENTREE_ACHAT"
@app.get("/api/stock/movements")
async def stock_movements(u:User=Depends(roles("ADMIN","GERANT","STOCK")),db:AsyncSession=Depends(dbdep)):
 rows=(await db.scalars(select(Movement).where(Movement.tenant_id==u.tenant_id).order_by(Movement.created_at.desc()).limit(200))).all()
 return [{"id":x.id,"warehouse_id":x.warehouse_id,"product_id":x.product_id,"kind":x.kind,"quantity":x.quantity,"unit_cost":x.unit_cost,"reference":x.reference,"created_at":x.created_at} for x in rows]
@app.post("/api/stock/movements")
async def stock_move(x:StockIn,u:User=Depends(roles("ADMIN","GERANT","STOCK")),db:AsyncSession=Depends(dbdep)):
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
async def transfer(x:TransferIn,u:User=Depends(roles("ADMIN","GERANT","STOCK")),db:AsyncSession=Depends(dbdep)):
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
async def dashboard(u:User=Depends(roles("ADMIN","GERANT")),db:AsyncSession=Depends(dbdep)):
 today=date.today()
 # Comparaison DATE/DATE explicite : PostgreSQL refuse DATE = VARCHAR.
 today_filter=cast(Sale.created_at,Date)==today
 rev=await db.scalar(select(func.coalesce(func.sum(Sale.total),0)).where(Sale.tenant_id==u.tenant_id,today_filter))
 sales=await db.scalar(select(func.count(Sale.id)).where(Sale.tenant_id==u.tenant_id,today_filter))
 low=(await db.scalars(select(Product).where(Product.tenant_id==u.tenant_id,Product.stock<=Product.min_stock))).all()
 debts=(await db.scalars(select(Customer).where(Customer.tenant_id==u.tenant_id,Customer.balance_due>0))).all()
 return {"revenue_today":rev or 0,"sales_today":sales or 0,"low_stock":[{"name":p.name,"stock":p.stock} for p in low],"receivables":[{"name":c.name,"balance_due":c.balance_due} for c in debts]}
@app.get("/api/sales")
async def sales(u:User=Depends(tenant_auth),db:AsyncSession=Depends(dbdep)):
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
async def users_list(u:User=Depends(roles("ADMIN")),db:AsyncSession=Depends(dbdep)):
 rows=(await db.scalars(select(User).where(User.tenant_id==u.tenant_id).order_by(User.name))).all()
 return [{"id":x.id,"name":x.name,"email":x.email,"role":x.role,"active":x.active} for x in rows]
@app.post("/api/users")
async def users_create(x:UserCreate,u:User=Depends(roles("ADMIN")),db:AsyncSession=Depends(dbdep)):
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
async def users_update(uid:int,x:UserUpdate,u:User=Depends(roles("ADMIN")),db:AsyncSession=Depends(dbdep)):
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
