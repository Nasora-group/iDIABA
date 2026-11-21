import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { postInventoryCount, setInventoryCountLine, startInventoryCount } from "./actions";

type Workspace = { tenant_id: string; role: string; tenant: { name: string } | null };
type Location = { id: string; name: string; code: string };
type Product = { id: string; name: string; sku: string; unit: string };
type CountItem = {
  id: string;
  expected_quantity: string | number;
  counted_quantity: string | number;
  variance: string | number;
  product: { name: string; sku: string; unit: string } | null;
};
type InventoryCount = {
  id: string;
  reference: string;
  notes: string;
  status: "draft" | "posted";
  created_at: string;
  posted_at: string | null;
  location: { name: string; code: string } | null;
  items: CountItem[];
};

export const dynamic = "force-dynamic";

function qty(value: string | number) {
  return Number(value).toLocaleString("fr-FR", { maximumFractionDigits: 3 });
}

export default async function InventoryPage({ searchParams }: {
  searchParams: Promise<{ created?: string; line?: string; posted?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: memberships } = await supabase.from("tenant_memberships")
    .select("tenant_id,role,tenant:tenants(name)").eq("user_id", user.id);
  const workspaces = (memberships ?? []) as unknown as Workspace[];

  const data = await Promise.all(workspaces.map(async (workspace) => {
    const [locationsResult, productsResult, countsResult] = await Promise.all([
      supabase.from("stock_locations").select("id,name,code")
        .eq("tenant_id", workspace.tenant_id).eq("is_active", true).order("name"),
      supabase.from("products").select("id,name,sku,unit")
        .eq("tenant_id", workspace.tenant_id).eq("is_active", true).order("name"),
      supabase.from("inventory_counts")
        .select("id,reference,notes,status,created_at,posted_at,location:stock_locations!inventory_count_location_tenant_fk(name,code),items:inventory_count_items!inventory_count_item_count_fk(id,expected_quantity,counted_quantity,variance,product:products!inventory_count_item_product_fk(name,sku,unit))")
        .eq("tenant_id", workspace.tenant_id).order("created_at", { ascending: false }).limit(50),
    ]);
    return {
      workspace,
      locations: (locationsResult.data ?? []) as Location[],
      products: (productsResult.data ?? []) as Product[],
      counts: (countsResult.data ?? []) as unknown as InventoryCount[],
      error: locationsResult.error?.message ?? productsResult.error?.message ?? countsResult.error?.message ?? null,
    };
  }));

  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/app" className="brand"><span className="mark">i</span><span>iDIABA</span></Link>
        <nav className="product-nav" aria-label="Navigation principale">
          <Link href="/app">Mon espace</Link>
          <Link href="/app/products">Catalogue</Link>
          <Link href="/app/stock">Stocks</Link>
          <span>Inventaires</span>
          <Link href="/app/pos">Caisse</Link>
          <Link href="/app/purchasing">Achats</Link>
        </nav>
      </header>
      <section className="workspace catalog-workspace">
        <p className="eyebrow">SPRINT 8 · CONTRÔLE DES STOCKS</p>
        <h1>Inventaires physiques</h1>
        <p className="lead">Comparez les quantités réellement comptées au stock théorique. La validation enregistre uniquement les écarts dans le journal de stock, sans modifier ni effacer l'historique.</p>

        {params.created && <p className="form-success">Inventaire créé. Ajoutez les produits comptés.</p>}
        {params.line && <p className="form-success">Ligne d'inventaire enregistrée.</p>}
        {params.posted && <p className="form-success">Inventaire validé. Les écarts ont été enregistrés dans le journal de stock.</p>}
        {params.error === "stale" && <p className="form-error">Le stock a changé depuis le comptage d'un produit. Actualisez la quantité de ce produit avant de valider l'inventaire.</p>}
        {params.error && params.error !== "stale" && <p className="form-error">Opération impossible. Vérifiez les informations, les droits et les quantités saisies.</p>}

        {!data.length && <p className="catalog-empty">Aucun espace entreprise associé à ce compte.</p>}
        {data.map(({ workspace, locations, products, counts, error }) => (
          <section className="catalog-tenant" key={workspace.tenant_id}>
            <div className="catalog-heading">
              <div><h2>{workspace.tenant?.name ?? "Entreprise"}</h2><p>Rôle : {workspace.role}</p></div>
              <span className="pill">{counts.length} inventaire(s)</span>
            </div>
            {error && <p className="form-error">Erreur de chargement des inventaires. Vérifiez la migration de la base de données.</p>}

            <form action={startInventoryCount} className="catalog-form inventory-start-form">
              <h3>Démarrer un inventaire</h3>
              <input type="hidden" name="tenant_id" value={workspace.tenant_id} />
              <div className="catalog-fields">
                <label>Dépôt à compter
                  <select name="location_id" required defaultValue="">
                    <option value="" disabled>Choisir un dépôt</option>
                    {locations.map((location) => <option key={location.id} value={location.id}>{location.name} · {location.code}</option>)}
                  </select>
                </label>
                <label>Référence
                  <input name="reference" maxLength={80} placeholder="Ex. INV-2026-001" />
                </label>
              </div>
              <label>Note
                <input name="notes" maxLength={500} placeholder="Équipe de comptage, zone ou commentaire" />
              </label>
              <button className="primary" type="submit" disabled={!locations.length}>Créer l'inventaire</button>
              {!locations.length && <p className="catalog-help">Créez d'abord un dépôt dans le module Stocks.</p>}
            </form>

            <div className="inventory-count-list">
              {counts.length ? counts.map((count) => (
                <article className="inventory-count-card" key={count.id}>
                  <div className="catalog-heading">
                    <div>
                      <span className={count.status === "posted" ? "catalog-state" : "catalog-state inactive"}>{count.status === "posted" ? "Validé" : "Brouillon"}</span>
                      <h3>{count.reference || "Inventaire sans référence"}</h3>
                      <p>{count.location?.name ?? "Dépôt"} · Créé le {new Date(count.created_at).toLocaleString("fr-FR")}</p>
                      {count.notes && <p>{count.notes}</p>}
                    </div>
                    <span className="pill">{count.items.length} ligne(s)</span>
                  </div>

                  {count.status === "draft" && (
                    <form action={setInventoryCountLine} className="catalog-form inventory-line-form">
                      <h4>Ajouter / actualiser un produit compté</h4>
                      <input type="hidden" name="inventory_count_id" value={count.id} />
                      <label>Produit
                        <select name="product_id" required defaultValue="">
                          <option value="" disabled>Choisir un produit</option>
                          {products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}
                        </select>
                      </label>
                      <label>Quantité réellement comptée
                        <input name="counted_quantity" type="number" min="0" step="0.001" required placeholder="Ex. 25" />
                      </label>
                      <button className="secondary" type="submit" disabled={!products.length}>Enregistrer la ligne</button>
                    </form>
                  )}

                  {count.items.length ? (
                    <div className="catalog-table-wrap">
                      <table className="catalog-table">
                        <thead><tr><th>Produit</th><th>Stock théorique</th><th>Compté</th><th>Écart</th></tr></thead>
                        <tbody>{count.items.map((item) => (
                          <tr key={item.id}>
                            <td><strong>{item.product?.name ?? "Produit"}</strong><small>{item.product?.sku ?? ""}</small></td>
                            <td>{qty(item.expected_quantity)} {item.product?.unit ?? ""}</td>
                            <td>{qty(item.counted_quantity)} {item.product?.unit ?? ""}</td>
                            <td><strong>{Number(item.variance) > 0 ? "+" : ""}{qty(item.variance)}</strong></td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  ) : <p className="catalog-empty">Aucun produit compté pour le moment.</p>}

                  {count.status === "draft" && (
                    <form action={postInventoryCount} className="inventory-post-form">
                      <input type="hidden" name="inventory_count_id" value={count.id} />
                      <p className="catalog-help">La validation bloque si le stock a changé depuis le comptage. Dans ce cas, actualisez les lignes concernées.</p>
                      <button className="primary" type="submit" disabled={!count.items.length}>Valider et appliquer les écarts</button>
                    </form>
                  )}
                  {count.status === "posted" && count.posted_at && <p className="catalog-help">Validé le {new Date(count.posted_at).toLocaleString("fr-FR")}. Les lignes sont désormais verrouillées.</p>}
                </article>
              )) : <p className="catalog-empty">Aucun inventaire créé pour cette entreprise.</p>}
            </div>
          </section>
        ))}
      </section>
    </main>
  );
}
