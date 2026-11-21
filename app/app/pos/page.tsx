import Link from "next/link";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { closeCashSession, openCashSession } from "./actions";
import POSCheckout from "./pos-client";

type Workspace = { tenant_id: string; role: string; tenant: { name: string } | null };
type Location = { id: string; name: string; code: string };
type Product = { id: string; name: string; sku: string; unit: string; sale_price: string | number; tax_rate: string | number; is_active: boolean };
type CashSession = { id: string; tenant_id: string; location_id: string; opening_cash: string | number; opened_at: string; location: { name: string; code: string } | null };
type Sale = { id: string; total: string | number; subtotal: string | number; tax_total: string | number; created_at: string; cashier: { full_name: string } | null };

export const dynamic = "force-dynamic";

export default async function POSPage({ searchParams }: {
  searchParams: Promise<{ opened?: string; closed?: string; sold?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: memberships } = await supabase.from("tenant_memberships")
    .select("tenant_id,role,tenant:tenants(name)").eq("user_id", user.id);
  const workspaces = (memberships ?? []) as unknown as Workspace[];

  const data = await Promise.all(workspaces.map(async (workspace) => {
    const [locationsResult, productsResult, sessionsResult, salesResult] = await Promise.all([
      supabase.from("stock_locations").select("id,name,code").eq("tenant_id", workspace.tenant_id).eq("is_active", true).order("name"),
      supabase.from("products").select("id,name,sku,unit,sale_price,tax_rate,is_active").eq("tenant_id", workspace.tenant_id).eq("is_active", true).order("name"),
      supabase.from("cash_sessions").select("id,tenant_id,location_id,opening_cash,opened_at,location:stock_locations(name,code)").eq("tenant_id", workspace.tenant_id).eq("opened_by", user.id).eq("status", "open").order("opened_at", { ascending: false }),
      supabase.from("sales").select("id,total,subtotal,tax_total,created_at,cashier:profiles(full_name)").eq("tenant_id", workspace.tenant_id).eq("status", "completed").order("created_at", { ascending: false }).limit(20),
    ]);
    return {
      workspace,
      locations: (locationsResult.data ?? []) as unknown as Location[],
      products: (productsResult.data ?? []) as Product[],
      sessions: (sessionsResult.data ?? []) as unknown as CashSession[],
      sales: (salesResult.data ?? []) as unknown as Sale[],
      error: locationsResult.error?.message ?? productsResult.error?.message ?? sessionsResult.error?.message ?? salesResult.error?.message ?? null,
    };
  }));

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="mark">i</span><span>iDIABA</span></div>
        <nav className="product-nav"><Link href="/app">Mon espace</Link><Link href="/app/products">Catalogue</Link><Link href="/app/stock">Stocks</Link><span>Caisse</span></nav>
      </header>
      <section className="workspace catalog-workspace">
        <p className="eyebrow">SPRINT 4 · VENTES & CAISSE</p>
        <h1>Point de vente</h1>
        <p className="lead">Ouvrez une session de caisse, encaissez les ventes et consultez les derniers tickets. Chaque vente met à jour le stock automatiquement.</p>
        {params.opened && <p className="form-success">Session de caisse ouverte.</p>}
        {params.closed && <p className="form-success">Session clôturée.</p>}
        {params.sold && <p className="form-success">Vente enregistrée et stock mis à jour.</p>}
        {params.error && <p className="form-error">Opération impossible : vérifiez les droits, la caisse ouverte, le paiement et le stock disponible.</p>}
        {data.map(({ workspace, locations, products, sessions, sales, error }) => (
          <section className="catalog-tenant" key={workspace.tenant_id}>
            <div className="catalog-heading"><div><h2>{workspace.tenant?.name ?? "Entreprise"}</h2><p>Rôle : {workspace.role}</p></div><span className="pill">{sales.length} dernières ventes</span></div>
            {error && <p className="form-error">Erreur de chargement : {error}</p>}
            {!sessions.length ? (
              <form action={openCashSession} className="catalog-form pos-session-form">
                <h3>Ouvrir une session de caisse</h3>
                <input type="hidden" name="tenant_id" value={workspace.tenant_id} />
                <label>Dépôt / point de vente<select name="location_id" required defaultValue=""><option value="" disabled>Choisir un dépôt</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name} · {location.code}</option>)}</select></label>
                <label>Fond de caisse initial (FCFA)<input name="opening_cash" type="number" min="0" step="0.01" defaultValue="0" required /></label>
                <button className="primary" type="submit" disabled={!locations.length}>Ouvrir la caisse</button>
                {!locations.length && <p className="catalog-help">Créez d&apos;abord un dépôt dans le module Stocks.</p>}
              </form>
            ) : sessions.map((session) => (
              <div className="pos-session" key={session.id}>
                <div className="pos-session-heading"><div><span className="catalog-state">Caisse ouverte</span><h3>{session.location?.name ?? "Point de vente"} · {session.location?.code ?? ""}</h3><p>Ouverte le {new Date(session.opened_at).toLocaleString("fr-FR")} · Fond initial : {Number(session.opening_cash).toLocaleString("fr-FR")} F</p></div>
                  <form action={closeCashSession} className="pos-close-form"><input type="hidden" name="session_id" value={session.id} /><label>Espèces comptées (FCFA)<input name="closing_cash" type="number" min="0" step="0.01" required placeholder="Montant réel" /></label><button className="secondary" type="submit">Clôturer la caisse</button></form>
                </div>
                {products.length ? <POSCheckout tenantId={workspace.tenant_id} locationId={session.location_id} sessionId={session.id} clientSaleId={randomUUID()} products={products} /> : <p className="catalog-empty">Ajoutez des produits actifs au catalogue avant de vendre.</p>}
              </div>
            ))}
            <div className="catalog-table-wrap">
              <h3>Dernières ventes</h3>
              {sales.length ? <table className="catalog-table"><thead><tr><th>Date</th><th>Ticket</th><th>Caissier</th><th>HT</th><th>Taxes</th><th>Total TTC</th></tr></thead><tbody>{sales.map((sale) => <tr key={sale.id}><td>{new Date(sale.created_at).toLocaleString("fr-FR")}</td><td><strong>{sale.id.slice(0, 8).toUpperCase()}</strong></td><td>{sale.cashier?.full_name ?? "Utilisateur"}</td><td>{Number(sale.subtotal).toLocaleString("fr-FR")} F</td><td>{Number(sale.tax_total).toLocaleString("fr-FR")} F</td><td><strong>{Number(sale.total).toLocaleString("fr-FR")} F</strong></td></tr>)}</tbody></table> : <p className="catalog-empty">Aucune vente enregistrée.</p>}
            </div>
          </section>
        ))}
      </section>
    </main>
  );
}
