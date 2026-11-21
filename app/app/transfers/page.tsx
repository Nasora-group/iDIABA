import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createStockTransfer, receiveStockTransfer, shipStockTransfer } from "./actions";

type Workspace = { tenant_id: string; role: string; tenant: { name: string } | null };
type Location = { id: string; name: string; code: string; location_type: string };
type Product = { id: string; name: string; sku: string; is_active: boolean };
type Transfer = {
  id: string; tenant_id: string; transfer_number: string; source_location_id: string;
  destination_location_id: string; status: string; notes: string; created_at: string;
  source: Location | null; destination: Location | null;
};
type TransferItem = {
  id: string; transfer_id: string; product_id: string; quantity: number | string;
  received_quantity: number | string; product: Product | null;
};

export const dynamic = "force-dynamic";

export default async function TransfersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: memberships } = await supabase.from("tenant_memberships")
    .select("tenant_id,role,tenant:tenants(name)").eq("user_id", user.id);
  const workspaces = (memberships ?? []) as unknown as Workspace[];
  const data = await Promise.all(workspaces.map(async (workspace) => {
    const [locationResult, productResult, transferResult] = await Promise.all([
      supabase.from("stock_locations").select("id,name,code,location_type").eq("tenant_id", workspace.tenant_id).eq("is_active", true).order("name"),
      supabase.from("products").select("id,name,sku,is_active").eq("tenant_id", workspace.tenant_id).eq("is_active", true).order("name"),
      supabase.from("stock_transfers").select("id,tenant_id,transfer_number,source_location_id,destination_location_id,status,notes,created_at").eq("tenant_id", workspace.tenant_id).order("created_at", { ascending: false }).limit(100),
    ]);
    const locations = (locationResult.data ?? []) as Location[];
    const products = (productResult.data ?? []) as Product[];
    const transfers = (transferResult.data ?? []) as Transfer[];
    const transferIds = transfers.map((item) => item.id);
    const itemResult = transferIds.length
      ? await supabase.from("stock_transfer_items").select("id,transfer_id,product_id,quantity,received_quantity").eq("tenant_id", workspace.tenant_id).in("transfer_id", transferIds)
      : { data: [], error: null };
    const items = (itemResult.data ?? []) as TransferItem[];
    const locationMap = new Map(locations.map((item) => [item.id, item]));
    const productMap = new Map(products.map((item) => [item.id, item]));
    const itemsByTransfer = new Map<string, TransferItem[]>();
    for (const item of items) {
      item.product = productMap.get(item.product_id) ?? null;
      itemsByTransfer.set(item.transfer_id, [...(itemsByTransfer.get(item.transfer_id) ?? []), item]);
    }
    return {
      workspace, locations, products,
      transfers: transfers.map((item) => ({
        ...item,
        source: locationMap.get(item.source_location_id) ?? null,
        destination: locationMap.get(item.destination_location_id) ?? null,
        items: itemsByTransfer.get(item.id) ?? [],
      })),
      error: locationResult.error?.message ?? productResult.error?.message ?? transferResult.error?.message ?? itemResult.error?.message ?? null,
    };
  }));

  const messages: Record<string, string> = {
    created: "Transfert créé en brouillon.",
    shipped: "Expédition validée. Le stock a été retiré du dépôt source.",
    received: "Réception enregistrée. Le stock reçu a été ajouté au dépôt destinataire.",
    validation: "Vérifiez les dépôts, les produits et les quantités.",
    create: "Création impossible. Vérifiez le stock disponible et vos droits.",
    ship: "Expédition impossible. Le stock source a peut-être changé.",
    receive: "Réception impossible. Vérifiez les quantités restantes et vos droits.",
  };
  const statusLabel: Record<string, string> = {
    draft: "Brouillon", shipped: "Expédié", partially_received: "Réception partielle",
    received: "Réceptionné", canceled: "Annulé",
  };

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="mark">i</span><span>iDIABA</span></div>
        <nav className="product-nav"><Link href="/app">Mon espace</Link><Link href="/app/stock">Stocks</Link><Link href="/app/inventory">Inventaires</Link><span>Transferts</span><Link href="/app/pos">Caisse</Link></nav>
      </header>
      <section className="workspace catalog-workspace">
        <p className="eyebrow">STOCKS · MOUVEMENTS INTER-ÉTABLISSEMENTS</p>
        <h1>Transferts de stock</h1>
        <p className="lead">Créez un transfert, validez son expédition, puis enregistrez les quantités réellement reçues. Les mouvements de stock sont tracés à chaque étape.</p>
        {params.status && messages[params.status] && <p className={["created","shipped","received"].includes(params.status) ? "form-success" : "form-error"}>{messages[params.status]}</p>}
        {data.map(({ workspace, locations, products, transfers, error }) => {
          const canManage = ["owner","admin","manager","stock"].includes(workspace.role);
          return (
            <section className="catalog-tenant" key={workspace.tenant_id}>
              <div className="catalog-heading"><div><h2>{workspace.tenant?.name ?? "Entreprise"}</h2><p>Rôle : {workspace.role}</p></div><span className="pill">{transfers.length} transfert(s)</span></div>
              {error && <p className="form-error">Erreur de chargement : {error}</p>}
              {canManage && locations.length >= 2 && products.length > 0 && (
                <form action={createStockTransfer} className="catalog-form">
                  <h3>Nouveau transfert</h3>
                  <input type="hidden" name="tenant_id" value={workspace.tenant_id} />
                  <div className="catalog-fields">
                    <label>Dépôt / boutique source<select name="source_location_id" required defaultValue=""><option value="" disabled>Choisir</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</select></label>
                    <label>Destination<select name="destination_location_id" required defaultValue=""><option value="" disabled>Choisir</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</select></label>
                  </div>
                  {[1,2,3].map((line) => (
                    <div className="catalog-fields" key={line}>
                      <label>Produit {line}<select name={"product_id_" + line} defaultValue=""><option value="">—</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}</select></label>
                      <label>Quantité<input type="number" name={"quantity_" + line} min="0.001" step="0.001" /></label>
                    </div>
                  ))}
                  <label>Note<input name="notes" maxLength={1000} placeholder="Motif ou référence du transfert" /></label>
                  <button className="primary" type="submit">Créer le transfert</button>
                </form>
              )}
              {transfers.length ? transfers.map((transfer) => (
                <article className="offline-panel" key={transfer.id}>
                  <div className="catalog-heading">
                    <div><h3>{transfer.transfer_number}</h3><p>{transfer.source?.name ?? "Source"} → {transfer.destination?.name ?? "Destination"}</p></div>
                    <span className="pill">{statusLabel[transfer.status] ?? transfer.status}</span>
                  </div>
                  <p className="catalog-help">Créé le {new Date(transfer.created_at).toLocaleString("fr-FR")} · {transfer.notes || "Sans note"}</p>
                  <table className="catalog-table">
                    <thead><tr><th>Produit</th><th>Expédié</th><th>Reçu</th><th>Reste à recevoir</th></tr></thead>
                    <tbody>{transfer.items.map((item) => {
                      const quantity = Number(item.quantity);
                      const received = Number(item.received_quantity);
                      return <tr key={item.id}><td>{item.product?.name ?? "Produit"}<small>{item.product?.sku ?? ""}</small></td><td>{quantity.toLocaleString("fr-FR")}</td><td>{received.toLocaleString("fr-FR")}</td><td>{(quantity-received).toLocaleString("fr-FR")}</td></tr>;
                    })}</tbody>
                  </table>
                  {canManage && transfer.status === "draft" && <form action={shipStockTransfer}><input type="hidden" name="transfer_id" value={transfer.id}/><button className="primary" type="submit">Valider l’expédition</button></form>}
                  {canManage && ["shipped","partially_received"].includes(transfer.status) && (
                    <form action={receiveStockTransfer} className="catalog-form">
                      <input type="hidden" name="transfer_id" value={transfer.id}/>
                      <h4>Valider la réception</h4>
                      {transfer.items.filter((item) => Number(item.quantity) > Number(item.received_quantity)).map((item) => {
                        const remaining = Number(item.quantity)-Number(item.received_quantity);
                        return <label key={item.id}>{item.product?.name ?? "Produit"} · restant {remaining.toLocaleString("fr-FR")}<input type="number" name={"received_"+item.id} min="0" max={remaining} step="0.001" defaultValue={remaining}/></label>;
                      })}
                      <label>Note de réception<input name="notes" maxLength={1000} placeholder="Écart, casse ou observation" /></label>
                      <button className="primary" type="submit">Enregistrer les quantités reçues</button>
                    </form>
                  )}
                </article>
              )) : <p className="catalog-empty">Aucun transfert pour cette entreprise.</p>}
            </section>
          );
        })}
      </section>
    </main>
  );
}
