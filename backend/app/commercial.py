"""Devis, commandes clients, réservations et livraisons partielles.
Toutes les opérations sont isolées par tenant. Les mouvements de stock ne sont
créés qu'à la validation d'un bon de livraison.
"""
from datetime import datetime, date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import String, Float, Integer, DateTime, Date, ForeignKey, UniqueConstraint, select, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import (
    Base, app, dbdep, User, Product, Customer, Warehouse, WarehouseStock,
    Movement, Audit, tenant_auth
)
from app.advanced import permitted

router = APIRouter(prefix="/api", tags=["devis et commandes clients"])


class Quote(Base):
    __tablename__ = "customer_quotes"
    __table_args__ = (UniqueConstraint("tenant_id", "reference", name="uq_customer_quotes_tenant_reference"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)
    reference: Mapped[str] = mapped_column(String(60))
    status: Mapped[str] = mapped_column(String(20), default="BROUILLON", index=True)
    issue_date: Mapped[date] = mapped_column(Date, default=date.today)
    valid_until: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    subtotal: Mapped[float] = mapped_column(Float, default=0)
    tax: Mapped[float] = mapped_column(Float, default=0)
    total: Mapped[float] = mapped_column(Float, default=0)
    note: Mapped[str] = mapped_column(String(500), default="")
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class QuoteLine(Base):
    __tablename__ = "customer_quote_lines"
    id: Mapped[int] = mapped_column(primary_key=True)
    quote_id: Mapped[int] = mapped_column(ForeignKey("customer_quotes.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    label: Mapped[str] = mapped_column(String(160))
    quantity: Mapped[float] = mapped_column(Float)
    unit_price: Mapped[float] = mapped_column(Float)
    tax_rate: Mapped[float] = mapped_column(Float, default=0)
    total: Mapped[float] = mapped_column(Float)


class CustomerOrder(Base):
    __tablename__ = "customer_orders"
    __table_args__ = (UniqueConstraint("tenant_id", "reference", name="uq_customer_orders_tenant_reference"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)
    quote_id: Mapped[Optional[int]] = mapped_column(ForeignKey("customer_quotes.id"), nullable=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"))
    reference: Mapped[str] = mapped_column(String(60))
    status: Mapped[str] = mapped_column(String(24), default="BROUILLON", index=True)
    subtotal: Mapped[float] = mapped_column(Float, default=0)
    tax: Mapped[float] = mapped_column(Float, default=0)
    total: Mapped[float] = mapped_column(Float, default=0)
    note: Mapped[str] = mapped_column(String(500), default="")
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class CustomerOrderLine(Base):
    __tablename__ = "customer_order_lines"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("customer_orders.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    label: Mapped[str] = mapped_column(String(160))
    quantity: Mapped[float] = mapped_column(Float)
    unit_price: Mapped[float] = mapped_column(Float)
    tax_rate: Mapped[float] = mapped_column(Float, default=0)
    total: Mapped[float] = mapped_column(Float)
    reserved: Mapped[float] = mapped_column(Float, default=0)
    delivered: Mapped[float] = mapped_column(Float, default=0)


class DeliveryNote(Base):
    __tablename__ = "delivery_notes"
    __table_args__ = (UniqueConstraint("tenant_id", "reference", name="uq_delivery_notes_tenant_reference"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("customer_orders.id"), index=True)
    reference: Mapped[str] = mapped_column(String(60))
    status: Mapped[str] = mapped_column(String(20), default="BROUILLON", index=True)
    delivered_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DeliveryNoteLine(Base):
    __tablename__ = "delivery_note_lines"
    id: Mapped[int] = mapped_column(primary_key=True)
    delivery_note_id: Mapped[int] = mapped_column(ForeignKey("delivery_notes.id"), index=True)
    order_line_id: Mapped[int] = mapped_column(ForeignKey("customer_order_lines.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[float] = mapped_column(Float)


class CommerceLineIn(BaseModel):
    product_id: int
    quantity: float = Field(gt=0)
    unit_price: float = Field(ge=0)
    tax_rate: float = Field(ge=0, le=100)


class QuoteIn(BaseModel):
    customer_id: int
    reference: str = Field(min_length=2, max_length=60)
    valid_until: Optional[date] = None
    note: str = Field(default="", max_length=500)
    lines: list[CommerceLineIn] = Field(min_length=1)


class OrderIn(BaseModel):
    customer_id: int
    warehouse_id: int
    reference: str = Field(min_length=2, max_length=60)
    note: str = Field(default="", max_length=500)
    lines: list[CommerceLineIn] = Field(min_length=1)


class DeliveryLineIn(BaseModel):
    order_line_id: int
    quantity: float = Field(gt=0)


class DeliveryIn(BaseModel):
    reference: str = Field(min_length=2, max_length=60)
    lines: list[DeliveryLineIn] = Field(min_length=1)


async def _tenant_customer(db: AsyncSession, tenant_id: int, customer_id: int):
    customer = await db.scalar(select(Customer).where(
        Customer.id == customer_id, Customer.tenant_id == tenant_id
    ))
    if not customer:
        raise HTTPException(404, "Client introuvable dans cette entreprise")
    return customer


async def _prepare_lines(db: AsyncSession, tenant_id: int, lines: list[CommerceLineIn]):
    prepared = []
    subtotal = tax = total = 0.0
    for item in lines:
        product = await db.scalar(select(Product).where(
            Product.id == item.product_id, Product.tenant_id == tenant_id,
            Product.active.is_(True)
        ))
        if not product:
            raise HTTPException(404, "Article introuvable dans cette entreprise")
        base = item.quantity * item.unit_price
        line_tax = base * item.tax_rate / 100
        line_total = base + line_tax
        subtotal += base
        tax += line_tax
        total += line_total
        prepared.append((product, item, line_total))
    return prepared, round(subtotal, 2), round(tax, 2), round(total, 2)


def _line_dict(line: CustomerOrderLine):
    return {
        "id": line.id, "product_id": line.product_id, "label": line.label,
        "quantity": line.quantity, "unit_price": line.unit_price,
        "tax_rate": line.tax_rate, "total": line.total,
        "reserved": line.reserved, "delivered": line.delivered,
        "remaining": max(0.0, line.quantity - line.delivered),
    }


@router.get("/quotes")
async def quote_list(user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "sales.read", db)
    rows = (await db.scalars(select(Quote).where(
        Quote.tenant_id == user.tenant_id
    ).order_by(Quote.id.desc()).limit(300))).all()
    result = []
    for quote in rows:
        customer = await db.scalar(select(Customer).where(
            Customer.id == quote.customer_id, Customer.tenant_id == user.tenant_id
        ))
        lines = (await db.scalars(select(QuoteLine).where(
            QuoteLine.quote_id == quote.id
        ).order_by(QuoteLine.id))).all()
        result.append({
            "id": quote.id, "reference": quote.reference, "customer_id": quote.customer_id,
            "customer_name": customer.name if customer else "", "status": quote.status,
            "issue_date": quote.issue_date, "valid_until": quote.valid_until,
            "subtotal": quote.subtotal, "tax": quote.tax, "total": quote.total,
            "note": quote.note, "lines": [{
                "id": line.id, "product_id": line.product_id, "label": line.label,
                "quantity": line.quantity, "unit_price": line.unit_price,
                "tax_rate": line.tax_rate, "total": line.total
            } for line in lines]
        })
    return result


@router.post("/quotes")
async def quote_create(x: QuoteIn, user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "sales.write", db)
    await _tenant_customer(db, user.tenant_id, x.customer_id)
    if await db.scalar(select(Quote.id).where(
        Quote.tenant_id == user.tenant_id, Quote.reference == x.reference.strip()
    )):
        raise HTTPException(409, "Cette référence de devis existe déjà")
    prepared, subtotal, tax, total = await _prepare_lines(db, user.tenant_id, x.lines)
    quote = Quote(
        tenant_id=user.tenant_id, customer_id=x.customer_id,
        reference=x.reference.strip(), valid_until=x.valid_until,
        note=x.note, created_by=user.id, subtotal=subtotal, tax=tax, total=total
    )
    db.add(quote)
    await db.flush()
    for product, item, line_total in prepared:
        db.add(QuoteLine(
            quote_id=quote.id, product_id=product.id, label=product.name,
            quantity=item.quantity, unit_price=item.unit_price,
            tax_rate=item.tax_rate, total=line_total
        ))
    db.add(Audit(tenant_id=user.tenant_id, user_id=user.id,
                 action="DEVIS_CREE", detail=f"Devis {quote.reference}"))
    await db.commit()
    return {"id": quote.id, "reference": quote.reference, "status": quote.status, "total": quote.total}


@router.post("/quotes/{quote_id}/status")
async def quote_status(quote_id: int, status: str, user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "sales.write", db)
    if status not in {"ENVOYE", "ACCEPTE", "REFUSE", "EXPIRE"}:
        raise HTTPException(400, "Statut de devis invalide")
    quote = await db.scalar(select(Quote).where(
        Quote.id == quote_id, Quote.tenant_id == user.tenant_id
    ).with_for_update())
    if not quote or quote.status in {"CONVERTI", "REFUSE", "EXPIRE"}:
        raise HTTPException(404, "Devis introuvable ou clôturé")
    if status == "ACCEPTE" and quote.valid_until and quote.valid_until < date.today():
        raise HTTPException(409, "Ce devis a dépassé sa date de validité")
    quote.status = status
    await db.commit()
    return {"id": quote.id, "status": quote.status}


async def _create_order_from_lines(db, user, customer_id, warehouse_id, reference, note, prepared, totals, quote_id=None):
    order = CustomerOrder(
        tenant_id=user.tenant_id, customer_id=customer_id, quote_id=quote_id,
        warehouse_id=warehouse_id, reference=reference, note=note,
        created_by=user.id, subtotal=totals[0], tax=totals[1], total=totals[2]
    )
    db.add(order)
    await db.flush()
    for product, item, line_total in prepared:
        db.add(CustomerOrderLine(
            order_id=order.id, product_id=product.id, label=product.name,
            quantity=item.quantity, unit_price=item.unit_price,
            tax_rate=item.tax_rate, total=line_total
        ))
    return order


@router.get("/customer-orders")
async def customer_order_list(user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "sales.read", db)
    rows = (await db.scalars(select(CustomerOrder).where(
        CustomerOrder.tenant_id == user.tenant_id
    ).order_by(CustomerOrder.id.desc()).limit(300))).all()
    result = []
    for order in rows:
        customer = await db.scalar(select(Customer).where(
            Customer.id == order.customer_id, Customer.tenant_id == user.tenant_id
        ))
        lines = (await db.scalars(select(CustomerOrderLine).where(
            CustomerOrderLine.order_id == order.id
        ).order_by(CustomerOrderLine.id))).all()
        result.append({
            "id": order.id, "reference": order.reference, "customer_id": order.customer_id,
            "customer_name": customer.name if customer else "", "quote_id": order.quote_id,
            "warehouse_id": order.warehouse_id, "status": order.status,
            "subtotal": order.subtotal, "tax": order.tax, "total": order.total,
            "note": order.note, "created_at": order.created_at,
            "lines": [_line_dict(line) for line in lines]
        })
    return result


@router.post("/customer-orders")
async def customer_order_create(x: OrderIn, user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "sales.write", db)
    await _tenant_customer(db, user.tenant_id, x.customer_id)
    warehouse = await db.scalar(select(Warehouse).where(
        Warehouse.id == x.warehouse_id, Warehouse.tenant_id == user.tenant_id
    ))
    if not warehouse:
        raise HTTPException(404, "Dépôt introuvable")
    if await db.scalar(select(CustomerOrder.id).where(
        CustomerOrder.tenant_id == user.tenant_id, CustomerOrder.reference == x.reference.strip()
    )):
        raise HTTPException(409, "Cette référence de commande existe déjà")
    prepared, subtotal, tax, total = await _prepare_lines(db, user.tenant_id, x.lines)
    order = await _create_order_from_lines(
        db, user, x.customer_id, warehouse.id, x.reference.strip(), x.note,
        prepared, (subtotal, tax, total)
    )
    db.add(Audit(tenant_id=user.tenant_id, user_id=user.id,
                 action="COMMANDE_CLIENT_CREEE", detail=f"Commande {order.reference}"))
    await db.commit()
    return {"id": order.id, "reference": order.reference, "status": order.status, "total": order.total}


@router.post("/quotes/{quote_id}/convert")
async def quote_convert(quote_id: int, reference: str, warehouse_id: int, user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "sales.write", db)
    quote = await db.scalar(select(Quote).where(
        Quote.id == quote_id, Quote.tenant_id == user.tenant_id
    ).with_for_update())
    if not quote or quote.status != "ACCEPTE":
        raise HTTPException(409, "Seul un devis accepté peut être converti")
    if quote.valid_until and quote.valid_until < date.today():
        raise HTTPException(409, "Ce devis a dépassé sa date de validité")
    warehouse = await db.scalar(select(Warehouse).where(
        Warehouse.id == warehouse_id, Warehouse.tenant_id == user.tenant_id
    ))
    if not warehouse:
        raise HTTPException(404, "Dépôt introuvable")
    if await db.scalar(select(CustomerOrder.id).where(
        CustomerOrder.tenant_id == user.tenant_id, CustomerOrder.reference == reference.strip()
    )):
        raise HTTPException(409, "Cette référence de commande existe déjà")
    quote_lines = (await db.scalars(select(QuoteLine).where(
        QuoteLine.quote_id == quote.id
    ).order_by(QuoteLine.id))).all()
    prepared = []
    for line in quote_lines:
        product = await db.scalar(select(Product).where(
            Product.id == line.product_id, Product.tenant_id == user.tenant_id,
            Product.active.is_(True)
        ))
        if not product:
            raise HTTPException(409, "Un article du devis n'est plus disponible")
        item = CommerceLineIn(product_id=line.product_id, quantity=line.quantity,
                              unit_price=line.unit_price, tax_rate=line.tax_rate)
        prepared.append((product, item, line.total))
    order = await _create_order_from_lines(
        db, user, quote.customer_id, warehouse.id, reference.strip(), quote.note,
        prepared, (quote.subtotal, quote.tax, quote.total), quote.id
    )
    quote.status = "CONVERTI"
    db.add(Audit(tenant_id=user.tenant_id, user_id=user.id,
                 action="DEVIS_CONVERTI", detail=f"{quote.reference} vers {order.reference}"))
    await db.commit()
    return {"id": order.id, "reference": order.reference, "status": order.status, "quote_id": quote.id}


@router.post("/customer-orders/{order_id}/confirm")
async def customer_order_confirm(order_id: int, user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "sales.write", db)
    order = await db.scalar(select(CustomerOrder).where(
        CustomerOrder.id == order_id, CustomerOrder.tenant_id == user.tenant_id,
        CustomerOrder.status == "BROUILLON"
    ).with_for_update())
    if not order:
        raise HTTPException(404, "Commande introuvable ou déjà confirmée")
    lines = (await db.scalars(select(CustomerOrderLine).where(
        CustomerOrderLine.order_id == order.id
    ).order_by(CustomerOrderLine.id).with_for_update())).all()
    requested = {}
    for line in lines:
        requested[line.product_id] = requested.get(line.product_id, 0.0) + line.quantity
    prepared = []
    for product_id, quantity in sorted(requested.items()):
        product = await db.scalar(select(Product).where(
            Product.id == product_id, Product.tenant_id == user.tenant_id
        ).with_for_update())
        stock = await db.scalar(select(WarehouseStock).where(
            WarehouseStock.tenant_id == user.tenant_id,
            WarehouseStock.warehouse_id == order.warehouse_id,
            WarehouseStock.product_id == product_id
        ).with_for_update())
        on_hand = stock.quantity if stock else 0.0
        active_lines = (await db.scalars(
            select(CustomerOrderLine).join(CustomerOrder, CustomerOrder.id == CustomerOrderLine.order_id)
            .where(
                CustomerOrder.tenant_id == user.tenant_id,
                CustomerOrder.warehouse_id == order.warehouse_id,
                CustomerOrder.status.in_({"CONFIRMEE", "PARTIELLE"}),
                CustomerOrderLine.product_id == product_id,
                CustomerOrderLine.order_id != order.id
            )
        )).all()
        reserved_elsewhere = sum(max(0.0, line.reserved - line.delivered) for line in active_lines)
        available = max(0.0, on_hand - reserved_elsewhere)
        if available + 1e-9 < quantity:
            raise HTTPException(409, f"Stock disponible insuffisant pour {product.name if product else 'article'} : {available:g}")
        prepared.append((product_id, quantity))
    for line in lines:
        line.reserved = line.quantity
    order.status = "CONFIRMEE"
    db.add(Audit(tenant_id=user.tenant_id, user_id=user.id,
                 action="COMMANDE_CLIENT_CONFIRMEE", detail=f"Réservation stock {order.reference}"))
    await db.commit()
    return {"id": order.id, "status": order.status, "reserved_lines": len(lines)}


@router.post("/customer-orders/{order_id}/deliveries")
async def delivery_create(order_id: int, x: DeliveryIn, user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "sales.write", db)
    order = await db.scalar(select(CustomerOrder).where(
        CustomerOrder.id == order_id, CustomerOrder.tenant_id == user.tenant_id,
        CustomerOrder.status.in_({"CONFIRMEE", "PARTIELLE"})
    ).with_for_update())
    if not order:
        raise HTTPException(404, "Commande non confirmée ou déjà livrée")
    if await db.scalar(select(DeliveryNote.id).where(
        DeliveryNote.tenant_id == user.tenant_id, DeliveryNote.reference == x.reference.strip()
    )):
        raise HTTPException(409, "Cette référence de livraison existe déjà")
    submitted = {}
    for item in x.lines:
        submitted[item.order_line_id] = submitted.get(item.order_line_id, 0.0) + item.quantity
    order_lines = (await db.scalars(select(CustomerOrderLine).where(
        CustomerOrderLine.order_id == order.id
    ).order_by(CustomerOrderLine.id).with_for_update())).all()
    by_id = {line.id: line for line in order_lines}
    prepared = []
    for line_id, quantity in sorted(submitted.items()):
        line = by_id.get(line_id)
        if not line or quantity > line.reserved - line.delivered + 1e-9:
            raise HTTPException(409, "Quantité livrée supérieure à la quantité réservée")
        product = await db.scalar(select(Product).where(
            Product.id == line.product_id, Product.tenant_id == user.tenant_id
        ).with_for_update())
        stock = await db.scalar(select(WarehouseStock).where(
            WarehouseStock.tenant_id == user.tenant_id,
            WarehouseStock.warehouse_id == order.warehouse_id,
            WarehouseStock.product_id == line.product_id
        ).with_for_update())
        if not product or not stock or stock.quantity + 1e-9 < quantity:
            raise HTTPException(409, "Le stock physique ne permet pas cette livraison")
        prepared.append((line, product, stock, quantity))
    note = DeliveryNote(
        tenant_id=user.tenant_id, order_id=order.id,
        reference=x.reference.strip(), created_by=user.id
    )
    db.add(note)
    await db.flush()
    for line, product, stock, quantity in prepared:
        line.delivered += quantity
        stock.quantity -= quantity
        product.stock -= quantity
        db.add(DeliveryNoteLine(
            delivery_note_id=note.id, order_line_id=line.id,
            product_id=product.id, quantity=quantity
        ))
        db.add(Movement(
            tenant_id=user.tenant_id, warehouse_id=order.warehouse_id,
            product_id=product.id, kind="LIVRAISON_CLIENT",
            quantity=-quantity, unit_cost=product.purchase_price,
            reference=note.reference
        ))
    note.status = "VALIDE"
    note.delivered_at = datetime.utcnow()
    order.status = "LIVREE" if all(line.delivered >= line.quantity - 1e-9 for line in order_lines) else "PARTIELLE"
    db.add(Audit(tenant_id=user.tenant_id, user_id=user.id,
                 action="BON_LIVRAISON_VALIDE", detail=f"Livraison {note.reference} · commande {order.reference}"))
    await db.commit()
    return {"id": note.id, "reference": note.reference, "status": note.status, "order_status": order.status}


@router.get("/customer-orders/{order_id}/deliveries")
async def delivery_list(order_id: int, user: User = Depends(tenant_auth), db: AsyncSession = Depends(dbdep)):
    await permitted(user, "sales.read", db)
    order = await db.scalar(select(CustomerOrder).where(
        CustomerOrder.id == order_id, CustomerOrder.tenant_id == user.tenant_id
    ))
    if not order:
        raise HTTPException(404, "Commande introuvable")
    notes = (await db.scalars(select(DeliveryNote).where(
        DeliveryNote.order_id == order.id, DeliveryNote.tenant_id == user.tenant_id
    ).order_by(DeliveryNote.id.desc()))).all()
    result = []
    for note in notes:
        lines = (await db.scalars(select(DeliveryNoteLine).where(
            DeliveryNoteLine.delivery_note_id == note.id
        ).order_by(DeliveryNoteLine.id))).all()
        result.append({
            "id": note.id, "reference": note.reference, "status": note.status,
            "delivered_at": note.delivered_at,
            "lines": [{"order_line_id": line.order_line_id, "product_id": line.product_id,
                       "quantity": line.quantity} for line in lines]
        })
    return result


app.include_router(router)
