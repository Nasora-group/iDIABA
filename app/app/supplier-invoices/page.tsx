import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createSupplierInvoice, recordSupplierPayment } from "./actions";

type Workspace = { tenant_id: string; role: string; tenant: { name: string } | null };
type Supplier = { id: string; name: string };
type Order = { id: string; order_number: string; status: string; supplier_id: string; supplier: { name: string } | null; total_amount: number | string };
type Account = { id: string; code: string; name: string; account_kind: string };
type CashSession = { id: string; location: { name: string } | null; opened_at: string };
type Invoice = {
  id: string; invoice_number: string; invoice_date: string; due_date: string | null;
  description: string; amount: number | string; tax_amount: number | string; received_goods_amount: number | string; paid_amount: number | string; status: string;
  supplier: { name: string } | null; purchase_order: { order_number: string } | null;
};

export const dynamic = "force-dynamic";

export default async function SupplierInvoicesPage({ searchParams }: {
  searchParams: Promise<{ created?: string; paid?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: memberships } = await supabase.from("tenant_memberships")
    .select("tenant_id,role,tenant:tenants(name)").eq("user_id", user.id);
  const workspaces = (memberships ?? []) as unknown as Workspace[];
  const today = new Date().toISOString().slice(0, 10);
  const fmt = (value: number | string) => Number(value).toLocaleString("fr-FR", { maximumFractionDigits: 2 });

  const workspaceData = await Promise.all(workspaces.map(async (workspace) => {
    const [supplierResult, orderResult, accountResult, invoiceResult, cashSessionResult] = await Promise.all([
      supabase.from("suppliers").select("id,name").eq("tenant_id", workspace.tenant_id).eq("is_active", true).order("name"),
      supabase.from("purchase_orders").select("id,order_number,status,supplier_id,total_amount,supplier:suppliers(name)")
        .eq("tenant_id", workspace.tenant_id).in("status", ["partially_received", "received"]).order("ordered_at", { ascending: false }).limit(100),
      supabase.from("accounting_accounts").select("id,code,name,account_kind").eq("tenant_id", workspace.tenant_id).eq("is_active", true).in("account_kind", ["cash", "bank"]).order("code"),
      supabase.from("supplier_invoices").select("id,invoice_number,invoice_date,due_date,description,amount,tax_amount,received_goods_amount,paid_amount,status,supplier:suppliers(name),purchase_order:purchase_orders(order_number)")
        .eq("tenant_id", workspace.tenant_id).order("invoice_date", { ascending: false }).limit(100),
      supabase.from("cash_sessions").select("id,opened_at,location:stock_locations(name)")
        .eq("tenant_id", workspace.tenant_id).eq("opened_by", user.id).eq("status", "open").order("opened_at", { ascending: false }),
    ]);
    return {
      workspace,
      suppliers: (supplierResult.data ?? []) as Supplier[],
      orders: (orderResult.data ?? []) as unknown as Order[],
      accounts: (accountResult.data ?? []) as Account[],
      invoices: (invoiceResult.data ?? []) as unknown as Invoice[],
      cashSessions: (cashSessionResult.data ?? []) as unknown as CashSession[],
      error: supplierResult.error?.message ?? orderResult.error?.message ?? accountResult.error?.message ?? invoiceResult.error?.message ?? cashSessionResult.error?.message ?? null,
    };
  }));

  const statusLabel = (status: string) => status === "paid" ? "Réglée" : status === "partially_paid" ? "Partiellement réglée" : "À régler";
  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/app" className="brand"><span className="mark">i</span><span>iDIABA</span></Link>
        <nav className="product-nav">
          <Link href="/app">Mon espace</Link><Link href="/app/products">Catalogue</Link><Link href="/app/stock">Stocks</Link>
          <Link href="/app/pos">Caisse</Link><Link href="/app/purchasing">Achats</Link><Link href="/app/accounting">Comptabilité</Link>
          <span>Factures fournisseurs</span>
        </nav>
      </header>
      <section className="workspace catalog-workspace">
        <p className="eyebrow">FOURNISSEURS · DETTES & RÈGLEMENTS</p>
        <h1>Factures fournisseurs</h1>
        <p className="lead">Enregistrez les factures liées aux commandes réceptionnées, suivez les soldes et effectuez des règlements partiels ou complets.</p>
        {params.created && <p className="form-success">Facture enregistrée et comptabilisée.</p>}
        {params.paid && <p className="form-success">Règlement enregistré et comptabilisé.</p>}
        {params.error && <p className="form-error">{params.error === "duplicate" ? "Ce numéro de facture existe déjà pour ce fournisseur." : "Opération impossible. Vérifiez les informations, les dates, les comptes et le solde restant."}</p>}
        {workspaceData.map(({ workspace, suppliers, orders, accounts, invoices, cashSessions, error }) => {
          const outstanding = invoices.reduce((sum, invoice) => sum + Number(invoice.amount) - Number(invoice.paid_amount), 0);
          const paid = invoices.reduce((sum, invoice) => sum + Number(invoice.paid_amount), 0);
          return (
            <section className="catalog-tenant" key={workspace.tenant_id}>
              <div className="catalog-heading"><div><h2>{workspace.tenant?.name ?? "Entreprise"}</h2><p>Rôle : {workspace.role}</p></div><span className="pill">{invoices.length} facture(s)</span></div>
              {error && <p className="form-error">Erreur de chargement : {error}</p>}
              <div className="accounting-kpis">
                <article><span>Total facturé</span><strong>{fmt(invoices.reduce((n, x) => n + Number(x.amount), 0))} F</strong></article>
                <article><span>Total réglé</span><strong>{fmt(paid)} F</strong></article>
                <article><span>Dette fournisseur restante</span><strong>{fmt(outstanding)} F</strong></article>
              </div>
              <form action={createSupplierInvoice} className="catalog-form">
                <h3>Enregistrer une facture fournisseur</h3>
                <input type="hidden" name="tenant_id" value={workspace.tenant_id} />
                <div className="catalog-fields">
                  <label>Fournisseur<select name="supplier_id" required defaultValue=""><option value="" disabled>Choisir un fournisseur</option>{suppliers.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                  <label>Commande réceptionnée<select name="purchase_order_id" required defaultValue=""><option value="" disabled>Choisir une commande</option>{orders.map(x => <option key={x.id} value={x.id}>{x.order_number} · {x.supplier?.name ?? "Fournisseur"} · {x.status === "received" ? "Reçue" : "Partielle"}</option>)}</select></label>
                </div>
                <div className="catalog-fields">
                  <label>Numéro de facture<input name="invoice_number" required maxLength={100} placeholder="Ex. FAC-2026-001" /></label>
                  <label>Montant TTC (FCFA)<input name="amount" type="number" min="0.01" step="0.01" required /></label>
                  <label>TVA incluse (FCFA)<input name="tax_amount" type="number" min="0" step="0.01" defaultValue="0" /></label>
                </div>
                <div className="catalog-fields">
                  <label>Date de facture<input name="invoice_date" type="date" defaultValue={today} required /></label>
                  <label>Date d&apos;échéance<input name="due_date" type="date" /></label>
                </div>
                <label>Libellé / note<input name="description" maxLength={250} placeholder="Optionnel" /></label>
                <button className="primary" type="submit" disabled={!suppliers.length || !orders.length}>Enregistrer la facture</button>
                <p className="catalog-help">La facture doit correspondre au fournisseur de la commande et à une commande réceptionnée. Indiquez la TVA incluse si elle s'applique ; l'écart entre le montant HT et les marchandises reçues sera affiché.</p>
              </form>
              <div className="catalog-table-wrap">
                <h3>Factures et soldes fournisseurs</h3>
                {invoices.length ? <table className="catalog-table"><thead><tr><th>Facture</th><th>Fournisseur / commande</th><th>Échéance</th><th>Montant TTC</th><th>TVA</th><th>Écart HT / reçu</th><th>Réglé</th><th>Reste</th><th>État</th><th>Règlement</th></tr></thead>
                  <tbody>{invoices.map(invoice => {
                    const remaining = Math.max(0, Number(invoice.amount) - Number(invoice.paid_amount));
                    const overdue = invoice.due_date && invoice.due_date < today && remaining > 0;
                    return <tr key={invoice.id}>
                      <td><strong>{invoice.invoice_number}</strong><small>{new Date(invoice.invoice_date + "T00:00:00").toLocaleDateString("fr-FR")}</small></td>
                      <td>{invoice.supplier?.name ?? "Fournisseur"}<small>{invoice.purchase_order?.order_number ?? "Commande"}</small></td>
                      <td>{invoice.due_date ? new Date(invoice.due_date + "T00:00:00").toLocaleDateString("fr-FR") : "—"}{overdue && <small className="form-error">En retard</small>}</td>
                      <td>{fmt(invoice.amount)} F</td><td>{fmt(invoice.tax_amount)} F</td><td>{fmt(Number(invoice.amount) - Number(invoice.tax_amount) - Number(invoice.received_goods_amount))} F</td><td>{fmt(invoice.paid_amount)} F</td><td><strong>{fmt(remaining)} F</strong></td>
                      <td><span className={invoice.status === "paid" ? "catalog-state" : "catalog-state inactive"}>{statusLabel(invoice.status)}</span></td>
                      <td>{remaining > 0 && accounts.length > 0 && <form action={recordSupplierPayment} className="catalog-form">
                        <input type="hidden" name="invoice_id" value={invoice.id} />
                        <label>Montant à régler<input name="amount" type="number" min="0.01" max={remaining} step="0.01" required /></label>
                        <label>Payé depuis<select name="payment_account_id" required defaultValue=""><option value="" disabled>Choisir caisse / banque</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label>
                        <label>Session de caisse (obligatoire pour un paiement en espèces)<select name="cash_session_id" defaultValue=""><option value="">Sans objet si paiement bancaire</option>{cashSessions.map(s => <option key={s.id} value={s.id}>{s.location?.name ?? "Point de vente"} · {new Date(s.opened_at).toLocaleString("fr-FR")}</option>)}</select></label>
                        <label>Date<input name="paid_at" type="date" defaultValue={today} required /></label>
                        <label>Référence<input name="reference" maxLength={100} placeholder="N° reçu / virement" /></label>
                        <button className="archive-button" type="submit">Enregistrer le règlement</button>
                      </form>}</td>
                    </tr>;
                  })}</tbody></table> : <p className="catalog-empty">Aucune facture fournisseur enregistrée.</p>}
              </div>
            </section>
          );
        })}
      </section>
    </main>
  );
}
