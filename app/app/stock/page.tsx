import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createStockLocation, recordStockMovement, setStockAlertThreshold } from "./actions";

type Workspace = { tenant_id: string; role: string; tenant: { name: string } | null };
type Product = { id: string; name: string; sku: string; unit: string; is_active: boolean };
type Location = { id: string; name: string; code: string; location_type: "store" | "warehouse"; address: string; phone: string; is_active: boolean };
type Movement = {
  id: string; movement_type: string; quantity_delta: string | number; reference: string;
  note: string; created_at: string;
  product: { name: string; sku: string; unit: string } | null;
  location: { name: string; code: string } | null;
};
type Balance = { product_id: string; location_id: string; quantity_on_hand: string | number };
type Threshold = { product_id: string; location_id: string; minimum_quantity: string | number };

export const dynamic = "force-dynamic";

export default async function StockPage({ searchParams }: {
  searchParams: Promise<{ created?: string; threshold?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: memberships } = await supabase.from("tenant_memberships")
    .select("tenant_id,role,tenant:tenants(name)").eq("user_id", user.id);
  const workspaces = (memberships ?? []) as unknown as Workspace[];
  const stockData = await Promise.all(workspaces.map(async (workspace) => {
    const [productResult, locationResult, movementResult, balanceResult, thresholdResult] = await Promise.all([
      supabase.from("products").select("id,name,sku,unit,is_active").eq("tenant_id", workspace.tenant_id).order("name"),
      supabase.from("stock_locations").select("id,name,code,location_type,address,phone,is_active").eq("tenant_id", workspace.tenant_id).order("name"),
      supabase.from("stock_movements").select("id,movement_type,quantity_delta,reference,note,created_at,product:products(name,sku,unit),location:stock_locations(name,code)").eq("tenant_id", workspace.tenant_id).order("created_at", { ascending: false }).limit(500),
      supabase.from("stock_balances").select("product_id,location_id,quantity_on_hand").eq("tenant_id", workspace.tenant_id),
      supabase.from("stock_reorder_thresholds").select("product_id,location_id,minimum_quantity").eq("tenant_id", workspace.tenant_id),
    ]);
    const allProducts = (productResult.data ?? []) as Product[];
    const allLocations = (locationResult.data ?? []) as Location[];
    const productsById = new Map(allProducts.map((product) => [product.id, product]));
    const locationsById = new Map(allLocations.map((location) => [location.id, location]));
    const movements = (movementResult.data ?? []) as unknown as Movement[];
    const balances = ((balanceResult.data ?? []) as Balance[])
      .flatMap((balance) => {
        const product = productsById.get(balance.product_id);
        const location = locationsById.get(balance.location_id);
        return product && location ? [{ product, location, quantity: Number(balance.quantity_on_hand) }] : [];
      })
      .sort((a, b) => a.product.name.localeCompare(b.product.name));
    const thresholds = (thresholdResult.data ?? []) as Threshold[];
    const quantityByKey = new Map(balances.map((balance) => [balance.location.id + ":" + balance.product.id, balance.quantity]));
    const configuredThresholds = thresholds.flatMap((threshold) => {
      const product = productsById.get(threshold.product_id);
      const location = locationsById.get(threshold.location_id);
      return product && location ? [{ product, location, minimum: Number(threshold.minimum_quantity) }] : [];
    }).sort((a, b) => a.product.name.localeCompare(b.product.name));
    const reorderAlerts = thresholds.flatMap((threshold) => {
      const product = productsById.get(threshold.product_id);
      const location = locationsById.get(threshold.location_id);
      const quantity = quantityByKey.get(threshold.location_id + ":" + threshold.product_id) ?? 0;
      const minimum = Number(threshold.minimum_quantity);
      return product && location && product.is_active && location.is_active && quantity <= minimum
        ? [{ product, location, quantity, minimum }] : [];
    }).sort((a, b) => a.quantity - b.quantity);
    return {
      workspace,
      products: allProducts.filter((product) => product.is_active),
      locations: allLocations.filter((location) => location.is_active),
      movements,
      balances,
      thresholds,
      configuredThresholds,
      reorderAlerts,
      error: productResult.error?.message ?? locationResult.error?.message ?? movementResult.error?.message ?? balanceResult.error?.message ?? thresholdResult.error?.message ?? null,
    };
  }));

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="mark">i</span><span>iDIABA</span></div>
        <nav className="product-nav"><Link href="/app">Mon espace</Link><Link href="/app/products">Catalogue</Link><span>Stocks</span><Link href="/app/inventory">Inventaires</Link><Link href="/app/pos">Caisse</Link><Link href="/app/purchasing">Achats</Link><Link href="/app/accounting">Comptabilité</Link></nav>
      </header>
      <section className="workspace catalog-workspace">
        <p className="eyebrow">SPRINT 3 · STOCKS</p>
        <h1>Gestion des stocks</h1>
        <p className="lead">Suivez les dépôts, les entrées, les sorties et l&apos;historique des mouvements. Le stock disponible est calculé sur l&apos;ensemble du journal, sans limite sur le nombre de mouvements.</p>
        {params.created && <p className="form-success">Enregistrement effectué.</p>}
        {params.threshold && <p className="form-success">Seuil d’alerte enregistré.</p>}
        {params.error && <p className="form-error">Opération impossible. Vérifiez les champs, les droits et le stock disponible.</p>}
        {!stockData.length && <p>Aucun espace entreprise associé à ce compte.</p>}
        {stockData.map(({ workspace, products, locations, movements, balances, thresholds, configuredThresholds, reorderAlerts, error }) => (
          <section className="catalog-tenant" key={workspace.tenant_id}>
            <div className="catalog-heading">
              <div><h2>{workspace.tenant?.name ?? "Entreprise"}</h2><p>Rôle : {workspace.role}</p></div>
              <span className="pill">{locations.length} dépôt(s) actif(s) · {movements.length} mouvements récents</span>
            </div>
            {error && <p className="form-error">Erreur de chargement : {error}</p>}
            <div className="catalog-forms stock-forms">
              <form action={createStockLocation} className="catalog-form">
                <h3>Créer un point de vente ou un dépôt</h3>
                <input type="hidden" name="tenant_id" value={workspace.tenant_id} />
                <label>Nom<input name="name" required maxLength={100} placeholder="Ex. Boutique Dakar Centre" /></label>
                <label>Type<select name="location_type" defaultValue="store"><option value="store">Boutique / point de vente</option><option value="warehouse">Dépôt / entrepôt</option></select></label>
                <label>Code<input name="code" required maxLength={32} placeholder="DEPOT-01" /></label>
                <label>Description<input name="description" maxLength={500} placeholder="Optionnel" /></label>
                <label>Adresse<input name="address" maxLength={250} placeholder="Adresse de l’établissement" /></label>
                <label>Téléphone<input name="phone" maxLength={40} placeholder="Téléphone de l’établissement" /></label>
                <button className="primary" type="submit">Créer l’établissement</button>
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
            <form action={setStockAlertThreshold} className="catalog-form stock-threshold-form">
              <h3>Définir un seuil d’alerte</h3>
              <input type="hidden" name="tenant_id" value={workspace.tenant_id} />
              <label>Produit<select name="product_id" required defaultValue=""><option value="" disabled>Choisir un produit</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select></label>
              <label>Dépôt<select name="location_id" required defaultValue=""><option value="" disabled>Choisir un dépôt</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name} · {location.code}</option>)}</select></label>
              <label>Quantité minimum<input name="minimum_quantity" type="number" min="0" step="0.001" required placeholder="Ex. 5" /></label>
              <p className="catalog-help">Saisissez 0 pour supprimer le seuil. Les alertes s’affichent lorsque le stock est inférieur ou égal au seuil.</p>
              <button className="secondary" type="submit" disabled={!products.length || !locations.length}>Enregistrer le seuil</button>
            </form>
            <div className="catalog-table-wrap">
              <h3>Seuils configurés</h3>
              {configuredThresholds.length ? <table className="catalog-table"><thead><tr><th>Produit</th><th>Dépôt</th><th>Minimum</th></tr></thead><tbody>{configuredThresholds.map((item) => <tr key={item.product.id + item.location.id}><td><strong>{item.product.name}</strong><small>{item.product.sku}</small></td><td>{item.location.name}</td><td>{item.minimum.toLocaleString("fr-FR",{maximumFractionDigits:3})} {item.product.unit}</td></tr>)}</tbody></table> : <p className="catalog-empty">Aucun seuil configuré.</p>}
            </div>
            <div className="catalog-table-wrap stock-alerts">
              <h3>Alertes de réapprovisionnement</h3>
              {reorderAlerts.length ? <table className="catalog-table"><thead><tr><th>Produit</th><th>Dépôt</th><th>Stock actuel</th><th>Seuil</th><th>À commander au minimum</th></tr></thead><tbody>{reorderAlerts.map((alert) => <tr key={alert.product.id + alert.location.id}><td><strong>{alert.product.name}</strong><small>{alert.product.sku}</small></td><td>{alert.location.name}</td><td><span className="stock-alert-quantity">{alert.quantity.toLocaleString("fr-FR",{maximumFractionDigits:3})} {alert.product.unit}</span></td><td>{alert.minimum.toLocaleString("fr-FR",{maximumFractionDigits:3})} {alert.product.unit}</td><td>{Math.max(0,alert.minimum-alert.quantity).toLocaleString("fr-FR",{maximumFractionDigits:3})} {alert.product.unit}</td></tr>)}</tbody></table> : <p className="catalog-empty">{thresholds.length ? "Aucun produit n’a atteint son seuil." : "Définissez les seuils minimum pour activer les alertes."}</p>}
            </div>
            <div className="catalog-table-wrap">
              <h3>État du stock</h3>
              {balances.length ? (
                <table className="catalog-table">
                  <thead><tr><th>Produit</th><th>Dépôt</th><th>Quantité disponible</th><th>Unité</th></tr></thead>
                  <tbody>{balances.map((balance) => (
                    <tr key={balance.product.id + balance.location.id}>
                      <td><strong>{balance.product.name}</strong><small>{balance.product.sku}{!balance.product.is_active ? " · Archivé" : ""}</small></td>
                      <td>{balance.location.name} · {balance.location.location_type === "store" ? "Boutique" : "Dépôt"}{!balance.location.is_active ? " · Archivé" : ""}</td>
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
