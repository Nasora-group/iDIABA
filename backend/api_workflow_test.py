"""Tests d'intégration API sur une base SQLite jetable, jamais sur la production."""
import asyncio
from datetime import date

import httpx
from sqlalchemy import select, func

from app.main import (
    app, startup, engine, Session, Tenant, User, Warehouse, WarehouseStock,
    Product, Customer, Recipe, Sale, hasher,
)
from app.advanced import Subscription, SupplierInvoice, SupplierPayment, CustomerReceipt, Expense


BASE_URL = "http://idiaba.test"


async def main():
    await startup()

    # Le seed de démonstration ne gère pas les abonnements : le test crée
    # explicitement un abonnement ESSAI dans sa base SQLite jetable.
    async with Session() as db:
        demo_tenant = await db.scalar(select(Tenant).where(Tenant.name == "Ndiaye Distribution & Resto - Dakar"))
        demo_subscription = await db.scalar(select(Subscription).where(Subscription.tenant_id == demo_tenant.id))
        if demo_subscription is None:
            db.add(Subscription(tenant_id=demo_tenant.id, plan="ESSENTIEL", status="ESSAI", monthly_price=0))
            await db.commit()

    # Deuxième entreprise synthétique pour vérifier l'isolation multi-tenant.
    async with Session() as db:
        other = Tenant(name="Entreprise Test Isolation", mode="COMMERCE", currency="FCFA", tax_rate=18)
        db.add(other)
        await db.flush()
        other_user = User(
            tenant_id=other.id, email="admin@isolation.test", name="Admin Isolation",
            password_hash=hasher.hash("Isolation123!"), role="ADMIN", active=True,
        )
        other_warehouse = Warehouse(tenant_id=other.id, name="Dépôt Isolation", code="ISO")
        db.add_all([other_user, other_warehouse])
        await db.flush()
        other_product = Product(
            tenant_id=other.id, sku="ISO-001", name="Produit Isolation",
            unit="Pièce", purchase_price=100, sale_price=200, tax_rate=18,
            stock=5, min_stock=0, kind="SIMPLE", active=True,
        )
        db.add(other_product)
        await db.flush()
        db.add(WarehouseStock(
            tenant_id=other.id, warehouse_id=other_warehouse.id,
            product_id=other_product.id, quantity=5,
        ))
        db.add(Subscription(tenant_id=other.id, plan="ESSENTIEL", status="ESSAI", monthly_price=0))
        await db.commit()
        other_ids = (other.id, other_warehouse.id, other_product.id)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url=BASE_URL) as client:
        async def login(email, password):
            response = await client.post("/api/auth/login", json={"email": email, "password": password})
            assert response.status_code == 200, response.text
            return {"Authorization": f"Bearer {response.json()['access_token']}"}

        admin = await login("admin@demo.sn", "admin123")
        isolation_admin = await login("admin@isolation.test", "Isolation123!")

        # Vérifier que chaque catalogue ne révèle que les produits de son entreprise.
        products = (await client.get("/api/products", headers=admin)).json()
        other_products = (await client.get("/api/products", headers=isolation_admin)).json()
        assert any(p["sku"] == "HUI5" for p in products)
        assert [p["sku"] for p in other_products] == ["ISO-001"]
        assert all(p["sku"] != "HUI5" for p in other_products)

        warehouses = (await client.get("/api/warehouses", headers=admin)).json()
        shop = next(w for w in warehouses if w["code"] == "PLT")
        oil = next(p for p in products if p["sku"] == "HUI5")
        customer = (await client.get("/api/customers", headers=admin)).json()
        aminata = next(c for c in customer if c["name"] == "Aminata Fall")

        # Ouverture de caisse puis vente en espèces avec monnaie.
        opened = await client.post("/api/cash/open", headers=admin, json={"opening": 100000})
        assert opened.status_code == 200, opened.text
        cash_id = opened.json()["id"]

        # Régression POS : deux recettes partagent un ingrédient. Chaque ligne
        # consomme 0,75 unité, mais le stock disponible est de 1 unité seulement.
        # Le contrôle cumulé doit refuser la vente avant toute écriture.
        async with Session() as db:
            demo_user = await db.scalar(select(User).where(User.email == "admin@demo.sn"))
            test_ingredient = Product(
                tenant_id=demo_user.tenant_id, sku="TEST-ING-SHARED",
                name="Ingrédient partagé test", unit="Pièce",
                purchase_price=10, sale_price=0, tax_rate=0,
                stock=1, min_stock=0, kind="SIMPLE", active=True,
            )
            composed_a = Product(
                tenant_id=demo_user.tenant_id, sku="TEST-COMP-A",
                name="Produit composé test A", unit="Pièce",
                purchase_price=0, sale_price=100, tax_rate=0,
                stock=0, min_stock=0, kind="COMPOSE", active=True,
            )
            composed_b = Product(
                tenant_id=demo_user.tenant_id, sku="TEST-COMP-B",
                name="Produit composé test B", unit="Pièce",
                purchase_price=0, sale_price=100, tax_rate=0,
                stock=0, min_stock=0, kind="COMPOSE", active=True,
            )
            db.add_all([test_ingredient, composed_a, composed_b])
            await db.flush()
            db.add(WarehouseStock(
                tenant_id=demo_user.tenant_id, warehouse_id=shop["id"],
                product_id=test_ingredient.id, quantity=1,
            ))
            db.add_all([
                Recipe(tenant_id=demo_user.tenant_id, product_id=composed_a.id, ingredient_id=test_ingredient.id, quantity=0.75),
                Recipe(tenant_id=demo_user.tenant_id, product_id=composed_b.id, ingredient_id=test_ingredient.id, quantity=0.75),
            ])
            await db.commit()
            shared_ids = (test_ingredient.id, composed_a.id, composed_b.id)

        shared_stock_before = 1.0
        shared_sale = await client.post("/api/sales", headers=admin, json={
            "warehouse_id": shop["id"],
            "channel": "COMMERCE",
            "lines": [
                {"product_id": shared_ids[1], "quantity": 1},
                {"product_id": shared_ids[2], "quantity": 1},
            ],
            "payments": [{"method": "WAVE", "amount": 200}],
        })
        assert shared_sale.status_code == 409, shared_sale.text
        async with Session() as db:
            unchanged_shared_stock = await db.scalar(select(WarehouseStock).where(
                WarehouseStock.tenant_id == 1,
                WarehouseStock.warehouse_id == shop["id"],
                WarehouseStock.product_id == shared_ids[0],
            ))
            assert unchanged_shared_stock.quantity == shared_stock_before
            assert await db.scalar(select(func.count(Sale.id)).where(
                Sale.tenant_id == demo_user.tenant_id,
                Sale.total == 200,
            )) == 0

        sale_payload = {
            "warehouse_id": shop["id"],
            "channel": "COMMERCE",
            "client_sale_id": "api-workflow-sale-0001",
            "lines": [{"product_id": oil["id"], "quantity": 2}],
            "payments": [{"method": "ESPECES", "amount": 20000}],
        }
        before_stock = oil["stock"]
        sale_response = await client.post("/api/sales", headers=admin, json=sale_payload)
        assert sale_response.status_code == 200, sale_response.text
        sale = sale_response.json()
        assert sale["total"] == 18880 and sale["change"] == 1120
        after_sale_products = (await client.get("/api/products", headers=admin)).json()
        after_sale_stock = next(p["stock"] for p in after_sale_products if p["id"] == oil["id"])
        assert after_sale_stock == before_stock - 2

        # Rejouer le même identifiant offline ne doit ni créer une vente ni retirer du stock.
        duplicate = await client.post("/api/sales", headers=admin, json=sale_payload)
        assert duplicate.status_code == 200 and duplicate.json()["id"] == sale["id"]
        replay_products = (await client.get("/api/products", headers=admin)).json()
        replay_stock = next(p["stock"] for p in replay_products if p["id"] == oil["id"])
        assert replay_stock == after_sale_stock
        sales_list = (await client.get("/api/sales", headers=admin)).json()
        assert sum(1 for row in sales_list if row["id"] == sale["id"]) == 1

        # Remboursement partiel en espèces : contrôle du solde et unicité de référence.
        refund_payload = {
            "reason": "Test intégration retour",
            "refund_method": "ESPECES",
            "reference": "REF-API-WORKFLOW-001",
            "lines": [{"product_id": oil["id"], "counted": 1}],
        }
        refund = await client.post(f"/api/sales/{sale['id']}/refund", headers=admin, json=refund_payload)
        assert refund.status_code == 200, refund.text
        assert refund.json()["amount"] == 8000 and refund.json()["cash_adjusted"] is True
        duplicate_refund = await client.post(f"/api/sales/{sale['id']}/refund", headers=admin, json=refund_payload)
        assert duplicate_refund.status_code == 409

        # Commande fournisseur et réceptions partielles, sans entrée prématurée en stock.
        supplier_response = await client.post("/api/suppliers", headers=admin, json={"name": "Fournisseur Test API"})
        assert supplier_response.status_code == 200, supplier_response.text
        supplier_id = supplier_response.json()["id"]
        purchase = await client.post("/api/purchases", headers=admin, json={
            "supplier_id": supplier_id, "warehouse_id": shop["id"], "reference": "PO-API-001",
            "lines": [{"product_id": oil["id"], "quantity": 2, "unit_cost": 6500}],
        })
        assert purchase.status_code == 200, purchase.text
        first_receipt = await client.post(f"/api/purchases/{purchase.json()['id']}/receive", headers=admin, json={
            "lines": [{"product_id": oil["id"], "quantity": 1, "unit_cost": 6500}],
        })
        assert first_receipt.status_code == 200 and first_receipt.json()["status"] == "PARTIEL"
        second_receipt = await client.post(f"/api/purchases/{purchase.json()['id']}/receive", headers=admin, json={
            "lines": [{"product_id": oil["id"], "quantity": 1, "unit_cost": 6500}],
        })
        assert second_receipt.status_code == 200 and second_receipt.json()["status"] == "RECU"

        # Comptabilité fournisseurs : facture, règlement partiel et prévention du trop-payé.
        invoice = await client.post("/api/finance/supplier-invoices", headers=admin, json={
            "supplier_id": supplier_id, "reference": "FAC-API-001",
            "issue_date": date.today().isoformat(), "total": 10000,
        })
        assert invoice.status_code == 200, invoice.text
        invoice_id = invoice.json()["id"]
        payment = await client.post(f"/api/finance/supplier-invoices/{invoice_id}/payments", headers=admin, json={
            "amount": 4000, "method": "WAVE", "reference": "FOUR-WAVE-001",
        })
        assert payment.status_code == 200 and payment.json()["remaining"] == 6000
        overpayment = await client.post(f"/api/finance/supplier-invoices/{invoice_id}/payments", headers=admin, json={
            "amount": 6001, "method": "WAVE", "reference": "FOUR-WAVE-002",
        })
        assert overpayment.status_code == 409

        # Créance client, encaissement partiel et dépense hors caisse.
        receipt = await client.post("/api/finance/customer-receipts", headers=admin, json={
            "customer_id": aminata["id"], "amount": 5000, "method": "WAVE",
            "reference": "CLIENT-WAVE-001",
        })
        assert receipt.status_code == 200 and receipt.json()["customer_balance_due"] == 20000
        expense = await client.post("/api/finance/expenses", headers=admin, json={
            "category": "Transport", "label": "Déplacement test API",
            "amount": 1500, "method": "WAVE", "reference": "DEP-WAVE-001",
        })
        assert expense.status_code == 200

        # La caisse doit intégrer vente nette de monnaie et remboursement espèces.
        cash_current = (await client.get("/api/cash/current", headers=admin)).json()
        assert abs(cash_current["expected"] - 110880) < 0.001
        closed = await client.post(f"/api/cash/{cash_id}/close", headers=admin, json={"counted": 110880})
        assert closed.status_code == 200, closed.text
        assert closed.json()["variance"] == 0

        # Une entreprise ne peut ni lire les ventes, ni rembourser une vente, ni utiliser un dépôt étranger.
        other_sales = (await client.get("/api/sales", headers=isolation_admin)).json()
        assert other_sales == []
        foreign_refund = await client.post(f"/api/sales/{sale['id']}/refund", headers=isolation_admin, json={
            "reason": "Tentative inter-entreprise", "refund_method": "WAVE",
            "reference": "CROSS-TENANT-001",
            "lines": [{"product_id": oil["id"], "counted": 1}],
        })
        assert foreign_refund.status_code == 404
        other_open = await client.post("/api/cash/open", headers=isolation_admin, json={"opening": 0})
        assert other_open.status_code == 200
        cross_sale = await client.post("/api/sales", headers=isolation_admin, json={
            "warehouse_id": shop["id"], "lines": [{"product_id": oil["id"], "quantity": 1}],
            "payments": [{"method": "WAVE", "amount": 10000}],
        })
        assert cross_sale.status_code == 409

        other_summary = await client.get("/api/finance/summary", headers=isolation_admin)
        assert other_summary.status_code == 200
        assert other_summary.json()["sales_count"] == 0
        assert other_summary.json()["expenses_total"] == 0

    # Contrôle direct des journaux et des quantités, toujours dans la base jetable.
    async with Session() as db:
        assert await db.scalar(select(func.count(SupplierInvoice.id))) == 1
        assert await db.scalar(select(func.count(SupplierPayment.id))) == 1
        assert await db.scalar(select(func.count(CustomerReceipt.id))) == 1
        assert await db.scalar(select(func.count(Expense.id))) == 1
        assert await db.scalar(select(func.count()).select_from(Tenant)) == 2

    print("API WORKFLOWS OK: vente/idempotence, remboursement, achats/réceptions partielles, fournisseurs, créances, dépenses, clôture caisse et isolation multi-tenant")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
