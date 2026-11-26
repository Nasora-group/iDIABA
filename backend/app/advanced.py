"""Modules métier complémentaires iDIABA V2. Toutes les écritures sont tenant-scoped."""
import json
import os
import secrets
import calendar
import csv
import io
from datetime import datetime
from html import escape
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response, Header
from pydantic import BaseModel, Field
from sqlalchemy import String, Float, Integer, Boolean, DateTime, ForeignKey, select, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import (
    Base, app, dbdep, auth, roles, User, Tenant, Product, Warehouse,
    WarehouseStock, Movement, Supplier, Sale, SaleLine, Payment, Cash,
    Audit, hasher, tenant_auth
)

router = APIRouter(prefix="/api", tags=["modules métier"])

# Tables additives : create_all les crée sans modifier ni supprimer les tables historiques.
class RegistrationRequest(Base):
    __tablename__ = "registration_requests"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_name: Mapped[str] = mapped_column(String(160))
    mode: Mapped[str] = mapped_column(String(20), default="HYBRIDE")
    address: Mapped[str] = mapped_column(String(200), default="")
    phone: Mapped[str] = mapped_column(String(40), default="")
    admin_name: Mapped[str] = mapped_column(String(120))
    admin_email: Mapped[str] = mapped_column(String(160), index=True)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="EN_ATTENTE", index=True)
    review_note: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

class SubscriptionPayment(Base):
    __tablename__ = "subscription_payments"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    provider: Mapped[str] = mapped_column(String(20))
    amount: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(8), default="FCFA")
    reference: Mapped[str] = mapped_column(String(120), index=True)
    period_months: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(20), default="VERIFIE")
    note: Mapped[str] = mapped_column(String(500), default="")
    verified_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    verified_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class PlatformPaymentSettings(Base):
    """Coordonnées publiques de paiement des abonnements SaaS, configurées par le Super Admin."""
    __tablename__ = "platform_payment_settings"
    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    wave_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    wave_name: Mapped[str] = mapped_column(String(120), default="")
    wave_phone: Mapped[str] = mapped_column(String(40), default="")
    wave_link: Mapped[str] = mapped_column(String(500), default="")
    orange_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    orange_name: Mapped[str] = mapped_column(String(120), default="")
    orange_phone: Mapped[str] = mapped_column(String(40), default="")
    orange_link: Mapped[str] = mapped_column(String(500), default="")
    instructions: Mapped[str] = mapped_column(String(500), default="")

class RoleProfile(Base):
    __tablename__ = "role_profiles"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    role_key: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(100))
    permissions: Mapped[str] = mapped_column(String(4000), default="[]")
    active: Mapped[bool] = mapped_column(Boolean, default=True)

class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"))
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"))
    reference: Mapped[str] = mapped_column(String(60))
    status: Mapped[str] = mapped_column(String(20), default="BROUILLON")
    total: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class PurchaseLine(Base):
    __tablename__ = "purchase_lines"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("purchase_orders.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[float] = mapped_column(Float)
    received: Mapped[float] = mapped_column(Float, default=0)
    unit_cost: Mapped[float] = mapped_column(Float)
    total: Mapped[float] = mapped_column(Float)

class Inventory(Base):
    __tablename__ = "inventories"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"))
    status: Mapped[str] = mapped_column(String(20), default="BROUILLON")
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class InventoryLine(Base):
    __tablename__ = "inventory_lines"
    id: Mapped[int] = mapped_column(primary_key=True)
    inventory_id: Mapped[int] = mapped_column(ForeignKey("inventories.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    theoretical: Mapped[float] = mapped_column(Float)
    counted: Mapped[float] = mapped_column(Float)
    difference: Mapped[float] = mapped_column(Float)

class StockTransfer(Base):
    __tablename__ = "stock_transfers"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    source_warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"))
    destination_warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"))
    reference: Mapped[str] = mapped_column(String(60))
    status: Mapped[str] = mapped_column(String(20), default="VALIDE")
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class StockTransferLine(Base):
    __tablename__ = "stock_transfer_lines"
    id: Mapped[int] = mapped_column(primary_key=True)
    transfer_id: Mapped[int] = mapped_column(ForeignKey("stock_transfers.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[float] = mapped_column(Float)
    unit_cost: Mapped[float] = mapped_column(Float, default=0)

class Refund(Base):
    __tablename__ = "refunds"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    sale_id: Mapped[int] = mapped_column(ForeignKey("sales.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    reason: Mapped[str] = mapped_column(String(300))
    amount: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(20), default="VALIDE")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class RefundLine(Base):
    __tablename__ = "refund_lines"
    id: Mapped[int] = mapped_column(primary_key=True)
    refund_id: Mapped[int] = mapped_column(ForeignKey("refunds.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[float] = mapped_column(Float)
    amount: Mapped[float] = mapped_column(Float)

class RefundPayment(Base):
    """Journal des décaissements réellement effectués pour les remboursements."""
    __tablename__ = "refund_payments"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    refund_id: Mapped[int] = mapped_column(ForeignKey("refunds.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    method: Mapped[str] = mapped_column(String(24))
    amount: Mapped[float] = mapped_column(Float)
    reference: Mapped[str] = mapped_column(String(100), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class RestaurantTable(Base):
    __tablename__ = "restaurant_tables"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    name: Mapped[str] = mapped_column(String(40))
    seats: Mapped[int] = mapped_column(Integer, default=4)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

class KitchenOrder(Base):
    __tablename__ = "kitchen_orders"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    table_id: Mapped[Optional[int]] = mapped_column(ForeignKey("restaurant_tables.id"), nullable=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str] = mapped_column(String(300), default="")
    status: Mapped[str] = mapped_column(String(20), default="A_PREPARER")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class KitchenOrderLine(Base):
    __tablename__ = "kitchen_order_lines"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("kitchen_orders.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[float] = mapped_column(Float)
    note: Mapped[str] = mapped_column(String(200), default="")

class Subscription(Base):
    __tablename__ = "subscriptions"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), unique=True, index=True)
    plan: Mapped[str] = mapped_column(String(30), default="ESSENTIEL")
    status: Mapped[str] = mapped_column(String(20), default="ESSAI")
    monthly_price: Mapped[float] = mapped_column(Float, default=0)
    starts_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    ends_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

PERMISSION_KEYS = {
    "users.read", "users.write", "purchases.read", "purchases.write",
    "stock.read", "stock.write", "inventory.write", "sales.read",
    "sales.refund", "restaurant.read", "restaurant.write", "reports.read"
}

async def permitted(user: User, permission: str, db: AsyncSession):
    if user.role == "ADMIN":
        return
    profile = await db.scalar(select(RoleProfile).where(
        RoleProfile.tenant_id == user.tenant_id,
        RoleProfile.role_key == user.role,
        RoleProfile.active.is_(True)
    ))
    if not profile or permission not in json.loads(profile.permissions or "[]"):
        raise HTTPException(403, "Droit insuffisant pour cette opération")

class ProfileIn(BaseModel):
    role_key: str = Field(pattern=r"^[A-Z][A-Z0-9_]{1,39}$")
    name: str = Field(min_length=2, max_length=100)
    permissions: list[str] = []

@router.get("/permissions")
async def permission_catalog(user: User = Depends(tenant_auth)):
    return sorted(PERMISSION_KEYS)

@router.get("/profiles")
async def profiles(user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "users.read", db)
    rows = (await db.scalars(select(RoleProfile).where(RoleProfile.tenant_id == user.tenant_id))).all()
    return [{"id": r.id, "role_key": r.role_key, "name": r.name, "permissions": json.loads(r.permissions), "active": r.active} for r in rows]

@router.post("/profiles")
async def profile_create(x: ProfileIn, user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "users.write", db)
    if set(x.permissions) - PERMISSION_KEYS:
        raise HTTPException(400, "Droit inconnu")
    if x.role_key in {"ADMIN", "SUPER_ADMIN"} or await db.scalar(select(RoleProfile).where(RoleProfile.tenant_id == user.tenant_id, RoleProfile.role_key == x.role_key)):
        raise HTTPException(409, "Ce profil existe déjà ou est réservé")
    row = RoleProfile(tenant_id=user.tenant_id, role_key=x.role_key, name=x.name, permissions=json.dumps(sorted(set(x.permissions))))
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return {"id": row.id, "role_key": row.role_key}

class PurchaseItem(BaseModel):
    product_id: int
    quantity: float = Field(gt=0)
    unit_cost: float = Field(ge=0)

class PurchaseIn(BaseModel):
    supplier_id: int
    warehouse_id: int
    reference: str = Field(min_length=2, max_length=60)
    lines: list[PurchaseItem] = Field(min_length=1)

@router.get("/purchases")
async def purchase_list(user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "purchases.read", db)
    rows = (await db.scalars(select(PurchaseOrder).where(PurchaseOrder.tenant_id == user.tenant_id).order_by(PurchaseOrder.id.desc()).limit(200))).all()
    return [{"id": r.id, "reference": r.reference, "supplier_id": r.supplier_id, "warehouse_id": r.warehouse_id, "status": r.status, "total": r.total, "created_at": r.created_at} for r in rows]

@router.post("/purchases")
async def purchase_create(x: PurchaseIn, user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "purchases.write", db)
    supplier = await db.scalar(select(Supplier).where(Supplier.id == x.supplier_id, Supplier.tenant_id == user.tenant_id))
    warehouse = await db.scalar(select(Warehouse).where(Warehouse.id == x.warehouse_id, Warehouse.tenant_id == user.tenant_id))
    if not supplier or not warehouse:
        raise HTTPException(404, "Fournisseur ou dépôt introuvable")
    order = PurchaseOrder(tenant_id=user.tenant_id, supplier_id=supplier.id, warehouse_id=warehouse.id, reference=x.reference, status="A_RECEVOIR")
    db.add(order)
    await db.flush()
    total = 0
    for line in x.lines:
        product = await db.scalar(select(Product).where(Product.id == line.product_id, Product.tenant_id == user.tenant_id, Product.active.is_(True)))
        if not product:
            raise HTTPException(404, "Article introuvable dans cette entreprise")
        amount = line.quantity * line.unit_cost
        total += amount
        db.add(PurchaseLine(order_id=order.id, product_id=product.id, quantity=line.quantity, unit_cost=line.unit_cost, total=amount))
    order.total = total
    db.add(Audit(tenant_id=user.tenant_id, user_id=user.id, action="COMMANDE_ACHAT", detail=f"Commande {order.reference}"))
    await db.commit()
    return {"id": order.id, "reference": order.reference, "total": total, "status": order.status}

class ReceiptIn(BaseModel):
    lines: list[PurchaseItem] = Field(min_length=1)

@router.post("/purchases/{order_id}/receive")
async def purchase_receive(order_id: int, x: ReceiptIn, user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "purchases.write", db)
    # Verrouille la commande : deux réceptions concurrentes ne peuvent pas
    # consommer simultanément le même reliquat.
    order = await db.scalar(select(PurchaseOrder).where(
        PurchaseOrder.id == order_id,
        PurchaseOrder.tenant_id == user.tenant_id
    ).with_for_update())
    if not order or order.status in {"RECU", "ANNULE"}:
        raise HTTPException(404, "Commande indisponible")

    lines = (await db.scalars(
        select(PurchaseLine).where(PurchaseLine.order_id == order.id)
        .order_by(PurchaseLine.id).with_for_update()
    )).all()
    ordered_by_product = {}
    for line in lines:
        entry = ordered_by_product.setdefault(line.product_id, {"lines": [], "remaining": 0.0})
        entry["lines"].append(line)
        entry["remaining"] += max(0.0, line.quantity - line.received)

    # Regroupe les lignes de réception répétées par article. Le coût appliqué
    # au stock est leur coût moyen pondéré.
    received_by_product = {}
    for received in x.lines:
        entry = received_by_product.setdefault(received.product_id, {"quantity": 0.0, "value": 0.0})
        entry["quantity"] += received.quantity
        entry["value"] += received.quantity * received.unit_cost

    prepared = []
    for product_id in sorted(received_by_product):
        received = received_by_product[product_id]
        ordered = ordered_by_product.get(product_id)
        quantity = received["quantity"]
        if not ordered or quantity > ordered["remaining"] + 1e-9:
            raise HTTPException(409, "Quantité reçue supérieure à la commande")
        product = await db.scalar(select(Product).where(
            Product.id == product_id,
            Product.tenant_id == user.tenant_id
        ).with_for_update())
        if not product:
            raise HTTPException(404, "Article introuvable dans cette entreprise")
        stock = await db.scalar(select(WarehouseStock).where(
            WarehouseStock.tenant_id == user.tenant_id,
            WarehouseStock.warehouse_id == order.warehouse_id,
            WarehouseStock.product_id == product.id
        ).with_for_update())
        unit_cost = received["value"] / quantity
        prepared.append((product, stock, ordered["lines"], quantity, unit_cost))

    for product, stock, purchase_lines, quantity, unit_cost in prepared:
        if stock is None:
            stock = WarehouseStock(
                tenant_id=user.tenant_id, warehouse_id=order.warehouse_id,
                product_id=product.id, quantity=0
            )
            db.add(stock)
        stock.quantity += quantity
        product.stock += quantity
        product.purchase_price = unit_cost

        remaining = quantity
        for line in purchase_lines:
            available = max(0.0, line.quantity - line.received)
            allocated = min(available, remaining)
            if allocated > 0:
                line.received += allocated
                remaining -= allocated
            if remaining <= 1e-9:
                break

        db.add(Movement(
            tenant_id=user.tenant_id, warehouse_id=order.warehouse_id,
            product_id=product.id, kind="ENTREE_RECEPTION",
            quantity=quantity, unit_cost=unit_cost, reference=order.reference
        ))

    order.status = "RECU" if all(l.received >= l.quantity - 1e-9 for l in lines) else "PARTIEL"
    db.add(Audit(
        tenant_id=user.tenant_id, user_id=user.id, action="RECEPTION_ACHAT",
        detail=f"Réception {order.reference}"
    ))
    await db.commit()
    return {"status": order.status}

class InventoryStart(BaseModel):
    warehouse_id: int

class CountLine(BaseModel):
    product_id: int
    counted: float = Field(ge=0)

class InventoryPost(BaseModel):
    lines: list[CountLine] = Field(min_length=1)

@router.post("/inventories")
async def inventory_start(x: InventoryStart, user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "inventory.write", db)
    warehouse = await db.scalar(select(Warehouse).where(Warehouse.id == x.warehouse_id, Warehouse.tenant_id == user.tenant_id))
    if not warehouse:
        raise HTTPException(404, "Dépôt introuvable")
    inv = Inventory(tenant_id=user.tenant_id, warehouse_id=warehouse.id, created_by=user.id)
    db.add(inv)
    await db.flush()
    products = (await db.scalars(select(Product).where(Product.tenant_id == user.tenant_id, Product.active.is_(True)))).all()
    for p in products:
        stock = await db.scalar(select(WarehouseStock).where(WarehouseStock.tenant_id == user.tenant_id, WarehouseStock.warehouse_id == warehouse.id, WarehouseStock.product_id == p.id))
        db.add(InventoryLine(inventory_id=inv.id, product_id=p.id, theoretical=stock.quantity if stock else 0, counted=stock.quantity if stock else 0, difference=0))
    await db.commit()
    return {"id": inv.id, "lines": len(products), "status": inv.status}

@router.post("/inventories/{inventory_id}/validate")
async def inventory_validate(inventory_id: int, x: InventoryPost, user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "inventory.write", db)
    inv = await db.scalar(select(Inventory).where(Inventory.id == inventory_id, Inventory.tenant_id == user.tenant_id, Inventory.status == "BROUILLON"))
    if not inv:
        raise HTTPException(404, "Inventaire introuvable ou déjà validé")
    lines = (await db.scalars(select(InventoryLine).where(InventoryLine.inventory_id == inv.id))).all()
    for item in x.lines:
        line = next((l for l in lines if l.product_id == item.product_id), None)
        if not line:
            raise HTTPException(404, "Article absent de cet inventaire")
        delta = item.counted - line.theoretical
        line.counted = item.counted
        line.difference = delta
        stock = await db.scalar(select(WarehouseStock).where(WarehouseStock.tenant_id == user.tenant_id, WarehouseStock.warehouse_id == inv.warehouse_id, WarehouseStock.product_id == item.product_id))
        if not stock:
            stock = WarehouseStock(tenant_id=user.tenant_id, warehouse_id=inv.warehouse_id, product_id=item.product_id, quantity=0)
            db.add(stock)
        stock.quantity = item.counted
        product = await db.scalar(select(Product).where(Product.id == item.product_id, Product.tenant_id == user.tenant_id))
        product.stock += delta
        if delta:
            db.add(Movement(tenant_id=user.tenant_id, warehouse_id=inv.warehouse_id, product_id=product.id, kind="AJUSTEMENT_INVENTAIRE", quantity=delta, unit_cost=product.purchase_price, reference=f"INV-{inv.id}"))
    inv.status = "VALIDE"
    await db.commit()
    return {"status": inv.status, "adjustments": sum(abs(l.difference) for l in lines)}

class TransferItem(BaseModel):
    product_id: int
    quantity: float = Field(gt=0)

class TransferIn(BaseModel):
    source_warehouse_id: int
    destination_warehouse_id: int
    reference: str = Field(min_length=2, max_length=60)
    lines: list[TransferItem] = Field(min_length=1)

@router.get("/stock/transfers")
async def stock_transfers(user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "stock.read", db)
    rows = (await db.scalars(select(StockTransfer).where(StockTransfer.tenant_id == user.tenant_id).order_by(StockTransfer.id.desc()).limit(200))).all()
    return [{"id": r.id, "reference": r.reference, "source_warehouse_id": r.source_warehouse_id, "destination_warehouse_id": r.destination_warehouse_id, "status": r.status, "created_at": r.created_at} for r in rows]

@router.post("/stock/transfers")
async def stock_transfer_create(x: TransferIn, user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "stock.write", db)
    if x.source_warehouse_id == x.destination_warehouse_id:
        raise HTTPException(400, "Les dépôts source et destination doivent être différents")
    source = await db.scalar(select(Warehouse).where(Warehouse.id == x.source_warehouse_id, Warehouse.tenant_id == user.tenant_id))
    destination = await db.scalar(select(Warehouse).where(Warehouse.id == x.destination_warehouse_id, Warehouse.tenant_id == user.tenant_id))
    if not source or not destination:
        raise HTTPException(404, "Dépôt source ou destination introuvable")
    transfer = StockTransfer(tenant_id=user.tenant_id, source_warehouse_id=source.id, destination_warehouse_id=destination.id, reference=x.reference, created_by=user.id)
    db.add(transfer)
    await db.flush()
    prepared = []
    requested = {}
    for item in x.lines:
        requested[item.product_id] = requested.get(item.product_id, 0) + item.quantity
    for product_id, quantity in requested.items():
        product = await db.scalar(select(Product).where(Product.id == product_id, Product.tenant_id == user.tenant_id, Product.active.is_(True)))
        if not product:
            raise HTTPException(404, "Article introuvable dans cette entreprise")
        source_stock = await db.scalar(select(WarehouseStock).where(WarehouseStock.tenant_id == user.tenant_id, WarehouseStock.warehouse_id == source.id, WarehouseStock.product_id == product.id).with_for_update())
        available = source_stock.quantity if source_stock else 0
        if available < quantity:
            raise HTTPException(409, f"Stock insuffisant pour {product.name} : disponible {available:g}")
        destination_stock = await db.scalar(select(WarehouseStock).where(WarehouseStock.tenant_id == user.tenant_id, WarehouseStock.warehouse_id == destination.id, WarehouseStock.product_id == product.id).with_for_update())
        prepared.append((product, source_stock, destination_stock, quantity))
    for product, source_stock, destination_stock, quantity in prepared:
        source_stock.quantity -= quantity
        if destination_stock is None:
            destination_stock = WarehouseStock(tenant_id=user.tenant_id, warehouse_id=destination.id, product_id=product.id, quantity=0)
            db.add(destination_stock)
        destination_stock.quantity += quantity
        db.add(StockTransferLine(transfer_id=transfer.id, product_id=product.id, quantity=quantity, unit_cost=product.purchase_price))
        db.add(Movement(tenant_id=user.tenant_id, warehouse_id=source.id, product_id=product.id, kind="TRANSFERT_SORTIE", quantity=-quantity, unit_cost=product.purchase_price, reference=x.reference))
        db.add(Movement(tenant_id=user.tenant_id, warehouse_id=destination.id, product_id=product.id, kind="TRANSFERT_ENTREE", quantity=quantity, unit_cost=product.purchase_price, reference=x.reference))
    db.add(Audit(tenant_id=user.tenant_id, user_id=user.id, action="TRANSFERT_STOCK", detail=f"Transfert {x.reference} : {source.name} vers {destination.name}"))
    await db.commit()
    return {"id": transfer.id, "reference": transfer.reference, "status": transfer.status}

@router.get("/stock/valuation")
async def stock_valuation(user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "stock.read", db)
    rows = (await db.execute(
        select(Product.id, Product.sku, Product.name, Product.purchase_price, func.coalesce(func.sum(WarehouseStock.quantity), 0))
        .outerjoin(WarehouseStock, (WarehouseStock.product_id == Product.id) & (WarehouseStock.tenant_id == user.tenant_id))
        .where(Product.tenant_id == user.tenant_id, Product.active.is_(True))
        .group_by(Product.id, Product.sku, Product.name, Product.purchase_price)
        .order_by(Product.name)
    )).all()
    items = [{"product_id": r[0], "sku": r[1], "name": r[2], "unit_cost": float(r[3] or 0), "quantity": float(r[4] or 0), "value": float(r[3] or 0) * float(r[4] or 0)} for r in rows]
    return {"total_value": sum(x["value"] for x in items), "items": items}

class RefundIn(BaseModel):
    reason: str = Field(min_length=3, max_length=300)
    refund_method: str = Field(min_length=3, max_length=24)
    reference: str = Field(default="", max_length=100)
    lines: list[CountLine] = Field(min_length=1)

@router.post("/sales/{sale_id}/refund")
async def sale_refund(sale_id: int, x: RefundIn, user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "sales.refund", db)
    if x.refund_method not in {"ESPECES", "WAVE", "ORANGE_MONEY", "CARTE", "VIREMENT"}:
        raise HTTPException(400, "Mode de remboursement invalide")
    sale = await db.scalar(select(Sale).where(Sale.id == sale_id, Sale.tenant_id == user.tenant_id, Sale.status == "PAYE").with_for_update())
    if not sale:
        raise HTTPException(404, "Vente introuvable, annulée ou déjà remboursée")
    refund_cash = None
    if x.refund_method == "ESPECES":
        refund_cash = await db.scalar(select(Cash).where(Cash.tenant_id == user.tenant_id, Cash.user_id == user.id, Cash.status == "OPEN").with_for_update())
        if not refund_cash:
            raise HTTPException(409, "Ouvrez votre caisse avant un remboursement en espèces")
    original = (await db.scalars(select(SaleLine).where(SaleLine.sale_id == sale.id))).all()
    refund_amount = 0
    requested = {}
    prepared = []
    for item in x.lines:
        line = next((l for l in original if l.product_id == item.product_id), None)
        if not line or item.counted <= 0:
            raise HTTPException(409, "Quantité de retour invalide")
        requested[item.product_id] = requested.get(item.product_id, 0) + item.counted
        already_qty = await db.scalar(select(func.coalesce(func.sum(RefundLine.quantity), 0)).join(Refund, Refund.id == RefundLine.refund_id).where(Refund.sale_id == sale.id, Refund.status == "VALIDE", RefundLine.product_id == item.product_id))
        if float(already_qty or 0) + requested[item.product_id] > line.quantity:
            raise HTTPException(409, "La quantité retournée dépasse la quantité vendue")
        amount = round(line.unit_price * item.counted, 2)
        refund_amount += amount
        # Serialize returns for the same product, including when its warehouse row
        # does not exist yet; the unique stock key alone would only reject a race.
        product = await db.scalar(select(Product).where(Product.id == item.product_id, Product.tenant_id == user.tenant_id).with_for_update())
        if not product:
            raise HTTPException(404, "Article introuvable")
        stock = await db.scalar(select(WarehouseStock).where(WarehouseStock.tenant_id == user.tenant_id, WarehouseStock.warehouse_id == sale.warehouse_id, WarehouseStock.product_id == product.id).with_for_update())
        if stock:
            stock.quantity += item.counted
        else:
            stock = WarehouseStock(tenant_id=user.tenant_id, warehouse_id=sale.warehouse_id, product_id=product.id, quantity=item.counted)
            db.add(stock)
        product.stock += item.counted
        db.add(Movement(tenant_id=user.tenant_id, warehouse_id=sale.warehouse_id, product_id=product.id, kind="RETOUR_CLIENT", quantity=item.counted, unit_cost=product.purchase_price, reference=f"RET-{sale.id}"))
        prepared.append((item.product_id, item.counted, amount))
    already_refunded = await db.scalar(select(func.coalesce(func.sum(Refund.amount), 0)).where(Refund.sale_id == sale.id, Refund.tenant_id == user.tenant_id, Refund.status == "VALIDE"))
    if float(already_refunded or 0) + refund_amount > sale.total + 0.001:
        raise HTTPException(409, "Le cumul des remboursements dépasserait le montant de la vente")
    refund = Refund(tenant_id=user.tenant_id, sale_id=sale.id, user_id=user.id, reason=x.reason, amount=refund_amount)
    db.add(refund)
    await db.flush()
    db.add(RefundPayment(tenant_id=user.tenant_id, refund_id=refund.id, user_id=user.id, method=x.refund_method, amount=refund_amount, reference=x.reference.strip()))
    if refund_cash is not None:
        refund_cash.expected -= refund_amount
    for product_id, quantity, amount in prepared:
        db.add(RefundLine(refund_id=refund.id, product_id=product_id, quantity=quantity, amount=amount))
    db.add(Audit(tenant_id=user.tenant_id, user_id=user.id, action="REMBOURSEMENT", detail=f"Vente {sale.id} : {refund_amount:.0f} FCFA par {x.refund_method}"))
    await db.commit()
    return {"status": "VALIDE", "amount": refund_amount, "refund_method": x.refund_method, "cash_adjusted": refund_cash is not None}

class TableIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    seats: int = Field(default=4, ge=1, le=40)

@router.get("/restaurant/tables")
async def restaurant_tables(user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "restaurant.read", db)
    rows = (await db.scalars(select(RestaurantTable).where(RestaurantTable.tenant_id == user.tenant_id, RestaurantTable.active.is_(True)))).all()
    return [{"id": r.id, "name": r.name, "seats": r.seats} for r in rows]

@router.post("/restaurant/tables")
async def restaurant_table_create(x: TableIn, user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "restaurant.write", db)
    row = RestaurantTable(tenant_id=user.tenant_id, name=x.name, seats=x.seats)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return {"id": row.id, "name": row.name}

class KitchenIn(BaseModel):
    table_id: Optional[int] = None
    note: str = ""
    lines: list[CountLine] = Field(min_length=1)

@router.post("/restaurant/orders")
async def kitchen_order_create(x: KitchenIn, user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "restaurant.write", db)
    if x.table_id and not await db.scalar(select(RestaurantTable).where(RestaurantTable.id == x.table_id, RestaurantTable.tenant_id == user.tenant_id, RestaurantTable.active.is_(True))):
        raise HTTPException(404, "Table introuvable")
    order = KitchenOrder(tenant_id=user.tenant_id, table_id=x.table_id, user_id=user.id, note=x.note)
    db.add(order)
    await db.flush()
    for item in x.lines:
        if item.counted <= 0 or not await db.scalar(select(Product).where(Product.id == item.product_id, Product.tenant_id == user.tenant_id, Product.active.is_(True))):
            raise HTTPException(400, "Article ou quantité invalide")
        db.add(KitchenOrderLine(order_id=order.id, product_id=item.product_id, quantity=item.counted))
    await db.commit()
    return {"id": order.id, "status": order.status}

@router.get("/restaurant/orders")
async def kitchen_orders(user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "restaurant.read", db)
    rows = (await db.scalars(select(KitchenOrder).where(KitchenOrder.tenant_id == user.tenant_id).order_by(KitchenOrder.id.desc()).limit(100))).all()
    return [{"id": r.id, "table_id": r.table_id, "note": r.note, "status": r.status, "created_at": r.created_at} for r in rows]

@router.post("/restaurant/orders/{order_id}/status")
async def kitchen_order_status(order_id: int, status: str, user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "restaurant.write", db)
    if status not in {"A_PREPARER", "EN_PREPARATION", "PRETE", "SERVIE", "ANNULEE"}:
        raise HTTPException(400, "Statut invalide")
    row = await db.scalar(select(KitchenOrder).where(KitchenOrder.id == order_id, KitchenOrder.tenant_id == user.tenant_id))
    if not row:
        raise HTTPException(404, "Commande introuvable")
    row.status = status
    await db.commit()
    return {"id": row.id, "status": row.status}

@router.get("/sales/{sale_id}/invoice")
async def sale_invoice(sale_id: int, user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    sale = await db.scalar(select(Sale).where(Sale.id == sale_id, Sale.tenant_id == user.tenant_id))
    if not sale:
        raise HTTPException(404, "Vente introuvable")
    tenant = await db.get(Tenant, user.tenant_id)
    lines = (await db.execute(select(SaleLine, Product.unit).join(Product, Product.id == SaleLine.product_id).where(SaleLine.sale_id == sale.id))).all()
    rows = "".join(f"<tr><td>{escape(l.label)}</td><td>{l.quantity:g} {escape(str(unit or 'Pièce'))}</td><td>{l.unit_price:,.0f}</td><td>{l.total:,.0f}</td></tr>" for l, unit in lines)
    html = f"""<!doctype html><html lang="fr"><meta charset="utf-8"><title>Ticket {sale.id}</title>
    <style>body{{font:14px Arial;max-width:620px;margin:24px auto;color:#222}}table{{width:100%;border-collapse:collapse}}td,th{{padding:8px;border-bottom:1px solid #ddd;text-align:left}}.total{{text-align:right;font-size:20px;font-weight:bold}}@media print{{button{{display:none}}}}</style>
    <h1>{escape(tenant.name)}</h1><p>{escape(tenant.address or '')} · {escape(tenant.phone or '')}</p>
    <h2>Ticket / Facture #{sale.id}</h2><p>Date : {sale.created_at:%d/%m/%Y %H:%M}</p>
    <table><thead><tr><th>Article</th><th>Qté</th><th>PU</th><th>Total</th></tr></thead><tbody>{rows}</tbody></table>
    <p class="total">Total TTC : {sale.total:,.0f} FCFA</p><button onclick="window.print()">Imprimer</button></html>"""
    return Response(content=html, media_type="text/html; charset=utf-8")

class CompanyIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    mode: str = "HYBRIDE"
    address: str = ""
    phone: str = ""
    ninea: str = ""
    rc: str = ""
    currency: str = "FCFA"
    tax_rate: float = Field(default=18, ge=0, le=100)
    admin_name: str = Field(min_length=2, max_length=120)
    admin_email: str = Field(min_length=5, max_length=160)
    admin_password: str = Field(min_length=8, max_length=128)

@router.post("/platform/bootstrap")
async def platform_bootstrap(x: CompanyIn, bootstrap_key: str = Header(default="", alias="X-Platform-Bootstrap-Key"), db: AsyncSession = Depends(dbdep)):
    configured = os.getenv("PLATFORM_BOOTSTRAP_KEY", "")
    if not configured or not secrets.compare_digest(bootstrap_key, configured):
        raise HTTPException(403, "Provisionnement plateforme non autorisé")
    existing = await db.scalar(select(User).where(User.role == "SUPER_ADMIN"))
    if existing:
        raise HTTPException(409, "Le Super Admin plateforme existe déjà")
    email = x.admin_email.strip().lower()
    if await db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "Adresse e-mail déjà utilisée")
    admin = User(tenant_id=None, email=email, name=x.admin_name, password_hash=hasher.hash(x.admin_password), role="SUPER_ADMIN", active=True)
    db.add(admin)
    await db.commit()
    return {"status": "created", "email": email}

@router.get("/platform/companies")
async def platform_companies(user: User = Depends(auth), db: AsyncSession = Depends(dbdep)):
    if user.role != "SUPER_ADMIN":
        raise HTTPException(403, "Réservé au Super Admin plateforme")
    rows = (await db.execute(select(Tenant, Subscription).outerjoin(Subscription, Subscription.tenant_id == Tenant.id).order_by(Tenant.id))).all()
    tenant_ids = [t.id for t, _ in rows]
    payment_rows = (await db.scalars(select(SubscriptionPayment).where(SubscriptionPayment.tenant_id.in_(tenant_ids)).order_by(SubscriptionPayment.created_at.desc()))).all() if tenant_ids else []
    payments_by_tenant: dict[int, list[dict]] = {}
    for payment in payment_rows:
        payments_by_tenant.setdefault(payment.tenant_id, []).append({"id": payment.id, "provider": payment.provider, "amount": payment.amount, "currency": payment.currency, "reference": payment.reference, "period_months": payment.period_months, "status": payment.status, "note": payment.note, "verified_at": payment.verified_at})
    return [{"id": t.id, "name": t.name, "mode": t.mode, "phone": t.phone, "currency": t.currency, "subscription": ({"plan": sub.plan, "status": sub.status, "monthly_price": sub.monthly_price, "starts_at": sub.starts_at, "ends_at": sub.ends_at} if sub else None), "payments": payments_by_tenant.get(t.id, [])[:10]} for t, sub in rows]

@router.post("/platform/companies")
async def platform_company_create(x: CompanyIn, user: User = Depends(auth), db: AsyncSession = Depends(dbdep)):
    if user.role != "SUPER_ADMIN":
        raise HTTPException(403, "Réservé au Super Admin plateforme")
    email = x.admin_email.strip().lower()
    if await db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "Adresse e-mail déjà utilisée")
    tenant = Tenant(name=x.name, mode=x.mode, address=x.address, phone=x.phone, ninea=x.ninea, rc=x.rc, currency=x.currency, tax_rate=x.tax_rate)
    db.add(tenant)
    await db.flush()
    admin = User(tenant_id=tenant.id, email=email, name=x.admin_name, password_hash=hasher.hash(x.admin_password), role="ADMIN", active=True)
    db.add(admin)
    db.add(Subscription(tenant_id=tenant.id, plan="ESSENTIEL", status="SUSPENDU", monthly_price=0))
    await db.commit()
    return {"id": tenant.id, "name": tenant.name, "admin_email": email}

@router.get("/sales/export.csv")
async def sales_export(user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    rows = (await db.scalars(select(Sale).where(Sale.tenant_id == user.tenant_id).order_by(Sale.created_at.desc()))).all()
    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow(["Vente", "Date", "Statut", "Canal", "Sous-total", "Taxes", "Total FCFA"])
    for sale in rows:
        writer.writerow([sale.id, sale.created_at.isoformat(), sale.status, sale.channel, sale.subtotal, sale.tax, sale.total])
    return Response(content="\\ufeff" + output.getvalue(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": "attachment; filename=idiaba-ventes.csv"})

@router.get("/platform/overview")
async def platform_overview(user: User = Depends(auth), db: AsyncSession = Depends(dbdep)):
    if user.role != "SUPER_ADMIN":
        raise HTTPException(403, "Réservé au Super Admin plateforme")
    tenants = await db.scalar(select(func.count(Tenant.id)))
    users = await db.scalar(select(func.count(User.id)))
    subscriptions = (await db.scalars(select(Subscription))).all()
    return {"companies": tenants or 0, "users": users or 0, "subscriptions": [{"tenant_id": s.tenant_id, "plan": s.plan, "status": s.status, "monthly_price": s.monthly_price, "ends_at": s.ends_at} for s in subscriptions]}

class PlatformPaymentSettingsIn(BaseModel):
    wave_enabled: bool = False
    wave_name: str = Field(default="", max_length=120)
    wave_phone: str = Field(default="", max_length=40)
    wave_link: str = Field(default="", max_length=500)
    orange_enabled: bool = False
    orange_name: str = Field(default="", max_length=120)
    orange_phone: str = Field(default="", max_length=40)
    orange_link: str = Field(default="", max_length=500)
    instructions: str = Field(default="", max_length=500)

def _payment_settings_payload(row: Optional[PlatformPaymentSettings] = None):
    return {
        "wave_enabled": bool(row.wave_enabled) if row else False,
        "wave_name": row.wave_name if row else "",
        "wave_phone": row.wave_phone if row else "",
        "wave_link": row.wave_link if row else "",
        "orange_enabled": bool(row.orange_enabled) if row else False,
        "orange_name": row.orange_name if row else "",
        "orange_phone": row.orange_phone if row else "",
        "orange_link": row.orange_link if row else "",
        "instructions": row.instructions if row else "",
    }

@router.get("/public/payment-instructions")
async def public_payment_instructions(db: AsyncSession = Depends(dbdep)):
    """Ne publie que les moyens de paiement explicitement activés par le Super Admin."""
    row = await db.get(PlatformPaymentSettings, 1)
    providers = []
    if row and row.wave_enabled and (row.wave_phone or row.wave_link):
        providers.append({
            "key": "WAVE",
            "label": "Wave",
            "beneficiary": row.wave_name or "",
            "phone": row.wave_phone or "",
            "link": row.wave_link or "",
        })
    if row and row.orange_enabled and (row.orange_phone or row.orange_link):
        providers.append({
            "key": "ORANGE_MONEY",
            "label": "Orange Money",
            "beneficiary": row.orange_name or "",
            "phone": row.orange_phone or "",
            "link": row.orange_link or "",
        })
    return {
        "providers": providers,
        "instructions": row.instructions if row else "",
        "available": bool(providers),
    }

@router.get("/platform/payment-settings")
async def platform_payment_settings_get(user: User = Depends(auth), db: AsyncSession = Depends(dbdep)):
    if user.role != "SUPER_ADMIN":
        raise HTTPException(403, "Réservé au Super Admin plateforme")
    row = await db.get(PlatformPaymentSettings, 1)
    return _payment_settings_payload(row)

@router.put("/platform/payment-settings")
async def platform_payment_settings_save(x: PlatformPaymentSettingsIn, user: User = Depends(auth), db: AsyncSession = Depends(dbdep)):
    if user.role != "SUPER_ADMIN":
        raise HTTPException(403, "Réservé au Super Admin plateforme")
    for label, enabled, phone, link in (
        ("Wave", x.wave_enabled, x.wave_phone.strip(), x.wave_link.strip()),
        ("Orange Money", x.orange_enabled, x.orange_phone.strip(), x.orange_link.strip()),
    ):
        if enabled and not (phone or link):
            raise HTTPException(400, f"Renseignez un numéro ou un lien de paiement {label} avant de l'activer.")
        if link and not (link.startswith("https://") or link.startswith("http://")):
            raise HTTPException(400, f"Le lien {label} doit commencer par https:// ou http://.")
    row = await db.get(PlatformPaymentSettings, 1)
    if row is None:
        row = PlatformPaymentSettings(id=1)
        db.add(row)
    for key, value in x.model_dump().items():
        setattr(row, key, value.strip() if isinstance(value, str) else value)
    await db.commit()
    await db.refresh(row)
    return _payment_settings_payload(row)

class ManualSubscriptionPaymentIn(BaseModel):
    provider: str = Field(pattern=r"^(WAVE|ORANGE_MONEY)$")
    amount: int = Field(gt=0)
    reference: str = Field(min_length=3, max_length=120)
    period_months: int = Field(default=1, ge=1, le=12)
    note: str = Field(default="", max_length=500)
    confirm_receipt: bool

@router.post("/platform/companies/{tenant_id}/payments")
async def record_subscription_payment(tenant_id: int, x: ManualSubscriptionPaymentIn, user: User = Depends(auth), db: AsyncSession = Depends(dbdep)):
    if user.role != "SUPER_ADMIN":
        raise HTTPException(403, "Réservé au Super Admin plateforme")
    if not x.confirm_receipt:
        raise HTTPException(400, "Confirmez la vérification du reçu avant validation.")
    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(404, "Entreprise introuvable")
    subscription = await db.scalar(select(Subscription).where(Subscription.tenant_id == tenant_id).with_for_update())
    if not subscription:
        raise HTTPException(409, "Configurez dabord un abonnement pour cette entreprise.")
    reference = x.reference.strip()
    duplicate = await db.scalar(select(SubscriptionPayment).where(SubscriptionPayment.provider == x.provider, SubscriptionPayment.reference == reference))
    if duplicate:
        raise HTTPException(409, "Cette référence de paiement a déjà été enregistrée.")
    monthly_price = round(float(subscription.monthly_price or 0))
    expected_amount = monthly_price * x.period_months
    if monthly_price <= 0:
        raise HTTPException(409, "Définissez dabord le tarif mensuel de labonnement.")
    if x.amount != expected_amount:
        raise HTTPException(400, f"Montant attendu : {expected_amount} FCFA pour {x.period_months} mois.")
    now = datetime.utcnow()
    base = subscription.ends_at.replace(tzinfo=None) if subscription.ends_at and subscription.ends_at.tzinfo else subscription.ends_at
    if base is None or base < now:
        base = now
    month_index = base.year * 12 + (base.month - 1) + x.period_months
    year, month_zero = divmod(month_index, 12)
    month = month_zero + 1
    day = min(base.day, calendar.monthrange(year, month)[1])
    ends_at = base.replace(year=year, month=month, day=day, hour=23, minute=59, second=59, microsecond=0)
    payment = SubscriptionPayment(tenant_id=tenant_id, provider=x.provider, amount=expected_amount, currency="FCFA", reference=reference, period_months=x.period_months, status="VERIFIE", note=x.note.strip(), verified_by=user.id, created_at=now, verified_at=now)
    db.add(payment)
    subscription.status = "ACTIF"
    subscription.starts_at = subscription.starts_at or now
    subscription.ends_at = ends_at
    await db.commit()
    return {"id": payment.id, "status": payment.status, "provider": payment.provider, "amount": payment.amount, "reference": payment.reference, "period_months": payment.period_months, "subscription_status": subscription.status, "ends_at": ends_at}
class PublicRegistrationIn(BaseModel):
    company_name: str = Field(min_length=2, max_length=160)
    mode: str = Field(default="HYBRIDE", pattern=r"^(COMMERCE|RESTAURANT|HYBRIDE)$")
    address: str = Field(default="", max_length=200)
    phone: str = Field(min_length=6, max_length=40)
    admin_name: str = Field(min_length=2, max_length=120)
    admin_email: str = Field(min_length=5, max_length=160, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    admin_password: str = Field(min_length=10, max_length=128)
    terms_accepted: bool

class RegistrationReviewIn(BaseModel):
    decision: str = Field(pattern=r"^(APPROUVER|REFUSER)$")
    note: str = Field(default="", max_length=500)

@router.post("/public/registrations")
async def public_registration(x: PublicRegistrationIn, db: AsyncSession = Depends(dbdep)):
    if not x.terms_accepted:
        raise HTTPException(400, "Veuillez accepter les conditions d'utilisation.")
    email = x.admin_email.strip().lower()
    if await db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "Cette adresse e-mail possède déjà un compte.")
    pending = await db.scalar(select(RegistrationRequest).where(
        RegistrationRequest.admin_email == email,
        RegistrationRequest.status == "EN_ATTENTE"
    ))
    if pending:
        raise HTTPException(409, "Une demande avec cette adresse e-mail est déjà en attente.")
    request = RegistrationRequest(
        company_name=x.company_name.strip(), mode=x.mode, address=x.address.strip(),
        phone=x.phone.strip(), admin_name=x.admin_name.strip(), admin_email=email,
        password_hash=hasher.hash(x.admin_password), status="EN_ATTENTE"
    )
    db.add(request)
    await db.commit()
    await db.refresh(request)
    return {"id": request.id, "status": request.status, "message": "Demande envoyée. Elle sera examinée par l'équipe iDIABA."}

@router.get("/platform/registrations")
async def platform_registrations(user: User = Depends(auth), db: AsyncSession = Depends(dbdep)):
    if user.role != "SUPER_ADMIN":
        raise HTTPException(403, "Réservé au Super Admin plateforme")
    rows = (await db.scalars(select(RegistrationRequest).order_by(RegistrationRequest.created_at.desc()).limit(200))).all()
    return [{
        "id": row.id, "company_name": row.company_name, "mode": row.mode,
        "address": row.address, "phone": row.phone, "admin_name": row.admin_name,
        "admin_email": row.admin_email, "status": row.status, "review_note": row.review_note,
        "created_at": row.created_at
    } for row in rows]

@router.post("/platform/registrations/{registration_id}/review")
async def review_registration(registration_id: int, x: RegistrationReviewIn, user: User = Depends(auth), db: AsyncSession = Depends(dbdep)):
    if user.role != "SUPER_ADMIN":
        raise HTTPException(403, "Réservé au Super Admin plateforme")
    request = await db.scalar(select(RegistrationRequest).where(RegistrationRequest.id == registration_id).with_for_update())
    if not request:
        raise HTTPException(404, "Demande introuvable")
    if request.status != "EN_ATTENTE":
        raise HTTPException(409, "Cette demande a déjà été traitée.")
    if x.decision == "REFUSER":
        request.status = "REFUSEE"
        request.password_hash = None
        request.review_note = x.note.strip()
        request.reviewed_at = datetime.utcnow()
        await db.commit()
        return {"id": request.id, "status": request.status}
    if await db.scalar(select(User).where(User.email == request.admin_email)):
        raise HTTPException(409, "Cette adresse e-mail est déjà utilisée par un compte.")
    tenant = Tenant(name=request.company_name, mode=request.mode, address=request.address, phone=request.phone, currency="FCFA", tax_rate=18)
    db.add(tenant)
    await db.flush()
    admin = User(tenant_id=tenant.id, email=request.admin_email, name=request.admin_name,
                 password_hash=request.password_hash, role="ADMIN", active=True)
    db.add(admin)
    # L'entreprise est créée sans accès opérationnel tant que le Super Admin
    # n'a pas choisi une formule, un tarif et une échéance.
    db.add(Subscription(tenant_id=tenant.id, plan="ESSENTIEL", status="SUSPENDU", monthly_price=0))
    request.status = "APPROUVEE"
    request.password_hash = None
    request.review_note = x.note.strip()
    request.reviewed_at = datetime.utcnow()
    await db.commit()
    return {"id": request.id, "status": request.status, "tenant_id": tenant.id, "admin_email": request.admin_email}

class SubscriptionIn(BaseModel):
    plan: str = Field(pattern=r"^(ESSENTIEL|PRO|RESTAURANT|ENTREPRISE)$")
    status: str = Field(pattern=r"^(ESSAI|ACTIF|SUSPENDU|RESILIE)$")
    monthly_price: float = Field(ge=0)
    ends_at: Optional[datetime] = None

@router.put("/platform/companies/{tenant_id}/subscription")
async def platform_subscription(tenant_id: int, x: SubscriptionIn, user: User = Depends(auth), db: AsyncSession = Depends(dbdep)):
    if user.role != "SUPER_ADMIN":
        raise HTTPException(403, "Réservé au Super Admin plateforme")
    if not await db.get(Tenant, tenant_id):
        raise HTTPException(404, "Entreprise introuvable")
    sub = await db.scalar(select(Subscription).where(Subscription.tenant_id == tenant_id))
    if not sub:
        sub = Subscription(tenant_id=tenant_id)
        db.add(sub)
    sub.plan, sub.status, sub.monthly_price, sub.ends_at = x.plan, x.status, x.monthly_price, x.ends_at
    await db.commit()
    return {"tenant_id": tenant_id, "plan": sub.plan, "status": sub.status}

app.include_router(router)
