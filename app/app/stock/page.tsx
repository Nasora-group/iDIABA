import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createStockLocation, recordStockMovement } from "./actions";

type Workspace = { tenant_id: string; role: string; tenant: { name: string } | null };
type Product = { id: string; name: string; sku: string; unit: string };
type Location = { id: string; name: string; code: string };
type Movement = {
  id: string; movement_type: string; quantity_delta: string | number; reference: string;
  note: string; created_at: string;
  product: { name: string; sku: string; unit: string } | null;
  location: { name: string; code: string } | null;
};
type Balance = {
  quantity_on_hand: string | number;
  product: { name: string; sku: string; unit: string } | null;
  location: { name: string; code: string } | null;
};

export const dynamic = "force-dynamic";

export default async function StockPage({ searchParams }: {
  searchParams: Promise<{ created?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: memberships } = await supabase.from("tenant_memberships")
    .select("tenant_id,role,tenant:tenants(name)").eq("user_id", user.id);
  const workspaces = (memberships ?? []) as unknown as Workspace[];
  const stockData = await Promise.all(workspaces.map(async (workspace) => {
    const [productResult, locationResult, movementResult, balanceResult] = await Promise.all([
      supabase.from("products").select("id,name,sku,unit").eq("tenant_id", workspace.tenant_id).eq("is_active", true).order("name"),
      supabase.from("stock_locations").select("id,name,code").eq("tenant_id", workspace.tenant_id).eq("is_active", true).order("name"),
      supabase.from("stock_movements").select("id,movement_type,quantity_delta,reference,note,created_at,product:products(name,sku,unit),location:stock_locations(name,code)").eq("tenant_id", workspace.tenant_id).order("created_at", { ascending: false }).limit(500),
      supabase.from("stock_balances").select("quantity_on_hand,product:products(name,sku,unit),location:stock_locations(name,code)").eq("tenant_id", workspace.tenant_id),
    ]);
    const movements = (movementResult.data ?? []) as unknown as Movement[];
    const balances = ((balanceResult.data ?? []) as unknown as Balance[])
      .filter((balance) => balance.product && balance.location)
      .map((balance) => ({
        product: balance.product!,
        location: balance.location!,
        quantity: Number(balance.quantity_on_hand),
      }))
      .sort((a, b) => a.product.name.localeCompare(b.product.name));
    return {
      workspace,
      products: (productResult.data ?? []) as Product[],
      locations: (locationResult.data ?? []) as Location[],
      movements,
      balances,
      error: productResult.error?.message ?? locationResult.error?.message ?? movementResult.error?.message ?? balanceResult.error?.message ?? null,
    };
  }));

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="mark">i</span><span>iDIABA</span></div>
        <nav className="product-nav"><Link href="/app">Mon espace</Link><Link href="/app/products">Catalogue</Link><span>Stocks</span></nav>
      </header>
      <section className="workspace catalog-workspace">
        <p className="eyebrow">SPRINT 3 · STOCKS</p>
        <h1>Gestion des stocks</h1>
        <p className="lead">Suivez les dépôts, les entrées, les sorties et l'historique des mouvements. Le stock disponible est calculé sur l'ensemble du journal, sans limite sur le nombre de mouvements.</p>
        {params.created && <p className="form-success">Enregistrement effectué.</p>}
        {params.error && <p className="form-error">Opération impossible. Vérifiez les champs, les droits et le stock disponible.</p>}
        {!stockData.length && <p>Aucun espace entreprise associé à ce compte.</p>}
        {stockData.map(({ workspace, products, locations, movements, balances, error }) => (
          <section className="catalog-tenant" key={workspace.tenant_id}>
            <div className="catalog-heading">
              <div><h2>{workspace.tenant?.name ?? "Entreprise"}</h2><p>Rôle : {workspace.role}</p></div>
              <span className="pill">{locations.length} dépôt(s) · {movements.length} mouvements récents</span>
            </div>
            {error && <p className="form-error">Erreur de chargement : {error}</p>}
            <div className="catalog-forms stock-forms">
              <form action={createStockLocation} className="catalog-form">
                <h3>Créer un dépôt</h3>
                <input type="hidden" name="tenant_id" value={workspace.tenant_id} />
                <label>Nom du dépôt<input name="name" required maxLength={100} placeholder="Ex. Magasin principal" /></label>
                <label>Code<input name="code" required maxLength={32} placeholder="DEPOT-01" /></label>
                <label>Description<input name="description" maxLength={500} placeholder="Optionnel" /></label>
                <button className="primary" type="submit">Créer le dépôt</button>
              </form>
              <form action={recordStockMovement} className="catalog-form">
                <h3>Enregistrer un mouvement</h3>
                <input type="hidden" name="tenant_id" value={workspace.tenant_id} />
                <label>Produit<select name="product_id" required defaultValue=""><option value="" disabled>Choisir un produit</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select></label>
                <label>Dépôt<select name="location_id" required defaultValue=""><option value="" disabled>Choisir un dépôt</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name} · {location.code}</option>)}</select></label>
                <div className="catalog-fields">
                  <label>Type<select name="movement_type" defaultValue="opening"><option value="opening">Stock initial</option><option value="adjustment">Ajustement inventaire</option></select></label>
                  <label>Sens<select name="direction" defaultValue="in"><option value="in">Entrée (+)</option><option value="out">Sortie (-)</option></select></label>
                </div>
                <label>Quantité<input name="quantity" type="number" min="0.001" step="0.001" required placeholder="Ex. 25" /></label>
                <label>Référence<input name="reference" maxLength={80} placeholder="N° inventaire / document" /></label>
                <label>Note<input name="note" maxLength={500} placeholder="Motif du mouvement" /></label>
                <button className="primary" type="submit" disabled={!products.length || !locations.length}>Enregistrer le mouvement</button>
              </form>
            </div>
            <div className="catalog-table-wrap">
              <h3>État du stock</h3>
              {balances.length ? (
                <table className="catalog-table">
                  <thead><tr><th>Produit</th><th>Dépôt</th><th>Quantité disponible</th><th>Unité</th></tr></thead>
                  <tbody>{balances.map((balance) => (
                    <tr key={balance.product.sku + balance.location.code}>
                      <td><strong>{balance.product.name}</strong><small>{balance.product.sku}</small></td>
                      <td>{balance.location.name}</td>
                      <td><strong>{balance.quantity.toLocaleString("fr-FR", { maximumFractionDigits: 3 })}</strong></td>
                      <td>{balance.product.unit}</td>
                    </tr>
                  ))}</tbody>
                </table>
              ) : <p className="catalog-empty">Aucun mouvement de stock. Créez un dépôt puis enregistrez le stock initial.</p>}
            </div>
            <div className="catalog-table-wrap">
              <h3>Journal des mouvements (500 derniers)</h3>
              {movements.length ? (
                <table className="catalog-table">
                  <thead><tr><th>Date</th><th>Produit</th><th>Dépôt</th><th>Type</th><th>Variation</th><th>Référence / note</th></tr></thead>
                  <tbody>{movements.map((movement) => (
                    <tr key={movement.id}>
                      <td>{new Date(movement.created_at).toLocaleString("fr-FR")}</td>
                      <td>{movement.product?.name ?? "Produit"}</td>
                      <td>{movement.location?.name ?? "Dépôt"}</td>
                      <td>{movement.movement_type === "opening" ? "Stock initial" : movement.movement_type === "adjustment" ? "Ajustement" : movement.movement_type}</td>
                      <td>{Number(movement.quantity_delta) > 0 ? "+" : ""}{Number(movement.quantity_delta).toLocaleString("fr-FR", { maximumFractionDigits: 3 })}</td>
                      <td>{movement.reference || "—"}<small>{movement.note}</small></td>
                    </tr>
                  ))}</tbody>
                </table>
              ) : <p className="catalog-empty">Aucun mouvement enregistré.</p>}
            </div>
          </section>
        ))}
      </section>
    </main>
  );
}
