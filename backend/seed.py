import asyncio
import traceback

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.main import (
    Base, engine, Session, Tenant, User, Warehouse, WarehouseStock,
    Product, Recipe, Customer, Movement, hasher,
)


async def wait_for_database(attempts: int = 12) -> None:
    for attempt in range(1, attempts + 1):
        try:
            async with engine.connect() as connection:
                await connection.exec_driver_sql("SELECT 1")
            print(f"[seed] PostgreSQL accessible (tentative {attempt}/{attempts})", flush=True)
            return
        except SQLAlchemyError as exc:
            print(
                f"[seed] Connexion PostgreSQL impossible ({attempt}/{attempts}): "
                f"{type(exc).__name__}: {exc}",
                flush=True,
            )
            if attempt == attempts:
                raise
            await asyncio.sleep(min(attempt * 2, 10))


async def seed() -> None:
    print("[seed] Démarrage de l'initialisation", flush=True)
    print(f"[seed] Dialecte SQLAlchemy : {engine.url.drivername}", flush=True)
    await wait_for_database()

    print("[seed] Création/vérification des tables", flush=True)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with Session() as db:
        existing = await db.scalar(
            select(Tenant).where(Tenant.name == "Ndiaye Distribution & Resto - Dakar")
        )
        if existing:
            print("[seed] Données de démonstration déjà présentes : aucune insertion", flush=True)
            return

        print("[seed] Création de l'entreprise et des comptes", flush=True)
        tenant = Tenant(
            name="Ndiaye Distribution & Resto - Dakar",
            mode="HYBRIDE",
            address="Plateau, Dakar, Sénégal",
            phone="+221 77 000 00 00",
            ninea="0098765432A2",
            rc="SN-DKR-2026-B-00000",
        )
        db.add(tenant)
        await db.flush()

        db.add_all([
            User(
                tenant_id=tenant.id,
                email="admin@demo.sn",
                name="Administrateur",
                password_hash=hasher.hash("admin123"),
                role="ADMIN",
                pin_hash=hasher.hash("1234"),
            ),
            User(
                tenant_id=tenant.id,
                email="caisse@demo.sn",
                name="Caissier",
                password_hash=hasher.hash("caisse123"),
                role="CAISSIER",
            ),
        ])

        shop = Warehouse(tenant_id=tenant.id, name="Boutique Plateau", code="PLT")
        reserve = Warehouse(tenant_id=tenant.id, name="Réserve", code="RES")
        db.add_all([shop, reserve])
        await db.flush()

        products = [
            ("RIZ25", "Riz parfumé 25 kg", "Alimentation", 18000, 22000, 80),
            ("HUI5", "Huile végétale 5 L", "Alimentation", 6500, 8000, 50),
            ("SUC1", "Sucre 1 kg", "Alimentation", 600, 750, 100),
            ("EAU15", "Eau minérale 1,5 L", "Boissons", 250, 400, 120),
            ("JUS1", "Jus de fruits 1 L", "Boissons", 900, 1200, 60),
            ("SAV1", "Savon de toilette", "Cosmétiques", 350, 500, 80),
            ("CRE1", "Crème hydratante", "Cosmétiques", 1800, 2500, 20),
            ("LAI400", "Lait en poudre 400 g", "Alimentation", 2500, 3200, 30),
            ("PAP4", "Papier hygiénique x4", "Hygiène", 900, 1200, 40),
            ("CAF100", "Café soluble 100 g", "Alimentation", 1500, 2000, 25),
            ("BUR", "Burger maison", "Restaurant", 1100, 2500, 0),
            ("THI", "Thiéboudienne", "Restaurant", 1600, 3500, 0),
            ("SAN", "Sandwich poulet", "Restaurant", 900, 2000, 0),
        ]

        print("[seed] Création du catalogue et des stocks initiaux", flush=True)
        product_by_sku = {}
        for sku, name, category, cost, price, quantity in products:
            product = Product(
                tenant_id=tenant.id,
                sku=sku,
                name=name,
                category=category,
                purchase_price=cost,
                sale_price=price,
                stock=quantity,
                min_stock=5,
                kind="COMPOSE" if sku in {"BUR", "THI", "SAN"} else "SIMPLE",
            )
            db.add(product)
            await db.flush()
            product_by_sku[sku] = product

            if quantity:
                db.add_all([
                    WarehouseStock(
                        tenant_id=tenant.id,
                        warehouse_id=shop.id,
                        product_id=product.id,
                        quantity=quantity,
                    ),
                    Movement(
                        tenant_id=tenant.id,
                        warehouse_id=shop.id,
                        product_id=product.id,
                        kind="ENTREE_INITIALE",
                        quantity=quantity,
                        unit_cost=cost,
                        reference="SEED",
                    ),
                ])

        print("[seed] Création des recettes et clients", flush=True)
        for sku, ingredient_sku, quantity in [
            ("BUR", "RIZ25", 0.03),
            ("BUR", "HUI5", 0.02),
            ("THI", "RIZ25", 0.12),
            ("THI", "HUI5", 0.03),
            ("SAN", "RIZ25", 0.02),
            ("SAN", "HUI5", 0.01),
        ]:
            db.add(Recipe(
                tenant_id=tenant.id,
                product_id=product_by_sku[sku].id,
                ingredient_id=product_by_sku[ingredient_sku].id,
                quantity=quantity,
            ))

        db.add_all([
            Customer(tenant_id=tenant.id, name="Client comptoir", phone="+221 77 111 11 11"),
            Customer(
                tenant_id=tenant.id,
                name="Aminata Fall",
                phone="+221 76 222 22 22",
                credit_limit=100000,
                balance_due=25000,
            ),
            Customer(
                tenant_id=tenant.id,
                name="Entreprise Baobab",
                phone="+221 78 333 33 33",
                credit_limit=250000,
            ),
        ])

        await db.commit()
        print("[seed] SEED OK : entreprise, 2 utilisateurs, 2 dépôts, 13 produits, 3 clients", flush=True)


if __name__ == "__main__":
    try:
        asyncio.run(seed())
    except Exception:
        print("[seed] ÉCHEC : traceback complet ci-dessous", flush=True)
        traceback.print_exc()
        raise
    finally:
        asyncio.run(engine.dispose())
