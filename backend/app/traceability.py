"""Traçabilité des lots/séries, variantes catalogue et tarifs clients."""
from datetime import datetime, date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import String, Float, Integer, DateTime, Date, ForeignKey, UniqueConstraint, select
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.ext.asyncio import AsyncSession
from app.main import Base, app, dbdep, User, Product, Customer, Warehouse, WarehouseStock, Movement, Audit, tenant_auth
from app.advanced import permitted

router = APIRouter(prefix="/api", tags=["traçabilité et tarifs"])


class ProductTraceability(Base):
    __tablename__ = "product_traceability"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), unique=True, index=True)
    mode: Mapped[str] = mapped_column(String(12), default="NONE")


class StockBatch(Base):
    __tablename__ = "stock_batches"
    __table_args__ = (
        UniqueConstraint("tenant_id", "product_id", "warehouse_id", "batch_code", name="uq_batch_tenant_product_warehouse_code"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"), index=True)
    batch_code: Mapped[str] = mapped_column(String(80))
    expiry_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True, index=True)
    received_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    quantity_received: Mapped[float] = mapped_column(Float)
    quantity_available: Mapped[float] = mapped_column(Float)
    unit_cost: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(16), default="ACTIF")


class SerialNumber(Base):
    __tablename__ = "product_serial_numbers"
    __table_args__ = (UniqueConstraint("tenant_id", "serial_number", name="uq_serial_tenant_number"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"), index=True)
    batch_id: Mapped[Optional[int]] = mapped_column(ForeignKey("stock_batches.id"), nullable=True)
    serial_number: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(16), default="EN_STOCK", index=True)
    sale_id: Mapped[Optional[int]] = mapped_column(ForeignKey("sales.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ProductVariant(Base):
    __tablename__ = "product_variants"
    __table_args__ = (
        UniqueConstraint("tenant_id", "sku", name="uq_variant_tenant_sku"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    parent_product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), unique=True)
    sku: Mapped[str] = mapped_column(String(50))
    attributes: Mapped[str] = mapped_column(String(500), default="{}")


class CustomerPriceList(Base):
    __tablename__ = "customer_price_lists"
    __table_args__ = (UniqueConstraint("tenant_id", "name", name="uq_price_list_tenant_name"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    currency: Mapped[str] = mapped_column(String(10), default="FCFA")
    active: Mapped[bool] = mapped_column(default=True)


class CustomerPriceListItem(Base):
    __tablename__ = "customer_price_list_items"
    __table_args__ = (UniqueConstraint("price_list_id", "product_id", name="uq_price_list_product"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    price_list_id: Mapped[int] = mapped_column(ForeignKey("customer_price_lists.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    unit_price: Mapped[float] = mapped_column(Float)


class CustomerPriceAssignment(Base):
    __tablename__ = "customer_price_assignments"
    __table_args__ = (UniqueConstraint("tenant_id", "customer_id", name="uq_customer_price_assignment"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)
    price_list_id: Mapped[int] = mapped_column(ForeignKey("customer_price_lists.id"), index=True)


class TrackingIn(BaseModel):
    product_id: int
    mode: str = Field(pattern=r"^(NONE|LOT|SERIAL)$")


class BatchReceiptLine(BaseModel):
    product_id: int
    batch_code: str = Field(min_length=1, max_length=80)
    expiry_date: Optional[date] = None
    quantity: float = Field(gt=0)
    unit_cost: float = Field(default=0, ge=0)
    serial_numbers: list[str] = Field(default_factory=list, max_length=500)


class BatchReceiptIn(BaseModel):
    warehouse_id: int
    reference: str = Field(min_length=2, max_length=80)
    lines: list[BatchReceiptLine] = Field(min_length=1, max_length=200)


class VariantIn(BaseModel):
    parent_product_id: int
    sku: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=150)
    barcode: str = ""
    attributes: dict[str, str] = Field(default_factory=dict)
    sale_price: float = Field(ge=0)


class PriceListIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    currency: str = Field(default="FCFA", max_length=10)


class PriceItemIn(BaseModel):
    product_id: int
    unit_price: float = Field(ge=0)


class AssignPriceListIn(BaseModel):
    customer_id: int
    price_list_id: int


async def _product(db, tenant_id, product_id, lock=False):
    query = select(Product).where(Product.id == product_id, Product.tenant_id == tenant_id)
    if lock:
        query = query.with_for_update()
    product = await db.scalar(query)
    if not product:
        raise HTTPException(404, "Article introuvable dans cette entreprise")
    return product


@router.get("/traceability/settings")
async def tracking_settings(user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "catalog.read", db)
    rows = (await db.execute(
        select(ProductTraceability, Product).join(Product, Product.id == ProductTraceability.product_id)
        .where(ProductTraceability.tenant_id == user.tenant_id)
    )).all()
    return [{"product_id": policy.product_id, "product_name": product.name, "mode": policy.mode}
            for policy, product in rows]


@router.put("/traceability/settings")
async def tracking_setting_update(x: TrackingIn, user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "catalog.write", db)
    product = await _product(db, user.tenant_id, x.product_id)
    policy = await db.scalar(select(ProductTraceability).where(
        ProductTraceability.tenant_id == user.tenant_id,
        ProductTraceability.product_id == product.id
    ).with_for_update())
    if x.mode == "NONE":
        active_batches = await db.scalar(select(StockBatch.id).where(
            StockBatch.tenant_id == user.tenant_id, StockBatch.product_id == product.id,
            StockBatch.quantity_available > 0
        ).limit(1))
        active_serials = await db.scalar(select(SerialNumber.id).where(
            SerialNumber.tenant_id == user.tenant_id, SerialNumber.product_id == product.id,
            SerialNumber.status == "EN_STOCK"
        ).limit(1))
        if active_batches or active_serials:
            raise HTTPException(409, "Impossible de désactiver le suivi tant que des lots ou numéros sont en stock")
    if policy is None:
        policy = ProductTraceability(tenant_id=user.tenant_id, product_id=product.id, mode=x.mode)
        db.add(policy)
    else:
        policy.mode = x.mode
    await db.commit()
    return {"product_id": product.id, "mode": x.mode}


@router.post("/traceability/receipts")
async def batch_receipt(x: BatchReceiptIn, user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "stock.write", db)
    warehouse = await db.scalar(select(Warehouse).where(
        Warehouse.id == x.warehouse_id, Warehouse.tenant_id == user.tenant_id
    ))
    if not warehouse:
        raise HTTPException(404, "Dépôt introuvable")
    prepared = []
    for line in x.lines:
        product = await _product(db, user.tenant_id, line.product_id, True)
        policy = await db.scalar(select(ProductTraceability).where(
            ProductTraceability.tenant_id == user.tenant_id,
            ProductTraceability.product_id == product.id
        ))
        mode = policy.mode if policy else "NONE"
        if mode == "NONE":
            raise HTTPException(409, f"Activez le suivi par lot ou numéro de série pour {product.name}")
        serials = [value.strip() for value in line.serial_numbers if value.strip()]
        if mode == "SERIAL" and len(serials) != int(line.quantity):
            raise HTTPException(400, f"{product.name} : un numéro de série est requis pour chaque unité entière")
        if mode == "SERIAL" and (abs(line.quantity - round(line.quantity)) > 1e-9 or len(set(serials)) != len(serials)):
            raise HTTPException(400, "Les numéros de série doivent être uniques et la quantité entière")
        if mode == "LOT" and serials:
            raise HTTPException(400, "Les numéros de série ne sont pas autorisés pour un article suivi par lot")
        prepared.append((product, line, mode, serials))
    for product, line, mode, serials in prepared:
        batch = await db.scalar(select(StockBatch).where(
            StockBatch.tenant_id == user.tenant_id, StockBatch.product_id == product.id,
            StockBatch.warehouse_id == warehouse.id, StockBatch.batch_code == line.batch_code.strip()
        ).with_for_update())
        if batch:
            if batch.expiry_date != line.expiry_date:
                raise HTTPException(409, "Un lot existant ne peut pas changer de date de péremption")
            batch.quantity_received += line.quantity
            batch.quantity_available += line.quantity
        else:
            batch = StockBatch(
                tenant_id=user.tenant_id, product_id=product.id, warehouse_id=warehouse.id,
                batch_code=line.batch_code.strip(), expiry_date=line.expiry_date,
                quantity_received=line.quantity, quantity_available=line.quantity,
                unit_cost=line.unit_cost
            )
            db.add(batch)
            await db.flush()
        for serial in serials:
            exists = await db.scalar(select(SerialNumber.id).where(
                SerialNumber.tenant_id == user.tenant_id, SerialNumber.serial_number == serial
            ))
            if exists:
                raise HTTPException(409, f"Numéro de série déjà enregistré : {serial}")
            db.add(SerialNumber(
                tenant_id=user.tenant_id, product_id=product.id, warehouse_id=warehouse.id,
                batch_id=batch.id, serial_number=serial
            ))
        stock = await db.scalar(select(WarehouseStock).where(
            WarehouseStock.tenant_id == user.tenant_id, WarehouseStock.warehouse_id == warehouse.id,
            WarehouseStock.product_id == product.id
        ).with_for_update())
        if stock is None:
            stock = WarehouseStock(tenant_id=user.tenant_id, warehouse_id=warehouse.id, product_id=product.id, quantity=0)
            db.add(stock)
        stock.quantity += line.quantity
        product.stock += line.quantity
        db.add(Movement(
            tenant_id=user.tenant_id, warehouse_id=warehouse.id, product_id=product.id,
            kind="ENTREE_LOT", quantity=line.quantity, unit_cost=line.unit_cost, reference=x.reference
        ))
    db.add(Audit(tenant_id=user.tenant_id, user_id=user.id, action="RECEPTION_LOTS",
                 detail=f"Réception tracée {x.reference}"))
    await db.commit()
    return {"reference": x.reference, "received_lines": len(prepared)}


@router.get("/traceability/batches")
async def batches_list(user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "stock.read", db)
    rows = (await db.execute(
        select(StockBatch, Product, Warehouse)
        .join(Product, Product.id == StockBatch.product_id)
        .join(Warehouse, Warehouse.id == StockBatch.warehouse_id)
        .where(StockBatch.tenant_id == user.tenant_id)
        .order_by(StockBatch.expiry_date.asc(), StockBatch.id.desc())
        .limit(1000)
    )).all()
    return [{
        "id": batch.id, "product_id": product.id, "product_name": product.name,
        "warehouse_id": warehouse.id, "warehouse_name": warehouse.name,
        "batch_code": batch.batch_code, "expiry_date": batch.expiry_date,
        "quantity_received": batch.quantity_received, "quantity_available": batch.quantity_available,
        "unit_cost": batch.unit_cost, "status": "EPUISE" if batch.quantity_available <= 1e-9 else
            ("PERIME" if batch.expiry_date and batch.expiry_date < date.today() else batch.status)
    } for batch, product, warehouse in rows]


@router.get("/traceability/serials")
async def serials_list(product_id: Optional[int] = None, status: Optional[str] = None,
                       user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "stock.read", db)
    query = select(SerialNumber, Product).join(Product, Product.id == SerialNumber.product_id).where(
        SerialNumber.tenant_id == user.tenant_id
    )
    if product_id is not None:
        query = query.where(SerialNumber.product_id == product_id)
    if status:
        query = query.where(SerialNumber.status == status)
    rows = (await db.execute(query.order_by(SerialNumber.id.desc()).limit(1000))).all()
    return [{"id": serial.id, "product_id": product.id, "product_name": product.name,
             "serial_number": serial.serial_number, "status": serial.status,
             "warehouse_id": serial.warehouse_id, "sale_id": serial.sale_id}
            for serial, product in rows]


@router.get("/product-variants")
async def variants_list(user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "catalog.read", db)
    rows = (await db.execute(
        select(ProductVariant, Product, Product)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(ProductVariant.tenant_id == user.tenant_id)
        .order_by(ProductVariant.id.desc())
    )).all()
    result = []
    for variant, child in rows:
        parent = await _product(db, user.tenant_id, variant.parent_product_id)
        result.append({"id": variant.id, "parent_product_id": parent.id, "parent_name": parent.name,
                       "product_id": child.id, "name": child.name, "sku": variant.sku,
                       "barcode": child.barcode, "sale_price": child.sale_price,
                       "attributes": __import__("json").loads(variant.attributes or "{}")})
    return result


@router.post("/product-variants")
async def variant_create(x: VariantIn, user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "catalog.write", db)
    parent = await _product(db, user.tenant_id, x.parent_product_id)
    if await db.scalar(select(Product.id).where(Product.tenant_id == user.tenant_id, Product.sku == x.sku.strip())):
        raise HTTPException(409, "Cette référence article existe déjà")
    child = Product(
        tenant_id=user.tenant_id, sku=x.sku.strip(), barcode=x.barcode,
        name=x.name.strip(), category=parent.category, unit=parent.unit,
        purchase_price=parent.purchase_price, sale_price=x.sale_price,
        tax_rate=parent.tax_rate, stock=0, min_stock=0, kind="SIMPLE", active=True
    )
    db.add(child)
    await db.flush()
    variant = ProductVariant(
        tenant_id=user.tenant_id, parent_product_id=parent.id, product_id=child.id,
        sku=child.sku, attributes=__import__("json").dumps(x.attributes, ensure_ascii=False)
    )
    db.add(variant)
    db.add(Audit(tenant_id=user.tenant_id, user_id=user.id, action="VARIANTE_CREEE",
                 detail=f"Variante {child.sku} du produit {parent.sku}"))
    await db.commit()
    return {"id": variant.id, "product_id": child.id, "sku": child.sku}


@router.get("/customer-price-lists")
async def price_lists(user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "sales.read", db)
    lists = (await db.scalars(select(CustomerPriceList).where(
        CustomerPriceList.tenant_id == user.tenant_id
    ).order_by(CustomerPriceList.id.desc()))).all()
    result = []
    for item in lists:
        lines = (await db.scalars(select(CustomerPriceListItem).where(
            CustomerPriceListItem.price_list_id == item.id
        ))).all()
        result.append({"id": item.id, "name": item.name, "currency": item.currency, "active": item.active,
                       "items": [{"product_id": line.product_id, "unit_price": line.unit_price} for line in lines]})
    return result


@router.post("/customer-price-lists")
async def price_list_create(x: PriceListIn, user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "sales.write", db)
    item = CustomerPriceList(tenant_id=user.tenant_id, name=x.name.strip(), currency=x.currency)
    db.add(item)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(409, "Une grille tarifaire porte déjà ce nom")
    return {"id": item.id, "name": item.name}


@router.put("/customer-price-lists/{list_id}/items")
async def price_list_items(list_id: int, items: list[PriceItemIn], user: User = Depends(tenant_auth),
                           db: AsyncSession = Depends(dbdep)):
    await permitted(user, "sales.write", db)
    price_list = await db.scalar(select(CustomerPriceList).where(
        CustomerPriceList.id == list_id, CustomerPriceList.tenant_id == user.tenant_id
    ).with_for_update())
    if not price_list:
        raise HTTPException(404, "Grille tarifaire introuvable")
    if len({item.product_id for item in items}) != len(items):
        raise HTTPException(400, "Un article apparaît plusieurs fois")
    for item in items:
        await _product(db, user.tenant_id, item.product_id)
    existing = (await db.scalars(select(CustomerPriceListItem).where(
        CustomerPriceListItem.price_list_id == price_list.id
    ))).all()
    for row in existing:
        await db.delete(row)
    for item in items:
        db.add(CustomerPriceListItem(price_list_id=price_list.id, product_id=item.product_id,
                                     unit_price=item.unit_price))
    await db.commit()
    return {"price_list_id": list_id, "items": len(items)}


@router.post("/customer-price-lists/assign")
async def assign_price_list(x: AssignPriceListIn, user: User = Depends(tenant_auth),
                            db: AsyncSession = Depends(dbdep)):
    await permitted(user, "sales.write", db)
    customer = await db.scalar(select(Customer).where(
        Customer.id == x.customer_id, Customer.tenant_id == user.tenant_id
    ))
    price_list = await db.scalar(select(CustomerPriceList).where(
        CustomerPriceList.id == x.price_list_id, CustomerPriceList.tenant_id == user.tenant_id,
        CustomerPriceList.active.is_(True)
    ))
    if not customer or not price_list:
        raise HTTPException(404, "Client ou grille tarifaire introuvable")
    assignment = await db.scalar(select(CustomerPriceAssignment).where(
        CustomerPriceAssignment.tenant_id == user.tenant_id,
        CustomerPriceAssignment.customer_id == customer.id
    ).with_for_update())
    if assignment is None:
        assignment = CustomerPriceAssignment(tenant_id=user.tenant_id, customer_id=customer.id,
                                             price_list_id=price_list.id)
        db.add(assignment)
    else:
        assignment.price_list_id = price_list.id
    await db.commit()
    return {"customer_id": customer.id, "price_list_id": price_list.id}


@router.get("/customers/{customer_id}/prices/{product_id}")
async def customer_product_price(customer_id: int, product_id: int, user: User = Depends(tenant_auth),
                                 db: AsyncSession = Depends(dbdep)):
    await permitted(user, "sales.read", db)
    customer = await db.scalar(select(Customer).where(
        Customer.id == customer_id, Customer.tenant_id == user.tenant_id
    ))
    product = await _product(db, user.tenant_id, product_id)
    if not customer:
        raise HTTPException(404, "Client introuvable")
    assignment = await db.scalar(select(CustomerPriceAssignment).where(
        CustomerPriceAssignment.tenant_id == user.tenant_id,
        CustomerPriceAssignment.customer_id == customer.id
    ))
    if assignment:
        price = await db.scalar(select(CustomerPriceListItem.unit_price).join(
            CustomerPriceList, CustomerPriceList.id == CustomerPriceListItem.price_list_id
        ).where(
            CustomerPriceList.id == assignment.price_list_id,
            CustomerPriceList.tenant_id == user.tenant_id,
            CustomerPriceList.active.is_(True),
            CustomerPriceListItem.product_id == product.id
        ))
        if price is not None:
            return {"customer_id": customer.id, "product_id": product.id, "unit_price": price,
                    "source": "GRILLE_CLIENT"}
    return {"customer_id": customer.id, "product_id": product.id, "unit_price": product.sale_price,
            "source": "TARIF_STANDARD"}


app.include_router(router)
