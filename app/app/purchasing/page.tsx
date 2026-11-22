import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createPurchaseOrder, createReorderPurchaseOrder, createSupplier, receivePurchaseOrder, setSupplierActive, updateSupplier } from "./actions";

type Workspace = { tenant_id: string; role: string; tenant: { name: string } | null };
type Supplier = { id: string; name: string; phone: string; contact_name: string; email: string; address: string; notes: string; is_active: boolean };
type Product = { id: string; name: string; sku: string; purchase_price: string | number };
type Location = { id: string; name: string; code: string };
type Threshold = { product_id: string; location_id: string; minimum_quantity: number | string };
type Balance = { product_id: string; location_id: string; quantity_on_hand: number | string };
type Order = {
  id: string; order_number: string; status: string; ordered_at: string; total_amount: string | number;
  supplier: { name: string } | null; location: { name: string } | null;
};
type OrderLine = { id: string; quantity: string | number; received_quantity: string | number; unit_cost: string | number; product: { name: string; sku: string; track_lots: boolean } | null };

export const dynamic = "force-dynamic";

export default async function PurchasingPage({ searchParams }: {
  searchParams: Promise<{ created?: string; received?: string; updated?: string; archived?: string; restored?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: memberships } = await supabase.from("tenant_memberships")
    .select("tenant_id,role,tenant:tenants(name)").eq("user_id", user.id);
  const workspaces = (memberships ?? []) as unknown as Workspace[];

  const data = await Promise.all(workspaces.map(async (workspace) => {
    const [supplierResult, productResult, locationResult, orderResult, thresholdResult, balanceResult] = await Promise.all([
      supabase.from("suppliers").select("id,name,phone,contact_name,email,address,notes,is_active").eq("tenant_id", workspace.tenant_id).order("name"),
      supabase.from("products").select("id,name,sku,purchase_price").eq("tenant_id", workspace.tenant_id).eq("is_active", true).eq("track_stock", true).order("name"),
      supabase.from("stock_locations").select("id,name,code").eq("tenant_id", workspace.tenant_id).eq("is_active", true).order("name"),
      supabase.from("purchase_orders").select("id,order_number,status,ordered_at,total_amount,supplier:suppliers(name),location:stock_locations(name),items:purchase_order_items(id,quantity,received_quantity,unit_cost,product:products(name,sku,track_lots))").eq("tenant_id", workspace.tenant_id).order("ordered_at", { ascending: false }).limit(100),
      supabase.from("stock_reorder_thresholds").select("product_id,location_id,minimum_quantity").eq("tenant_id", workspace.tenant_id),
      supabase.from("stock_balances").select("product_id,location_id,quantity_on_hand").eq("tenant_id", workspace.tenant_id),
    ]);
    return {
      workspace,
      suppliers: (supplierResult.data ?? []) as Supplier[],
      products: (productResult.data ?? []) as Product[],
      locations: (locationResult.data ?? []) as Location[],
      orders: (orderResult.data ?? []) as unknown as (Order & { items: OrderLine[] })[],
      thresholds: (thresholdResult.data ?? []) as Threshold[],
      balances: (balanceResult.data ?? []) as Balance[],
      error: supplierResult.error?.message ?? productResult.error?.message ?? locationResult.error?.message ?? orderResult.error?.message ?? thresholdResult.error?.message ?? balanceResult.error?.message ?? null,
    };
  }));

  const statusLabel = (status: string) => status === "ordered" ? "Commandée" : status === "partially_received" ? "Partiellement reçue" : status === "received" ? "Réceptionnée" : "Annulée";

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="mark">i</span><span>iDIABA</span></div>
        <nav className="product-nav"><Link href="/app">Mon espace</Link><Link href="/app/products">Catalogue</Link><Link href="/app/stock">Stocks</Link><Link href="/app/inventory">Inventaires</Link><Link href="/app/pos">Caisse</Link><span>Achats</span><Link href="/app/supplier-invoices">Factures fournisseurs</Link><Link href="/app/accounting">Comptabilité</Link></nav>
      </header>
      <section className="workspace catalog-workspace">
        <p className="eyebrow">ACHATS & APPROVISIONNEMENT</p>
        <h1>Fournisseurs et achats</h1>
        <p className="lead">Centralisez vos fournisseurs, préparez des commandes multi-articles et réceptionnez les marchandises en une ou plusieurs fois.</p>
        {params.created && <p className="form-success">{params.created === "supplier" ? "Fournisseur enregistré." : params.created === "reorder" ? "Commande créée à partir des alertes de stock." : "Commande d'achat créée."}</p>}
        {params.received && <p className="form-success">Réception enregistrée. Les quantités reçues ont été ajoutées au stock et la commande mise à jour.</p>}
        {params.updated && <p className="form-success">Fournisseur mis à jour.</p>}
        {params.archived && <p className="form-success">Fournisseur archivé. Les commandes existantes sont conservées.</p>}
        {params.restored && <p className="form-success">Fournisseur réactivé.</p>}
        {params.error && <p className="form-error">{params.error === "lines" ? "Vérifiez les produits, quantités et coûts de chaque ligne. Un produit ne peut apparaître qu'une fois." : params.error === "receipt" ? "Aucune quantité valide à réceptionner, ou quantité supérieure au reliquat." : "Opération impossible. Vérifiez les informations, les droits et les références sélectionnées."}</p>}
        {!data.length && <p>Aucun espace entreprise associé à ce compte.</p>}
        {data.map(({ workspace, suppliers, products, locations, orders, thresholds, balances, error }) => (
          <section className="catalog-tenant" key={workspace.tenant_id}>
            <div className="catalog-heading"><div><h2>{workspace.tenant?.name ?? "Entreprise"}</h2><p>Rôle : {workspace.role}</p></div><span className="pill">{suppliers.length} fournisseur(s) · {orders.length} commande(s)</span></div>
            {error && <p className="form-error">Erreur de chargement : {error}</p>}
            <div className="catalog-forms purchasing-forms">
              <form action={createSupplier} className="catalog-form">
                <h3>Ajouter un fournisseur</h3>
                <input type="hidden" name="tenant_id" value={workspace.tenant_id} />
                <label>Raison sociale / nom<input name="name" required maxLength={160} placeholder="Nom du fournisseur" /></label>
                <label>Contact<input name="contact_name" maxLength={120} placeholder="Nom du contact" /></label>
                <div className="catalog-fields"><label>Téléphone<input name="phone" maxLength={40} placeholder="+221 ..." /></label><label>E-mail<input name="email" type="email" maxLength={160} placeholder="contact@exemple.com" /></label></div>
                <label>Adresse<input name="address" maxLength={500} placeholder="Adresse du fournisseur" /></label>
                <label>Notes<input name="notes" maxLength={1000} placeholder="Informations utiles" /></label>
                <button className="primary" type="submit">Enregistrer le fournisseur</button>
              </form>
              <form action={createPurchaseOrder} className="catalog-form">
                <h3>Créer une commande d&apos;achat</h3>
                <input type="hidden" name="tenant_id" value={workspace.tenant_id} />
                <label>Fournisseur<select name="supplier_id" required defaultValue=""><option value="" disabled>Choisir un fournisseur</option>{suppliers.filter((supplier) => supplier.is_active).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
                <label>Dépôt de réception<select name="location_id" required defaultValue=""><option value="" disabled>Choisir un dépôt</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name} · {location.code}</option>)}</select></label>
                <h4>Articles de la commande</h4>
                <p className="catalog-help">Ajoutez jusqu&apos;à 5 articles sur ce formulaire. Chaque produit doit être unique dans la commande.</p>
                {Array.from({ length: 5 }, (_, index) => (
                  <div className="catalog-form" key={index}>
                    <p><strong>Article {index + 1}</strong></p>
                    <label>Produit<select name="product_id" required={index === 0} defaultValue=""><option value="">Choisir un produit</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select></label>
                    <div className="catalog-fields"><label>Quantité<input name="quantity" type="number" min="0.001" max="1000000000" step="0.001" required={index === 0} placeholder="Ex. 20" /></label><label>Coût unitaire (FCFA)<input name="unit_cost" type="number" min="0" max="999999999999" step="0.01" required={index === 0} placeholder="Prix d'achat" /></label></div>
                  </div>
                ))}
                <label>Note / référence fournisseur<input name="notes" maxLength={1000} placeholder="Optionnel" /></label>
                <button className="primary" type="submit" disabled={!suppliers.some((supplier) => supplier.is_active) || !products.length || !locations.length}>Créer la commande</button>
                {(!suppliers.length || !products.length || !locations.length) && <p className="catalog-help">Ajoutez un fournisseur, un produit et un dépôt actif pour démarrer.</p>}
              </form>
            </div>
            <div className="catalog-table-wrap stock-reorder-suggestions">
              <h3>Réapprovisionnement suggéré</h3>
              {thresholds.map((threshold) => {
                const product = products.find((p) => p.id === threshold.product_id);
                const location = locations.find((l) => l.id === threshold.location_id);
                const balance = balances.find((b) => b.product_id === threshold.product_id && b.location_id === threshold.location_id);
                const current = Number(balance?.quantity_on_hand ?? 0);
                const minimum = Number(threshold.minimum_quantity);
                const orderQuantity = Math.max(0, minimum - current);
                if (!product || !location || orderQuantity <= 0) return null;
                return <div className="stock-reorder-card" key={product.id + location.id}>
                  <div><strong>{product.name}</strong><small>{product.sku} · {location.name}</small></div>
                  <span>Stock {current} / seuil {minimum}</span>
                  <strong>À commander : {orderQuantity}</strong>
                  <small>Estimation : {(orderQuantity * Number(product.purchase_price)).toLocaleString("fr-FR")} F</small>
                </div>;
              })}
              {thresholds.some((threshold) => {
                const current = Number(balances.find((b) => b.product_id === threshold.product_id && b.location_id === threshold.location_id)?.quantity_on_hand ?? 0);
                return current < Number(threshold.minimum_quantity) && products.some((p) => p.id === threshold.product_id) && locations.some((l) => l.id === threshold.location_id);
              }) ? <form action={createReorderPurchaseOrder} className="catalog-form stock-reorder-action">
                <input type="hidden" name="tenant_id" value={workspace.tenant_id}/>
                <label>Fournisseur<select name="supplier_id" required defaultValue=""><option value="" disabled>Choisir un fournisseur</option>{suppliers.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                <label>Dépôt concerné<select name="location_id" required defaultValue=""><option value="" disabled>Choisir un dépôt</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.code}</option>)}</select></label>
                <button className="primary" type="submit" disabled={!suppliers.some((s) => s.is_active)}>Générer une commande selon les seuils</button>
                <p className="catalog-help">La commande générée reprend les quantités nécessaires pour revenir au seuil minimum, au dépôt choisi.</p>
              </form> : <p className="catalog-empty">Aucun article sous seuil pour les dépôts actifs.</p>}
            </div>
            <div className="catalog-table-wrap">
              <h3>Fournisseurs enregistrés</h3>
              {suppliers.length ? <table className="catalog-table"><thead><tr><th>Fournisseur</th><th>Contact</th><th>Téléphone</th><th>E-mail</th><th>État</th><th>Actions</th></tr></thead><tbody>{suppliers.map((supplier) => <tr key={supplier.id}><td><strong>{supplier.name}</strong><small>{supplier.address || "—"}</small></td><td>{supplier.contact_name || "—"}</td><td>{supplier.phone || "—"}</td><td>{supplier.email || "—"}</td><td>{supplier.is_active ? "Actif" : "Archivé"}</td><td><details className="supplier-edit-details"><summary>Modifier</summary><form action={updateSupplier} className="catalog-form supplier-edit-form"><input type="hidden" name="tenant_id" value={workspace.tenant_id} /><input type="hidden" name="supplier_id" value={supplier.id} /><label>Nom<input name="name" defaultValue={supplier.name} required maxLength={160} /></label><label>Contact<input name="contact_name" defaultValue={supplier.contact_name} maxLength={120} /></label><div className="catalog-fields"><label>Téléphone<input name="phone" defaultValue={supplier.phone} maxLength={40} /></label><label>E-mail<input name="email" type="email" defaultValue={supplier.email} maxLength={160} /></label></div><label>Adresse<input name="address" defaultValue={supplier.address} maxLength={500} /></label><label>Notes<input name="notes" defaultValue={supplier.notes} maxLength={1000} /></label><button className="secondary" type="submit">Enregistrer</button></form></details>{supplier.is_active ? <form action={setSupplierActive}><input type="hidden" name="tenant_id" value={workspace.tenant_id} /><input type="hidden" name="supplier_id" value={supplier.id} /><input type="hidden" name="active" value="false" /><button className="archive-button" type="submit">Archiver</button></form> : <form action={setSupplierActive}><input type="hidden" name="tenant_id" value={workspace.tenant_id} /><input type="hidden" name="supplier_id" value={supplier.id} /><input type="hidden" name="active" value="true" /><button className="secondary" type="submit">Réactiver</button></form>}</td></tr>)}</tbody></table> : <p className="catalog-empty">Aucun fournisseur enregistré.</p>}
            </div>
            <div className="catalog-table-wrap">
              <h3>Commandes d&apos;achat</h3>
              {orders.length ? <table className="catalog-table"><thead><tr><th>Commande / date</th><th>Fournisseur</th><th>Articles</th><th>Dépôt</th><th>Montant</th><th>État</th><th>Réception</th></tr></thead><tbody>{orders.map((order) => (
                <tr key={order.id}>
                  <td><strong>{order.order_number}</strong><small>{new Date(order.ordered_at).toLocaleDateString("fr-FR")}</small></td>
                  <td>{order.supplier?.name ?? "Fournisseur"}</td>
                  <td>{order.items?.map((line) => <small key={line.id}>{line.product?.name ?? "Produit"} · {Number(line.received_quantity).toLocaleString("fr-FR")} / {Number(line.quantity).toLocaleString("fr-FR")}</small>)}</td>
                  <td>{order.location?.name ?? "Dépôt"}</td>
                  <td><strong>{Number(order.total_amount).toLocaleString("fr-FR")} F</strong></td>
                  <td><span className={order.status === "received" ? "catalog-state" : "catalog-state inactive"}>{statusLabel(order.status)}</span></td>
                  <td>{["ordered", "partially_received"].includes(order.status) && <form action={receivePurchaseOrder}>
                    <input type="hidden" name="purchase_order_id" value={order.id} />
                    {order.items?.map((line) => {
                      const remaining = Math.max(0, Number(line.quantity) - Number(line.received_quantity));
                      return <div key={line.id}>
                        <input type="hidden" name="order_item_id" value={line.id} />
                        <label><small>{line.product?.name ?? "Produit"} · reste {remaining.toLocaleString("fr-FR")}</small>
                          <input name="quantity" type="number" min="0" max={remaining} step="0.001" defaultValue={remaining} />
                        </label>
                        {line.product?.track_lots && remaining > 0 ? <div className="catalog-fields">
                          <label>Numéro de lot<input name="lot_code" required maxLength={80} placeholder="N° du lot fournisseur" /></label>
                          <label>Date de péremption<input name="expiry_date" type="date" required /></label>
                        </div> : <><input type="hidden" name="lot_code" value="" /><input type="hidden" name="expiry_date" value="" /></>}
                      </div>;
                    })}
                    <button className="archive-button" type="submit">Enregistrer la réception</button>
                  </form>}</td>
                </tr>
              ))}</tbody></table> : <p className="catalog-empty">Aucune commande créée.</p>}
            </div>
          </section>
        ))}
      </section>
    </main>
  );
}
