import Link from "next/link";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { closeCashSession, openCashSession, recordCashMovement } from "./actions";
import POSCheckout from "./pos-client";
import OfflinePOSSeed from "./offline-seed";

type Workspace = { tenant_id: string; role: string; tenant: { name: string } | null };
type Location = { id: string; name: string; code: string };
type Product = { id: string; name: string; sku: string; unit: string; sale_price: string | number; tax_rate: string | number; is_active: boolean };
type CashSession = { id: string; tenant_id: string; location_id: string; opening_cash: string | number; opened_at: string; location: { name: string; code: string } | null };
type ClosedSession = { id: string; opening_cash: string | number; expected_cash: string | number; closing_cash: string | number; cash_variance: string | number; opened_at: string; closed_at: string; location: { name: string } | null };
type CashMovement = { id: string; cash_session_id: string; movement_type: string; amount: string | number; reason: string; created_at: string };
type Sale = { id: string; total: string | number; subtotal: string | number; tax_total: string | number; created_at: string; cashier: { full_name: string } | null };

export const dynamic = "force-dynamic";

export default async function POSPage({ searchParams }: {
  searchParams: Promise<{ opened?: string; closed?: string; sold?: string; movement?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: memberships } = await supabase.from("tenant_memberships")
    .select("tenant_id,role,tenant:tenants(name)").eq("user_id", user.id);
  const workspaces = (memberships ?? []) as unknown as Workspace[];

  const data = await Promise.all(workspaces.map(async (workspace) => {
    const [locationsResult, productsResult, sessionsResult, closedResult, salesResult, movementResult] = await Promise.all([
      supabase.from("stock_locations").select("id,name,code").eq("tenant_id", workspace.tenant_id).eq("is_active", true).order("name"),
      supabase.from("products").select("id,name,sku,unit,sale_price,tax_rate,is_active").eq("tenant_id", workspace.tenant_id).eq("is_active", true).order("name"),
      supabase.from("cash_sessions").select("id,tenant_id,location_id,opening_cash,opened_at,location:stock_locations(name,code)").eq("tenant_id", workspace.tenant_id).eq("opened_by", user.id).eq("status", "open").order("opened_at", { ascending: false }),
      supabase.from("cash_sessions").select("id,opening_cash,expected_cash,closing_cash,cash_variance,opened_at,closed_at,location:stock_locations(name)").eq("tenant_id", workspace.tenant_id).eq("status", "closed").order("closed_at", { ascending: false }).limit(10),
      supabase.from("sales").select("id,total,subtotal,tax_total,created_at,cashier:profiles(full_name)").eq("tenant_id", workspace.tenant_id).eq("status", "completed").order("created_at", { ascending: false }).limit(20),
      supabase.from("cash_movements").select("id,cash_session_id,movement_type,amount,reason,created_at").eq("tenant_id", workspace.tenant_id).order("created_at", { ascending: false }).limit(50),
    ]);
    return {
      workspace,
      locations: (locationsResult.data ?? []) as unknown as Location[],
      products: (productsResult.data ?? []) as Product[],
      sessions: (sessionsResult.data ?? []) as unknown as CashSession[],
      closedSessions: (closedResult.data ?? []) as unknown as ClosedSession[],
      sales: (salesResult.data ?? []) as unknown as Sale[],
      cashMovements: (movementResult.data ?? []) as CashMovement[],
      error: locationsResult.error?.message ?? productsResult.error?.message ?? sessionsResult.error?.message ?? closedResult.error?.message ?? salesResult.error?.message ?? movementResult.error?.message ?? null,
    };
  }));

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="mark">i</span><span>iDIABA</span></div>
        <nav className="product-nav"><Link href="/app">Mon espace</Link><Link href="/app/products">Catalogue</Link><Link href="/app/stock">Stocks</Link><Link href="/app/inventory">Inventaires</Link><span>Caisse</span><Link href="/app/purchasing">Achats</Link><Link href="/app/accounting">Comptabilité</Link></nav>
      </header>
      <section className="workspace catalog-workspace">
        <p className="eyebrow">SPRINT 6 · CAISSE & RAPPROCHEMENT</p>
        <h1>Point de vente</h1>
        <p className="lead">Encaissez avec plusieurs moyens de paiement, suivez les entrées et sorties d&apos;espèces et contrôlez les écarts à la clôture.</p>
        <p className="catalog-help"><Link href="/offline">Préparer / ouvrir la caisse hors connexion</Link> · Consultez cette page une première fois en ligne sur chaque appareil.</p>
        {params.opened && <p className="form-success">Session de caisse ouverte.</p>}
        {params.closed && <p className="form-success">Session clôturée. Le solde théorique et l&apos;écart ont été calculés.</p>}
        {params.sold && <p className="form-success">Vente enregistrée et stock mis à jour.</p>}
        {params.movement && <p className="form-success">Mouvement de caisse enregistré.</p>}
        {params.error && <p className="form-error">Opération impossible : vérifiez les droits, la caisse ouverte, le montant et les informations saisies.</p>}
        {data.map(({ workspace, locations, products, sessions, closedSessions, sales, cashMovements, error }) => (
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
                <div className="pos-cash-tools">
                  <form action={recordCashMovement} className="pos-cash-movement">
                    <h4>Entrée / sortie d&apos;espèces</h4>
                    <input type="hidden" name="session_id" value={session.id} />
                    <label>Type<select name="movement_type"><option value="cash_in">Entrée d&apos;espèces</option><option value="cash_out">Sortie d&apos;espèces</option></select></label>
                    <label>Montant (FCFA)<input name="amount" type="number" min="0.01" step="0.01" required /></label>
                    <label>Motif<input name="reason" minLength={2} maxLength={250} required placeholder="Ex. petite dépense, apport..." /></label>
                    <button className="secondary" type="submit">Enregistrer le mouvement</button>
                  </form>
                  <div className="pos-cash-history">
                    <h4>Derniers mouvements de caisse</h4>
                    {cashMovements.filter((movement) => movement.cash_session_id === session.id).length ? (
                      <ul>{cashMovements.filter((movement) => movement.cash_session_id === session.id).slice(0, 8).map((movement) => (
                        <li key={movement.id}><span>{movement.movement_type === "cash_in" ? "Entrée" : "Sortie"} · {movement.reason}<small>{new Date(movement.created_at).toLocaleString("fr-FR")}</small></span><strong>{movement.movement_type === "cash_in" ? "+" : "−"}{Number(movement.amount).toLocaleString("fr-FR")} F</strong></li>
                      ))}</ul>
                    ) : <p className="catalog-empty">Aucun mouvement hors ventes.</p>}
                  </div>
                </div>
                {products.length ? <><OfflinePOSSeed userId={user.id} tenantId={workspace.tenant_id} tenantName={workspace.tenant?.name ?? "Entreprise"} locationId={session.location_id} locationName={session.location?.name ?? "Point de vente"} sessionId={session.id} products={products} /><POSCheckout userId={user.id} tenantId={workspace.tenant_id} locationId={session.location_id} sessionId={session.id} clientSaleId={randomUUID()} products={products} /></> : <p className="catalog-empty">Ajoutez des produits actifs au catalogue avant de vendre.</p>}
              </div>
            ))}
            <div className="catalog-table-wrap">
              <h3>Historique des clôtures et rapprochements</h3>
              {closedSessions.length ? <table className="catalog-table"><thead><tr><th>Point de vente / clôture</th><th>Fond initial</th><th>Solde théorique</th><th>Espèces comptées</th><th>Écart</th></tr></thead><tbody>{closedSessions.map((session) => (
                <tr key={session.id}><td><strong>{session.location?.name ?? "Point de vente"}</strong><small>{new Date(session.closed_at).toLocaleString("fr-FR")}</small></td><td>{Number(session.opening_cash).toLocaleString("fr-FR")} F</td><td>{Number(session.expected_cash).toLocaleString("fr-FR")} F</td><td>{Number(session.closing_cash).toLocaleString("fr-FR")} F</td><td><strong>{Number(session.cash_variance) > 0 ? "+" : ""}{Number(session.cash_variance).toLocaleString("fr-FR")} F</strong></td></tr>
              ))}</tbody></table> : <p className="catalog-empty">Aucune clôture enregistrée.</p>}
            </div>
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
