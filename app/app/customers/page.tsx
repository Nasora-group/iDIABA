import Link from "next/link";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { attachCustomerToSale, createCustomer, registerSaleReturn, setCustomerActive, updateCustomer } from "./actions";

type Workspace = { tenant_id: string; role: string; tenant: { name: string } | null };
type Customer = { id: string; name: string; phone: string; email: string; is_active: boolean; created_at: string };
type Sale = { id: string; customer_id: string | null; total: string | number; created_at: string };
type SaleItem = { id: string; sale_id: string; product_id: string; product_name: string; sku: string; quantity: string | number; unit_price: string | number; tax_rate: string | number; line_total: string | number };
type ReturnItem = { sale_item_id: string; quantity: string | number };
type SaleReturn = { id: string; sale_id: string; refund_method: string; refund_total: string | number; reason: string; created_at: string };

export const dynamic = "force-dynamic";

const money = (value: string | number) => Number(value).toLocaleString("fr-FR", { maximumFractionDigits: 2 });

export default async function CustomersPage({ searchParams }: {
  searchParams: Promise<{ created?: string; updated?: string; archived?: string; restored?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: memberships } = await supabase.from("tenant_memberships")
    .select("tenant_id,role,tenant:tenants(name)").eq("user_id", user.id);
  const workspaces = (memberships ?? []) as unknown as Workspace[];
  const data = await Promise.all(workspaces.map(async (workspace) => {
    const [customerResult, saleResult, itemResult, returnResult] = await Promise.all([
      supabase.from("customers").select("id,name,phone,email,is_active,created_at").eq("tenant_id", workspace.tenant_id).order("name").limit(500),
      supabase.from("sales").select("id,customer_id,total,created_at").eq("tenant_id", workspace.tenant_id).eq("status", "completed").order("created_at", { ascending: false }).limit(50),
      supabase.from("sale_items").select("id,sale_id,product_id,product_name,sku,quantity,unit_price,tax_rate,line_total").eq("tenant_id", workspace.tenant_id).order("created_at", { ascending: true }).limit(1000),
      supabase.from("sale_returns").select("id,sale_id,refund_method,refund_total,reason,created_at").eq("tenant_id", workspace.tenant_id).order("created_at", { ascending: false }).limit(50),
    ]);
    const customers = (customerResult.data ?? []) as Customer[];
    const sales = (saleResult.data ?? []) as Sale[];
    const saleIds = new Set(sales.map((sale) => sale.id));
    const saleItems = ((itemResult.data ?? []) as SaleItem[]).filter((item) => saleIds.has(item.sale_id));
    const returnRows = (returnResult.data ?? []) as SaleReturn[];
    const returnIds = returnRows.map((item) => item.id);
    const returnItemResult = returnIds.length
      ? await supabase.from("sale_return_items").select("sale_item_id,quantity").eq("tenant_id", workspace.tenant_id).in("sale_return_id", returnIds)
      : { data: [], error: null };
    const returned = (returnItemResult.data ?? []) as ReturnItem[];
    const returnedByLine = new Map<string, number>();
    for (const item of returned) returnedByLine.set(item.sale_item_id, (returnedByLine.get(item.sale_item_id) ?? 0) + Number(item.quantity));
    return {
      workspace, customers, sales, saleItems, returns: returnRows, returnedByLine,
      error: customerResult.error?.message ?? saleResult.error?.message ?? itemResult.error?.message ?? returnResult.error?.message ?? returnItemResult.error?.message ?? null,
    };
  }));

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="mark">i</span><span>iDIABA</span></div>
        <nav className="product-nav"><Link href="/app">Mon espace</Link><Link href="/app/products">Catalogue</Link><Link href="/app/stock">Stocks</Link><Link href="/app/inventory">Inventaires</Link><Link href="/app/pos">Caisse</Link><Link href="/app/purchasing">Achats</Link><Link href="/app/accounting">Comptabilité</Link><span>Clients & retours</span></nav>
      </header>
      <section className="workspace catalog-workspace">
        <p className="eyebrow">SPRINT 9 · RELATION CLIENT & APRÈS-VENTE</p>
        <h1>Clients et retours</h1>
        <p className="lead">Centralisez vos clients, rattachez les tickets de caisse et gérez les retours partiels avec remise en stock et émission d’un remboursement ou d’un avoir.</p>
        {params.created === "customer" && <p className="form-success">Client enregistré.</p>}
        {params.created === "assignment" && <p className="form-success">Client rattaché au ticket.</p>}
        {params.created === "return" && <p className="form-success">Retour enregistré et quantité remise en stock.</p>}\n        {params.updated && <p className="form-success">Fiche client mise à jour.</p>}\n        {params.archived && <p className="form-success">Client archivé; les tickets et retours sont conservés.</p>}\n        {params.restored && <p className="form-success">Client réactivé.</p>}
        {params.error && <p className="form-error">Opération impossible. Vérifiez les informations, les droits et la quantité encore retournable.</p>}
        {!data.length && <p>Aucun espace entreprise associé à ce compte.</p>}
        {data.map(({ workspace, customers, sales, saleItems, returns, returnedByLine, error }) => (
          <section className="catalog-tenant" key={workspace.tenant_id}>
            <div className="catalog-heading"><div><h2>{workspace.tenant?.name ?? "Entreprise"}</h2><p>Rôle : {workspace.role}</p></div><span className="pill">{customers.length} client(s) · {returns.length} retour(s) récent(s)</span></div>
            {error && <p className="form-error">Erreur de chargement : {error}</p>}
            <div className="customer-layout">
              <form action={createCustomer} className="catalog-form customer-create-form">
                <h3><span className="customer-step">01</span> Nouveau client</h3>
                <input type="hidden" name="tenant_id" value={workspace.tenant_id} />
                <label>Nom / raison sociale<input name="name" required minLength={2} maxLength={160} placeholder="Ex. Boutique Ndiaye" /></label>
                <div className="catalog-fields">
                  <label>Téléphone<input name="phone" maxLength={40} placeholder="+221 77 000 00 00" /></label>
                  <label>E-mail<input name="email" type="email" maxLength={254} placeholder="client@exemple.com" /></label>
                </div>
                <label>Adresse<input name="address" maxLength={500} placeholder="Adresse du client" /></label>
                <label>Notes<textarea name="notes" rows={2} maxLength={1000} placeholder="Informations complémentaires" /></label>
                <button className="primary" type="submit">Enregistrer le client</button>
              </form>
              <div className="customer-summary">
                <div className="customer-summary-icon">♙</div>
                <p className="eyebrow">FICHIER CLIENTS</p>
                <strong>{customers.length.toLocaleString("fr-FR")}</strong>
                <span>clients enregistrés</span>
                <p>Retrouvez les coordonnées de vos clients et associez-les aux tickets pour suivre leur historique d’achat.</p>
              </div>
            </div>
            <div className="catalog-table-wrap">
              <h3>Répertoire clients</h3>
              {customers.length ? <div className="customer-list">{customers.map((customer) => (
                <article className="customer-list-row" key={customer.id}>
                  <div className="customer-avatar">{customer.name.trim().charAt(0).toUpperCase()}</div>
                  <div className="customer-list-main"><strong>{customer.name}</strong><small>{customer.phone || "Téléphone non renseigné"}{customer.email ? " · " + customer.email : ""}</small></div>
                  <span className={customer.is_active ? "catalog-state" : "catalog-state inactive"}>{customer.is_active ? "Actif" : "Archivé"}</span>
                  <details className="customer-edit-details"><summary>Modifier</summary><form action={updateCustomer} className="catalog-form customer-edit-form"><input type="hidden" name="tenant_id" value={workspace.tenant_id} /><input type="hidden" name="customer_id" value={customer.id} /><label>Nom / raison sociale<input name="name" defaultValue={customer.name} required minLength={2} maxLength={160} /></label><div className="catalog-fields"><label>Téléphone<input name="phone" defaultValue={customer.phone} maxLength={40} /></label><label>E-mail<input name="email" type="email" defaultValue={customer.email} maxLength={254} /></label></div><label>Adresse<input name="address" defaultValue={customer.address} maxLength={500} /></label><label>Notes<textarea name="notes" defaultValue={customer.notes} rows={2} maxLength={1000} /></label><button className="secondary" type="submit">Enregistrer</button></form></details>
                  {customer.is_active ? <form action={setCustomerActive}><input type="hidden" name="tenant_id" value={workspace.tenant_id} /><input type="hidden" name="customer_id" value={customer.id} /><input type="hidden" name="active" value="false" /><button className="archive-button" type="submit">Archiver</button></form> : <form action={setCustomerActive}><input type="hidden" name="tenant_id" value={workspace.tenant_id} /><input type="hidden" name="customer_id" value={customer.id} /><input type="hidden" name="active" value="true" /><button className="secondary" type="submit">Réactiver</button></form>}
                </article>
              ))}</div> : <p className="catalog-empty">Aucun client pour le moment. Ajoutez votre premier client ci-dessus.</p>}
            </div>
            <div className="catalog-table-wrap">
              <div className="catalog-heading"><div><h3>Tickets et retours</h3><p>50 dernières ventes finalisées</p></div></div>
              {sales.length ? <div className="customer-sales-list">{sales.map((sale) => {
                const saleCustomer = customers.find((customer) => customer.id === sale.customer_id);
                const lines = saleItems.filter((item) => item.sale_id === sale.id);
                return (
                  <article className="customer-sale-card" key={sale.id}>
                    <div className="customer-sale-head">
                      <div><span className="eyebrow">TICKET {sale.id.slice(0, 8).toUpperCase()}</span><h4>{new Date(sale.created_at).toLocaleString("fr-FR")}</h4><p>{lines.length} ligne(s) · Total {money(sale.total)} FCFA</p></div>
                      <span className={saleCustomer ? "catalog-state" : "pill"}>{saleCustomer?.name ?? "Client non renseigné"}</span>
                    </div>
                    {!sale.customer_id && customers.length > 0 && <form action={attachCustomerToSale} className="customer-attach-form">
                      <input type="hidden" name="tenant_id" value={workspace.tenant_id} /><input type="hidden" name="sale_id" value={sale.id} />
                      <label>Rattacher ce ticket à un client<select name="customer_id" defaultValue="" required><option value="" disabled>Choisir un client</option>{customers.filter((customer) => customer.is_active).map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.phone ? " · " + customer.phone : ""}</option>)}</select></label>
                      <button className="secondary" type="submit">Associer</button>
                    </form>}
                    <div className="customer-sale-lines">{lines.map((line) => {
                      const returnedQty = returnedByLine.get(line.id) ?? 0;
                      const remaining = Math.max(0, Number(line.quantity) - returnedQty);
                      return <div className="customer-return-line" key={line.id}>
                        <div className="customer-return-product"><strong>{line.product_name}</strong><small>{line.sku} · Vendu : {Number(line.quantity).toLocaleString("fr-FR")} · Déjà retourné : {returnedQty.toLocaleString("fr-FR")}</small><small>Prix unitaire : {money(line.unit_price)} FCFA · TTC ligne : {money(line.line_total)} FCFA</small></div>
                        {remaining > 0 ? <form action={registerSaleReturn} className="customer-return-form">
                          <input type="hidden" name="tenant_id" value={workspace.tenant_id} /><input type="hidden" name="sale_item_id" value={line.id} /><input type="hidden" name="client_return_id" value={randomUUID()} />
                          <label>Quantité à retourner<input name="quantity" type="number" min="0.001" max={remaining} step="0.001" required placeholder={remaining.toString()} /></label>
                          <label>Mode de remboursement<select name="refund_method" defaultValue="cash"><option value="cash">Espèces</option><option value="mobile_money">Mobile Money</option><option value="card">Carte bancaire</option><option value="bank_transfer">Virement</option><option value="credit_note">Avoir client</option></select></label>
                          <label>Motif<input name="reason" minLength={2} maxLength={250} required placeholder="Ex. article défectueux" /></label>
                          <button className="secondary" type="submit">Valider le retour</button>
                        </form> : <span className="catalog-state">Quantité entièrement retournée</span>}
                      </div>;
                    })}</div>
                  </article>
                );
              })}</div> : <p className="catalog-empty">Aucune vente finalisée. Les tickets apparaîtront ici après les premiers encaissements.</p>}
            </div>
            <div className="catalog-table-wrap">
              <h3>Historique des retours</h3>
              {returns.length ? <table className="catalog-table"><thead><tr><th>Date</th><th>Ticket</th><th>Mode</th><th>Montant</th><th>Motif</th></tr></thead><tbody>{returns.map((item) => (
                <tr key={item.id}><td>{new Date(item.created_at).toLocaleString("fr-FR")}</td><td>{item.sale_id.slice(0, 8).toUpperCase()}</td><td>{item.refund_method === "credit_note" ? "Avoir client" : item.refund_method === "mobile_money" ? "Mobile Money" : item.refund_method === "bank_transfer" ? "Virement" : item.refund_method === "card" ? "Carte" : "Espèces"}</td><td><strong>{money(item.refund_total)} FCFA</strong></td><td>{item.reason}</td></tr>
              ))}</tbody></table> : <p className="catalog-empty">Aucun retour enregistré.</p>}
            </div>
          </section>
        ))}
      </section>
    </main>
  );
}
