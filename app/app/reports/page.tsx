import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Relation<T> = T | T[] | null;
type Membership = { tenant_id: string; role: string; tenant: Relation<{ name: string }> };
type TopProduct = { product_name: string; quantity: number; revenue: number };
type RecentSale = { id: string; total: number; completed_at: string };
type Report = {
  revenue: number; sales_count: number; average_ticket: number;
  recent_sales: RecentSale[]; top_products: TopProduct[];
  expenses: number; purchases: number; returns_amount: number; returns_count: number;
  cash_variance: number; stock_movements_count: number;
};
function one<T>(value: Relation<T>): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
function money(value: number | null | undefined) { return Number(value ?? 0).toLocaleString("fr-FR",{maximumFractionDigits:0}) + " FCFA"; }
function dateValue(value: Date) { return value.toISOString().slice(0,10); }

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ tenant_id?: string; from?: string; to?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase.from("tenant_memberships")
    .select("tenant_id,role,tenant:tenants(name)").eq("user_id", user.id);
  const workspaces = ((memberships ?? []) as unknown as Membership[])
    .map((item) => ({ ...item, tenant: one(item.tenant) }))
    .filter((item) => item.tenant && ["owner","admin"].includes(item.role));
  if (!workspaces.length) redirect("/app");

  const tenant = workspaces.find((item) => item.tenant_id === params.tenant_id) ?? workspaces[0];
  const now = new Date();
  const defaultFrom = dateValue(new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)));
  const defaultTo = dateValue(now);
  const from = params.from && /^\d{4}-\d{2}-\d{2}$/.test(params.from) ? params.from : defaultFrom;
  const to = params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.to) ? params.to : defaultTo;
  const start = new Date(from + "T00:00:00.000Z");
  const endExclusive = new Date(to + "T00:00:00.000Z");
  endExclusive.setUTCDate(endExclusive.getUTCDate()+1);
  const validRange = !Number.isNaN(start.getTime()) && !Number.isNaN(endExclusive.getTime())
    && endExclusive > start && endExclusive.getTime()-start.getTime() <= 366*24*60*60*1000;

  let report: Report | null = null;
  let reportError = false;
  if (validRange) {
    const { data, error } = await supabase.rpc("get_tenant_management_report", {
      p_tenant_id: tenant.tenant_id,
      p_from: start.toISOString(),
      p_to: endExclusive.toISOString(),
    });
    if (error) reportError = true;
    else report = data as unknown as Report;
  }

  const exportHref = "/app/reports/export?tenant_id=" + encodeURIComponent(tenant.tenant_id)
    + "&from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to);

  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/app" className="brand"><span className="mark">i</span><span>iDIABA</span></Link>
        <nav className="app-actions"><Link href="/app">Tableau de bord</Link><Link href="/app/accounting">Comptabilité</Link><Link href="/app/audit">Audit</Link></nav>
      </header>
      <section className="workspace">
        <p className="eyebrow">PILOTAGE DE L&apos;ENTREPRISE</p>
        <h1>Rapports de gestion</h1>
        <p className="lead">Suivez le chiffre d&apos;affaires, les dépenses, les achats, les retours et les mouvements de stock.</p>
        <form method="get" className="report-filter">
          <label>Entreprise<select name="tenant_id" defaultValue={tenant.tenant_id}>{workspaces.map((item) => <option key={item.tenant_id} value={item.tenant_id}>{item.tenant?.name}</option>)}</select></label>
          <label>Du<input type="date" name="from" defaultValue={from} required /></label>
          <label>Au<input type="date" name="to" defaultValue={to} required /></label>
          <button className="primary" type="submit">Afficher</button>
          {report && <a className="secondary report-export" href={exportHref}>Exporter CSV</a>}
        </form>
        {!validRange && <p className="form-error">La période doit être valide et ne pas dépasser 366 jours.</p>}
        {reportError && <p className="form-error">Impossible de charger le rapport. Vérifiez vos droits et réessayez.</p>}
        {report && <>
          <div className="report-stat-grid">
            <article><span>Chiffre d&apos;affaires</span><strong>{money(report.revenue)}</strong><small>{report.sales_count} ventes validées</small></article>
            <article><span>Panier moyen</span><strong>{money(report.average_ticket)}</strong><small>Par vente validée</small></article>
            <article><span>Dépenses</span><strong>{money(report.expenses)}</strong><small>Charges enregistrées</small></article>
            <article><span>Commandes fournisseurs</span><strong>{money(report.purchases)}</strong><small>Montant commandé</small></article>
            <article><span>Remboursements</span><strong>{money(report.returns_amount)}</strong><small>{report.returns_count} retours</small></article>
            <article><span>Écart de caisse</span><strong>{money(report.cash_variance)}</strong><small>Sessions clôturées</small></article>
            <article><span>Mouvements de stock</span><strong>{Number(report.stock_movements_count ?? 0).toLocaleString("fr-FR")}</strong><small>Opérations sur la période</small></article>
          </div>

          <section className="report-section">
            <h2>Meilleurs produits</h2>
            {report.top_products?.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Produit</th><th>Quantité vendue</th><th>Chiffre d&apos;affaires</th></tr></thead><tbody>{report.top_products.map((product,index) => <tr key={product.product_name + index}><td>{product.product_name}</td><td>{Number(product.quantity).toLocaleString("fr-FR")}</td><td>{money(product.revenue)}</td></tr>)}</tbody></table></div> : <p className="catalog-empty">Aucune vente sur cette période.</p>}
          </section>

          <section className="report-section">
            <h2>Dernières ventes</h2>
            {report.recent_sales?.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Ticket</th><th>Montant</th></tr></thead><tbody>{report.recent_sales.map((sale) => <tr key={sale.id}><td>{new Date(sale.completed_at).toLocaleString("fr-FR")}</td><td><code>{sale.id.slice(0,8)}</code></td><td>{money(sale.total)}</td></tr>)}</tbody></table></div> : <p className="catalog-empty">Aucune vente sur cette période.</p>}
          </section>
          <p className="catalog-help">La marge brute n&apos;est pas affichée : le coût d&apos;achat historique par ligne de vente doit être enregistré pour la calculer de façon fiable.</p>
        </>}
      </section>
    </main>
  );
}
