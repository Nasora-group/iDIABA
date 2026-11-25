import asyncio
from datetime import date
from sqlalchemy import select,func,cast,Date
from sqlalchemy.dialects import postgresql
from app.main import Base, Sale
from app.main import Session,Tenant,User,Warehouse,WarehouseStock,Product,Customer,Recipe,LineIn,PayIn,aggregate_sale_lines,payment_settlement,startup,unit_conversion
from app.advanced import Subscription

dashboard_sql=select(func.count(Sale.id)).where(Sale.tenant_id==1,cast(Sale.created_at,Date)==date(2026,11,25))
compiled=str(dashboard_sql.compile(dialect=postgresql.dialect()))
assert "CAST(sales.created_at AS DATE)" in compiled

async def main():
 await startup()
 assert aggregate_sale_lines([LineIn(product_id=2,quantity=1),LineIn(product_id=1,quantity=2),LineIn(product_id=1,quantity=3)]) == [(1,5),(2,1)]
 assert payment_settlement(1000,[PayIn(method="ESPECES",amount=1200)]) == (0,200)
 assert payment_settlement(1000,[PayIn(method="ESPECES",amount=800),PayIn(method="CREDIT_CLIENT",amount=200)]) == (200,0)
 async with Session() as db:
  tenant_count = await db.scalar(select(func.count(Tenant.id)))
  assert tenant_count == 1
  assert await db.scalar(select(func.count(Subscription.id))) == tenant_count
  assert await db.scalar(select(func.count(User.id)).where(User.tenant_id == 1)) == 2
  platform_admin = await db.scalar(select(User).where(User.role == "SUPER_ADMIN"))
  assert platform_admin is None or platform_admin.tenant_id is None
  assert await db.scalar(select(func.count(Warehouse.id))) == 2
  assert await db.scalar(select(func.count(Product.id))) == 13
  assert await db.scalar(select(func.count(WarehouseStock.id))) == 10
  assert await db.scalar(select(func.count(Customer.id))) == 3
  assert await db.scalar(select(func.count(Recipe.id))) == 6
  assert {"client_sale_id","change_amount"} <= set(Sale.__table__.columns.keys())
  assert any(c.name=="uq_sales_tenant_client_sale" for c in Sale.__table__.constraints)
 print("SMOKE OK: données entreprise isolées, compte plateforme indépendant, 2 dépôts, 10 stocks-dépôt, 13 produits, 3 clients, 6 composants recette")
asyncio.run(main())

# Vérification des routes de gestion des comptes et des rôles stock.
from app.main import app, USER_ROLES
paths={route.path for route in app.routes}
assert {"/api/users","/api/users/{uid}/update","/api/stock/movements","/api/cash/{cid}/close"} <= paths
assert {"ADMIN","GERANT","CAISSIER","VENDEUR","STOCK"} <= USER_ROLES

# Modules complémentaires : modèles et routes chargés avant le démarrage.
from app.advanced import (
    RoleProfile, PurchaseOrder, PurchaseLine, Inventory, InventoryLine,
    Refund, RefundLine, RefundPayment, RestaurantTable, KitchenOrder, KitchenOrderLine, Subscription, StockTransfer, StockTransferLine,
)
advanced_paths={route.path for route in app.routes}
assert {
    "/api/profiles", "/api/purchases", "/api/purchases/{order_id}/receive",
    "/api/inventories", "/api/inventories/{inventory_id}/validate",
    "/api/sales/{sale_id}/refund", "/api/restaurant/tables",
    "/api/restaurant/orders", "/api/sales/{sale_id}/invoice",
    "/api/stock/transfers", "/api/stock/valuation", "/api/platform/overview", "/api/platform/companies", "/api/platform/bootstrap", "/api/platform/companies/{tenant_id}/subscription", "/api/sales/export.csv",
} <= advanced_paths
assert {
    "role_profiles", "purchase_orders", "purchase_lines", "inventories",
    "inventory_lines", "refunds", "refund_lines", "refund_payments", "restaurant_tables", "kitchen_orders",
    "kitchen_order_lines", "subscriptions", "stock_transfers", "stock_transfer_lines",
} <= set(Base.metadata.tables)
print("ADVANCED ROUTES OK: profils, achats, réceptions, inventaires, transferts, valorisation, retours, restaurant, factures, SaaS")

# Catalogue : création, modification et import Excel tenant-scoped.
product_paths={route.path for route in app.routes}
assert {"/api/products","/api/products/{product_id}","/api/products/import"} <= product_paths
assert {"products","warehouse_stocks","stock_movements"} <= set(Base.metadata.tables)
assert abs(unit_conversion("g","kg")-0.001)<1e-12\nassert abs(unit_conversion("L","ml")-1000)<1e-12\nassert unit_conversion("Pièce","Unité")==1\nprint("PRODUCT CATALOG OK: create, edit, Excel import, stock ledger and unit conversion routes")
