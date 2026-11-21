import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveTenantId } from "@/lib/tenant";
import { ROLE_LABELS } from "@/lib/tenant-labels";
import { canAccess } from "@/lib/permissions";
import { switchCompany } from "../company/actions";
import AccessDenied from "../access-denied";

export const dynamic = "force-dynamic";

type Relation<T> = T | T[] | null;
type Membership = { tenant_id: string; role: string; tenant: Relation<{ name: string }> };
type Report = {
  revenue: number; sales_count: number; average_ticket: number; gross_margin: number;
  expenses: number; purchases: number; returns_amount: number; cash_variance: number;
};
type Row = { id: string; name: string; role: string; report: Report | null; failed: boolean };

function one<T>(value: Relation<T>): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
const money = (value: number | null | undefined) => Number(value ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " FCFA";
const dateValue = (value: Date) => value.toISOString().slice(0, 10);
const num = (value: unknown) => Number(value ?? 0) || 0;

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.from("tenant_memberships")
    .select("tenant_id,role,tenant:tenants(name)").eq("user_id", user.id);
  const memberships = ((data ?? []) as unknown as Membership[])
    .map((item) => ({ id: item.tenant_id, role: item.role, name: one(item.tenant)?.name ?? "Entreprise" }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const activeId = await getActiveTenantId(memberships.map((item) => item.id));
  const activeRole = memberships.find((item) => item.id === activeId)?.role;
  if (memberships.length && !canAccess(activeRole, "overview")) return <AccessDenied module="overview" />;

  const now = new Date();
  const defaultFrom = dateValue(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const defaultTo = dateValue(now);
  const from = params.from && /^\d{4}-\d{2}-\d{2}$/.test(params.from) ? params.from : defaultFrom;
  const to = params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.to) ? params.to : defaultTo;
  const start = new Date(from + "T00:00:00.000Z");
  const endExclusive = new Date(to + "T00:00:00.000Z");
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const validRange = !Number.isNaN(start.getTime()) && !Number.isNaN(endExclusive.getTime())
    && endExclusive > start && endExclusive.getTime() - start.getTime() <= 366 * 24 * 60 * 60 * 1000;

  const reportable = memberships.filter((item) => canAccess(item.role, "reports"));
  const restricted = memberships.filter((item) => !canAccess(item.role, "reports"));

  const rows: Row[] = validRange
    ? await Promise.all(reportable.map(async (company) => {
        const { data: report, error } = await supabase.rpc("get_tenant_management_report", {
          p_tenant_id: company.id, p_from: start.toISOString(), p_to: endExclusive.toISOString(),
        });
        return { ...company, report: error ? null : (report as unknown as Report), failed: !!error };
      }))
    : [];

  const loaded = rows.filter((row) => row.report);
  const total = loaded.reduce((acc, row) => {
    const r = row.report!;
    acc.revenue += num(r.revenue); acc.sales += num(r.sales_count); acc.expenses += num(r.expenses);
    acc.purchases += num(r.purchases); acc.margin += num(r.gross_margin); acc.returns += num(r.returns_amount);
    return acc;
  }, { revenue: 0, sales: 0, expenses: 0, purchases: 0, margin: 0, returns: 0 });
  const maxRevenue = Math.max(1, ...loaded.map((row) => num(row.report!.revenue)));
  const ranked = [...loaded].sort((a, b) => num(b.report!.revenue) - num(a.report!.revenue));

  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/app" className="brand"><span className="mark">i</span><span>iDIABA</span></Link>
        <nav className="app-actions" aria-label="Navigation principale">
          <Link href="/app">Tableau de bord</Link><Link href="/app/reports">Rapports</Link><Link href="/app/company/new">Nouvelle entreprise</Link>
        </nav>
      </header>
      <section className="workspace">
        <p className="eyebrow">MULTI-ENTREPRISE</p>
        <h1>Vue consolidée</h1>
        <p className="lead">Comparez l&apos;activité de toutes vos entreprises sur la même période. Seules celles où vous êtes propriétaire ou administrateur sont incluses. Les montants sont additionnés en FCFA.</p>

        <form className="overview-filter" method="get">
          <label>Du<input type="date" name="from" defaultValue={from} /></label>
          <label>Au<input type="date" name="to" defaultValue={to} /></label>
          <button className="primary" type="submit">Afficher</button>
        </form>
        {!validRange && <p className="form-error" role="alert">Période invalide (maximum 366 jours).</p>}
        {rows.some((row) => row.failed) && <p className="form-error" role="alert">Certaines entreprises n&apos;ont pas pu être chargées.</p>}

        {validRange && !reportable.length && <p className="catalog-empty">Aucune de vos entreprises ne vous donne accès aux rapports. Il faut y être propriétaire ou administrateur.</p>}

        {loaded.length > 0 && (
          <>
            <div className="accounting-kpis overview-kpis">
              <article><span>Chiffre d&apos;affaires</span><strong>{money(total.revenue)}</strong></article>
              <article><span>Ventes</span><strong>{total.sales.toLocaleString("fr-FR")}</strong></article>
              <article><span>Marge brute</span><strong>{money(total.margin)}</strong></article>
              <article><span>Dépenses</span><strong>{money(total.expenses)}</strong></article>
              <article><span>Achats</span><strong>{money(total.purchases)}</strong></article>
              <article><span>Retours</span><strong>{money(total.returns)}</strong></article>
            </div>

            <section className="catalog-tenant">
              <div className="catalog-heading"><div><h2>Chiffre d&apos;affaires par entreprise</h2><p>Du {new Date(from).toLocaleDateString("fr-FR")} au {new Date(to).toLocaleDateString("fr-FR")}</p></div></div>
              <div className="overview-bars">
                {ranked.map((row) => {
                  const revenue = num(row.report!.revenue);
                  const share = total.revenue > 0 ? Math.round((revenue / total.revenue) * 100) : 0;
                  return (
                    <div className="overview-bar-row" key={row.id}>
                      <span className="overview-bar-name">{row.name}</span>
                      <div className="overview-bar-track" role="img" aria-label={`${row.name} : ${money(revenue)}, ${share} % du total`}>
                        <div className="overview-bar-fill" style={{ width: `${Math.max(2, (revenue / maxRevenue) * 100)}%` }} />
                      </div>
                      <span className="overview-bar-value">{money(revenue)} · {share} %</span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="catalog-tenant">
              <div className="catalog-heading"><div><h2>Détail par entreprise</h2></div></div>
              <div className="catalog-table-wrap">
                <table className="catalog-table">
                  <thead><tr><th>Entreprise</th><th>CA</th><th>Ventes</th><th>Ticket moyen</th><th>Marge brute</th><th>Dépenses</th><th>Achats</th><th>Écart caisse</th><th /></tr></thead>
                  <tbody>
                    {ranked.map((row) => {
                      const r = row.report!;
                      return (
                        <tr key={row.id}>
                          <td><strong>{row.name}</strong><small>{ROLE_LABELS[row.role] ?? row.role}</small></td>
                          <td>{money(r.revenue)}</td>
                          <td>{num(r.sales_count).toLocaleString("fr-FR")}</td>
                          <td>{money(r.average_ticket)}</td>
                          <td>{money(r.gross_margin)}</td>
                          <td>{money(r.expenses)}</td>
                          <td>{money(r.purchases)}</td>
                          <td>{money(r.cash_variance)}</td>
                          <td>
                            {row.id === activeId ? <span className="pill">Active</span> : (
                              <form action={switchCompany}>
                                <input type="hidden" name="tenant_id" value={row.id} />
                                <input type="hidden" name="return_to" value="/app/overview" />
                                <button className="secondary" type="submit">Utiliser</button>
                              </form>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {restricted.length > 0 && (
          <p className="catalog-help">Non incluses (rôle insuffisant) : {restricted.map((item) => `${item.name} (${ROLE_LABELS[item.role] ?? item.role})`).join(", ")}.</p>
        )}
      </section>
    </main>
  );
}
