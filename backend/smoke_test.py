import asyncio
from datetime import date
from sqlalchemy import select,func,cast,Date
from sqlalchemy.dialects import postgresql
from app.main import Base, Sale
from app.main import Session,Tenant,User,Warehouse,WarehouseStock,Product,Customer,Recipe

dashboard_sql=select(func.count(Sale.id)).where(Sale.tenant_id==1,cast(Sale.created_at,Date)==date(2026,11,25))
compiled=str(dashboard_sql.compile(dialect=postgresql.dialect()))
assert "CAST(sales.created_at AS DATE)" in compiled

async def main():
 async with Session() as db:
  assert await db.scalar(select(func.count(Tenant.id))) == 1
  assert await db.scalar(select(func.count(User.id)).where(User.tenant_id == 1)) == 2
  platform_admin = await db.scalar(select(User).where(User.role == "SUPER_ADMIN"))
  assert platform_admin is None or platform_admin.tenant_id is None
  assert await db.scalar(select(func.count(Warehouse.id))) == 2
  assert await db.scalar(select(func.count(Product.id))) == 13
  assert await db.scalar(select(func.count(WarehouseStock.id))) == 10
  assert await db.scalar(select(func.count(Customer.id))) == 3
  assert await db.scalar(select(func.count(Recipe.id))) == 6
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
