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
    SupplierInvoice, SupplierPayment, CustomerReceipt, Expense
)
advanced_paths={route.path for route in app.routes}
assert {
    "/api/profiles", "/api/purchases", "/api/purchases/{order_id}/receive",
    "/api/inventories", "/api/inventories/{inventory_id}", "/api/inventories/{inventory_id}/validate",
    "/api/sales/{sale_id}/refund", "/api/restaurant/tables",
    "/api/restaurant/orders", "/api/sales/{sale_id}/invoice",
    "/api/stock/transfers", "/api/stock/valuation",
    "/api/finance/supplier-invoices", "/api/finance/supplier-invoices/{invoice_id}/payments",
    "/api/finance/customer-receipts", "/api/finance/expenses", "/api/finance/summary",
    "/api/finance/cash-sessions", "/api/platform/overview", "/api/platform/companies", "/api/platform/bootstrap", "/api/platform/companies/{tenant_id}/subscription", "/api/sales/export.csv",
} <= advanced_paths
assert {
    "role_profiles", "purchase_orders", "purchase_lines", "inventories",
    "inventory_lines", "refunds", "refund_lines", "refund_payments", "restaurant_tables", "kitchen_orders",
    "kitchen_order_lines", "subscriptions", "stock_transfers", "stock_transfer_lines",
    "supplier_invoices", "supplier_payments", "customer_receipts", "expenses",
} <= set(Base.metadata.tables)
print("ADVANCED ROUTES OK: profils, achats, réceptions, inventaires, transferts, valorisation, retours, restaurant, factures, SaaS")
# Le circuit achats expose le détail des lignes et conserve les quantités reçues.
from app.advanced import PurchaseLine
assert {"purchase_orders", "purchase_lines"} <= set(Base.metadata.tables)
assert hasattr(PurchaseLine, "received") and hasattr(PurchaseLine, "unit_cost")
assert {"/api/purchases", "/api/purchases/{order_id}/receive"} <= {route.path for route in app.routes}
print("PURCHASE WORKFLOW OK: commandes multi-lignes et réception partielle")

# Catalogue : création, modification et import Excel tenant-scoped.
product_paths={route.path for route in app.routes}
assert {"/api/products","/api/products/{product_id}","/api/products/import"} <= product_paths
assert {"products","warehouse_stocks","stock_movements"} <= set(Base.metadata.tables)
assert abs(unit_conversion("g","kg")-0.001)<1e-12
assert abs(unit_conversion("L","ml")-1000)<1e-12
assert unit_conversion("Pièce","Unité")==1
print("PRODUCT CATALOG OK: create, edit, Excel import, stock ledger and unit conversion routes")


# Instructions publiques de paiement : aucun moyen désactivé ou incomplet ne doit être publié.
from app.advanced import PlatformPaymentSettings, _public_payment_instructions_payload
public_empty = _public_payment_instructions_payload()
assert public_empty == {"providers": [], "instructions": "", "available": False}
public_disabled = _public_payment_instructions_payload(PlatformPaymentSettings(
    wave_enabled=False, wave_phone="+221770000000", wave_name="Compte privé",
    orange_enabled=True, orange_phone="", orange_link="", instructions="Paiement manuel"
))
assert public_disabled == {"providers": [], "instructions": "Paiement manuel", "available": False}
public_enabled = _public_payment_instructions_payload(PlatformPaymentSettings(
    wave_enabled=True, wave_phone="+221770000001", wave_name="iDIABA",
    wave_link="", orange_enabled=True, orange_phone="", orange_link="https://pay.example.test",
    orange_name="iDIABA Orange", instructions="Indiquez la référence après le transfert"
))
assert public_enabled["available"] is True
assert [provider["key"] for provider in public_enabled["providers"]] == ["WAVE", "ORANGE_MONEY"]
assert public_enabled["providers"][0]["phone"] == "+221770000001"
assert public_enabled["providers"][1]["link"] == "https://pay.example.test"
assert "Compte privé" not in str(public_enabled)
assert "/api/public/payment-instructions" in {route.path for route in app.routes}
print("PUBLIC PAYMENT INSTRUCTIONS OK: seuls les moyens activés et complets sont publiés")


# Contrôle des permissions personnalisées : le backend doit refuser tout droit absent.
from types import SimpleNamespace
from fastapi import HTTPException
from app.main import roles, effective_permissions
from app.advanced import PERMISSION_KEYS

required_permissions = {
    "users.read", "users.write", "catalog.read", "catalog.write",
    "customers.read", "customers.write", "suppliers.read", "suppliers.write",
    "cash.read", "cash.open", "cash.close", "purchases.read", "purchases.write",
    "stock.read", "stock.write", "inventory.read", "inventory.write", "sales.read", "sales.write",
    "sales.refund", "restaurant.read", "restaurant.write", "reports.read",
    "finance.read", "finance.write", "receivables.read", "receivables.write",
    "payables.read", "payables.write",
}
assert required_permissions <= PERMISSION_KEYS

class FakePermissionDB:
    def __init__(self, profile):
        self.profile = profile
    async def scalar(self, query):
        return self.profile

async def permission_guard_tests():
    guard = roles("ADMIN", permission="users.write")
    custom_user = SimpleNamespace(role="RESPONSABLE", tenant_id=42)
    allowed_profile = SimpleNamespace(permissions='["users.write"]')
    assert await guard(custom_user, FakePermissionDB(allowed_profile)) is custom_user
    denied_profile = SimpleNamespace(permissions='["sales.read"]')
    try:
        await guard(custom_user, FakePermissionDB(denied_profile))
    except HTTPException as exc:
        assert exc.status_code == 403
    else:
        raise AssertionError("Un profil sans users.write a pu accéder à la gestion des utilisateurs")

async def effective_permission_tests():
    custom = SimpleNamespace(role="RESPONSABLE", tenant_id=42)
    profile = SimpleNamespace(permissions='["sales.write","stock.read"]')
    granted = await effective_permissions(custom, FakePermissionDB(profile))
    assert "sales.write" in granted and "sales.read" in granted
    assert "stock.read" in granted
    assert "inventory.read" not in granted
    assert "users.write" not in granted
    admin = SimpleNamespace(role="ADMIN", tenant_id=42)
    assert required_permissions <= set(await effective_permissions(admin, FakePermissionDB(None)))
    super_admin = SimpleNamespace(role="SUPER_ADMIN", tenant_id=None)
    assert await effective_permissions(super_admin, FakePermissionDB(None)) == []
    manager = SimpleNamespace(role="GERANT", tenant_id=42)
    manager_permissions = set(await effective_permissions(manager, FakePermissionDB(None)))
    assert "reports.read" in manager_permissions and "users.write" not in manager_permissions

asyncio.run(permission_guard_tests())
asyncio.run(effective_permission_tests())
print("PERMISSIONS OK: droits API, héritage lecture/écriture et menus par profil")

# Finance : modèles et permissions tenant-scoped.
assert {"finance.read", "finance.write", "receivables.read", "receivables.write", "payables.read", "payables.write"} <= PERMISSION_KEYS
assert all("tenant_id" in model.__table__.columns for model in (SupplierInvoice, SupplierPayment, CustomerReceipt, Expense))
async def finance_permission_tests():
    finance_user = SimpleNamespace(role="COMPTABLE", tenant_id=42)
    finance_profile = SimpleNamespace(permissions='["finance.write","payables.write","receivables.write"]')
    finance_permissions = set(await effective_permissions(finance_user, FakePermissionDB(finance_profile)))
    assert {"finance.read", "finance.write", "payables.read", "payables.write", "receivables.read", "receivables.write", "suppliers.read", "customers.read"} <= finance_permissions
asyncio.run(finance_permission_tests())
print("FINANCE OK: factures fournisseurs, règlements, créances clients, dépenses, trésorerie et rapports tenant-scoped")

async def inventory_read_permission_tests():
    read_only = SimpleNamespace(role="MAGASINIER_LECTURE", tenant_id=42)
    profile = SimpleNamespace(permissions='["inventory.read"]')
    granted = set(await effective_permissions(read_only, FakePermissionDB(profile)))
    assert "inventory.read" in granted
    assert "inventory.write" not in granted
    writer = SimpleNamespace(role="MAGASINIER", tenant_id=42)
    writer_profile = SimpleNamespace(permissions='["inventory.write"]')
    writer_granted = set(await effective_permissions(writer, FakePermissionDB(writer_profile)))
    assert {"inventory.read", "inventory.write"} <= writer_granted

asyncio.run(inventory_read_permission_tests())
print("INVENTORY PERMISSIONS OK: consultation séparée de la création et validation")

async def builtin_stock_inventory_read_test():
    stock_user = SimpleNamespace(role="STOCK", tenant_id=42)
    granted = set(await effective_permissions(stock_user, FakePermissionDB(None)))
    assert {"inventory.read", "inventory.write"} <= granted
    assert "stock.read" in granted
asyncio.run(builtin_stock_inventory_read_test())
print("BUILTIN STOCK OK: consultation et modification des inventaires conservées")

# Régression de cloisonnement : chaque jointure vers une entité métier doit
# conserver explicitement le tenant courant, même si la ligne parente est filtrée.
import inspect
from app import advanced as advanced_module
tenant_scoped_sources = {
    "purchase_list": ["Supplier.tenant_id == user.tenant_id", "Product.tenant_id == user.tenant_id"],
    "inventory_list": ["Warehouse.tenant_id == user.tenant_id"],
    "sale_refund": ["Refund.tenant_id == user.tenant_id"],
    "sale_invoice": ["Product.tenant_id == user.tenant_id"],
    "supplier_invoice_list": ["Supplier.tenant_id == user.tenant_id"],
    "customer_receipt_list": ["Customer.tenant_id == user.tenant_id"],
    "cash_session_list": ["User.tenant_id == user.tenant_id"],
}
for function_name, expected_conditions in tenant_scoped_sources.items():
    source = inspect.getsource(getattr(advanced_module, function_name))
    for condition in expected_conditions:
        assert condition in source, f"{function_name} doit filtrer par entreprise : {condition}"
print("TENANT JOIN ISOLATION OK: fournisseurs, produits, dépôts, remboursements, clients et caisses")
