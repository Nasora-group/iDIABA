import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { receiveStockLot } from "./actions";

type Workspace = { tenant_id: string; role: string; tenant: { name: string } | null };
type Product = { id: string; name: string; sku: string; unit: string; track_lots: boolean };
type Location = { id: string; name: string; code: string };
type Lot = { id: string; product_id: string; location_id: string; lot_code: string; expiry_date: string; received_at: string };
type LotBalance = { lot_id: string; quantity_on_hand: string | number };

export const dynamic = "force-dynamic";

export default async function LotsPage({ searchParams }: {
  searchParams: Promise<{ received?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: memberships } = await supabase.from("tenant_memberships")
    .select("tenant_id,role,tenant:tenants(name)").eq("user_id", user.id);
  const workspaces = (memberships ?? []) as unknown as Workspace[];

  const data = await Promise.all(workspaces.map(async (workspace) => {
    const [productsResult, locationsResult, lotsResult, balancesResult] = await Promise.all([
      supabase.from("products").select("id,name,sku,unit,track_lots")
        .eq("tenant_id", workspace.tenant_id).eq("track_stock", true).eq("is_active", true).order("name"),
      supabase.from("stock_locations").select("id,name,code")
        .eq("tenant_id", workspace.tenant_id).eq("is_active", true).order("name"),
      supabase.from("stock_lots").select("id,product_id,location_id,lot_code,expiry_date,received_at")
        .eq("tenant_id", workspace.tenant_id).order("expiry_date").limit(500),
      supabase.from("stock_lot_balances").select("lot_id,quantity_on_hand").eq("tenant_id", workspace.tenant_id),
    ]);
    const products = (productsResult.data ?? []) as Product[];
    const locations = (locationsResult.data ?? []) as Location[];
    const productById = new Map(products.map((item) => [item.id, item]));
    const locationById = new Map(locations.map((item) => [item.id, item]));
    const balances = new Map(((balancesResult.data ?? []) as LotBalance[]).map((item) => [item.lot_id, Number(item.quantity_on_hand)]));
    const today = new Date().toISOString().slice(0, 10);
    const lots = ((lotsResult.data ?? []) as Lot[]).map((lot) => ({
      ...lot,
      product: productById.get(lot.product_id),
      location: locationById.get(lot.location_id),
      quantity: balances.get(lot.id) ?? 0,
      daysLeft: Math.ceil((new Date(lot.expiry_date + "T00:00:00Z").getTime() - new Date(today + "T00:00:00Z").getTime()) / 86400000),
    })).filter((lot) => lot.quantity > 0 && lot.product && lot.location);
    return {
      workspace, products, locations, lots,
      error: productsResult.error?.message ?? locationsResult.error?.message ?? lotsResult.error?.message ?? balancesResult.error?.message ?? null,
    };
  }));

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="mark">i</span><span>iDIABA</span></div>
        <nav className="product-nav">
          <Link href="/app">Mon espace</Link><Link href="/app/products">Catalogue</Link>
          <Link href="/app/stock">Stocks</Link><span>Lots & péremption</span>
          <Link href="/app/inventory">Inventaires</Link><Link href="/app/pos">Caisse</Link>
          <Link href="/app/purchasing">Achats</Link><Link href="/app/accounting">Comptabilité</Link>
        </nav>
      </header>
      <section className="workspace catalog-workspace">
        <p className="eyebrow">TRAÇABILITÉ DES STOCKS</p>
        <h1>Lots et dates de péremption</h1>
        <p className="lead">Enregistrez les lots à la réception. Les sorties de stock des produits suivis par lot sont automatiquement imputées aux lots non périmés selon la méthode FEFO : première date de péremption, première sortie.</p>
        {params.received && <p className="form-success">Lot réceptionné et stock mis à jour.</p>}
        {params.error && <p className="form-error">Réception impossible : {params.error === "validation" ? "vérifiez les champs." : params.error}</p>}
        {!data.length && <p>Aucun espace entreprise associé à ce compte.</p>}
        {data.map(({ workspace, products, locations, lots, error }) => (
          <section className="catalog-tenant" key={workspace.tenant_id}>
            <div className="catalog-heading">
              <div><h2>{workspace.tenant?.name ?? "Entreprise"}</h2><p>Rôle : {workspace.role}</p></div>
              <span className="pill">{lots.length} lot(s) avec stock disponible</span>
            </div>
            {error && <p className="form-error">Erreur de chargement : {error}</p>}
            <form action={receiveStockLot} className="catalog-form stock-threshold-form">
              <h3>Réceptionner un lot</h3>
              <input type="hidden" name="tenant_id" value={workspace.tenant_id} />
              <label>Produit<select name="product_id" required defaultValue=""><option value="" disabled>Choisir un produit</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}{product.track_lots ? " · Suivi par lot" : ""}</option>)}</select></label>
              <label>Point de vente / dépôt<select name="location_id" required defaultValue=""><option value="" disabled>Choisir un emplacement</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name} · {location.code}</option>)}</select></label>
              <label>Numéro de lot<input name="lot_code" required maxLength={80} placeholder="Ex. LOT-2026-001" /></label>
              <label>Date de péremption<input name="expiry_date" type="date" required /></label>
              <label>Quantité reçue<input name="quantity" type="number" min="0.001" step="0.001" required placeholder="Ex. 50" /></label>
              <label>Note<input name="note" maxLength={500} placeholder="Fournisseur, bon de réception…" /></label>
              <p className="catalog-help">Pour activer le suivi par lot sur un produit déjà en stock, réalisez d’abord un inventaire de conversion : le stock existant doit être nul afin d’éviter une double comptabilisation. Les produits non suivis par lot conservent leur fonctionnement actuel.</p>
              <button className="primary" type="submit" disabled={!products.length || !locations.length}>Enregistrer la réception</button>
            </form>
            <div className="catalog-table-wrap">
              <h3>Lots disponibles et alertes</h3>
              {lots.length ? (
                <table className="catalog-table">
                  <thead><tr><th>Produit</th><th>Lot</th><th>Emplacement</th><th>Expiration</th><th>Stock lot</th><th>État</th></tr></thead>
                  <tbody>{lots.map((lot) => (
                    <tr key={lot.id}>
                      <td><strong>{lot.product?.name}</strong><small>{lot.product?.sku}</small></td>
                      <td>{lot.lot_code}</td><td>{lot.location?.name}</td>
                      <td>{new Date(lot.expiry_date + "T00:00:00").toLocaleDateString("fr-FR")}</td>
                      <td><strong>{lot.quantity.toLocaleString("fr-FR",{maximumFractionDigits:3})} {lot.product?.unit}</strong></td>
                      <td>{lot.daysLeft < 0 ? <span className="stock-alert-quantity">Périmé</span> : lot.daysLeft <= 30 ? <span className="stock-alert-quantity">Expire dans {lot.daysLeft} j</span> : <span className="pill">Valide</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              ) : <p className="catalog-empty">Aucun lot disponible. Les produits existants restent inchangés tant que le suivi par lot n’est pas activé.</p>}
            </div>
          </section>
        ))}
      </section>
    </main>
  );
}
