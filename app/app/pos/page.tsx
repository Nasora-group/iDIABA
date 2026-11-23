import Link from "next/link";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { closeCashSession, openCashSession, recordCashMovement } from "./actions";
import POSCheckout from "./pos-client";
import CashClosePreview from "./cash-close-preview";
import OfflinePOSSeed from "./offline-seed";

type Workspace = { tenant_id: string; role: string; tenant: { name: string } | null };
type Location = { id: string; name: string; code: string };
type Product = { id: string; name: string; sku: string; barcode: string | null; unit: string; product_kind: "product" | "service"; sale_price: string | number; tax_rate: string | number; is_active: boolean };
type CashSession = { id: string; tenant_id: string; location_id: string; opened_by: string; opening_cash: string | number; opened_at: string; location: { name: string; code: string } | null };
type ClosedSession = { id: string; opening_cash: string | number; expected_cash: string | number; closing_cash: string | number; cash_variance: string | number; opened_at: string; closed_at: string; location: { name: string } | null };
type CashMovement = { id: string; cash_session_id: string; movement_type: string; amount: string | number; reason: string; created_at: string };
type CashReconciliation = { cash_sales: number | string; cash_in: number | string; cash_out: number | string; expected_cash: number | string; payments: { payment_method: string; amount: number | string; payments_count: number }[] };
type Sale = { id: string; cashier_id: string; total: string | number; subtotal: string | number; tax_total: string | number; created_at: string; cashier: { full_name: string } | null };

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
    let openSessionsQuery = supabase.from("cash_sessions")
      .select("id,tenant_id,location_id,opened_by,opening_cash,opened_at,location:stock_locations(name,code)")
      .eq("tenant_id", workspace.tenant_id)
      .eq("status", "open");
    // Managers can reconcile all sessions in their assigned locations; cashiers see only their own.
    if (!["owner", "admin", "manager"].includes(workspace.role)) {
      openSessionsQuery = openSessionsQuery.eq("opened_by", user.id);
    }
    const isManager = ["owner", "admin", "manager"].includes(workspace.role);
    const [locationsResult, productsResult, sessionsResult, closedResult, salesResult] = await Promise.all([
      supabase.from("stock_locations").select("id,name,code").eq("tenant_id", workspace.tenant_id).eq("location_type", "store").eq("is_active", true).order("name"),
      supabase.from("products").select("id,name,sku,barcode,unit,product_kind,track_stock,sale_price,tax_rate,is_active").eq("tenant_id", workspace.tenant_id).eq("is_active", true).order("name"),
      openSessionsQuery.order("opened_at", { ascending: false }),
      (() => { let query = supabase.from("cash_sessions").select("id,opening_cash,expected_cash,closing_cash,cash_variance,opened_at,closed_at,opened_by,closed_by,location:stock_locations(name)").eq("tenant_id", workspace.tenant_id).eq("status", "closed"); if (!isManager) query = query.eq("opened_by", user.id); return query.order("closed_at", { ascending: false }).limit(10); })(),
      (() => { let query = supabase.from("sales").select("id,cashier_id,total,subtotal,tax_total,created_at").eq("tenant_id", workspace.tenant_id).eq("status", "completed"); if (!isManager) query = query.eq("cashier_id", user.id); return query.order("created_at", { ascending: false }).limit(20); })(),
    ]);
    const salesRows = (salesResult.data ?? []) as unknown as Omit<Sale, "cashier">[];
    const cashierIds = [...new Set(salesRows.map((sale) => sale.cashier_id).filter(Boolean))];
    // sales.cashier_id stores the auth user UUID; there is no declared FK to profiles.
    // Fetch profile names separately instead of asking PostgREST to embed a nonexistent relationship.
    const profilesResult = cashierIds.length
      ? await supabase.from("profiles").select("id,full_name").in("id", cashierIds)
      : { data: [], error: null };
    const cashierNames = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile.full_name || "Utilisateur"]));
    const sales = salesRows.map((sale) => ({
      ...sale,
      cashier: cashierNames.has(sale.cashier_id) ? { full_name: cashierNames.get(sale.cashier_id)! } : null,
    })) as Sale[];
    const sessionRows = (sessionsResult.data ?? []) as unknown as CashSession[];
    const visibleSessionIds = sessionRows.map((session) => session.id);
    const filteredMovements = visibleSessionIds.length ? await supabase.from("cash_movements").select("id,cash_session_id,movement_type,amount,reason,created_at").in("cash_session_id", visibleSessionIds).order("created_at", { ascending: false }).limit(50) : { data: [], error: null };
    const reconciliationEntries = await Promise.all(sessionRows.map(async (session) => {
      const { data: reconciliation, error: reconciliationError } = await supabase.rpc("get_cash_session_reconciliation", {
        p_session_id: session.id,
      });
      return [session.id, !reconciliationError && reconciliation && typeof reconciliation === "object"
        ? reconciliation as unknown as CashReconciliation : null] as const;
    }));
    const reconciliations = Object.fromEntries(
      reconciliationEntries.filter((entry) => entry[1] !== null),
    ) as Record<string, CashReconciliation>;
    return {
      workspace,
      locations: (locationsResult.data ?? []) as unknown as Location[],
      products: (productsResult.data ?? []) as Product[],
      sessions: sessionRows,
      isManager,
      ownedSessionCount: sessionRows.filter((session) => session.opened_by === user.id).length,
      reconciliations,
      closedSessions: (closedResult.data ?? []) as unknown as ClosedSession[],
      sales,
      cashMovements: (filteredMovements.data ?? []) as CashMovement[],
      error: locationsResult.error?.message ?? productsResult.error?.message ?? sessionsResult.error?.message ?? closedResult.error?.message ?? salesResult.error?.message ?? filteredMovements.error?.message ?? null,
    };
  }));

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="mark">i</span><span>iDIABA</span></div>
        <nav className="product-nav"><Link href="/app">Accueil</Link><span>Caisse</span><Link href="/app/stock">Stock</Link></nav>
      </header>
      <section className="workspace catalog-workspace">
        <p className="eyebrow">ENCAISSEMENT</p>
        <h1>Caisse</h1>
        <p className="lead">Vendez, encaissez et continuez. Les outils de gestion sont rangés en dessous.</p>
        <p className="catalog-help"><Link href="/offline">Préparer la caisse hors connexion</Link></p>
        {params.opened && <p className="form-success">Session de caisse ouverte.</p>}
        {params.closed && <p className="form-success">Session clôturée. Le solde théorique et l&apos;écart ont été calculés.</p>}
        {params.sold && <p className="form-success">Vente enregistrée et stock mis à jour.</p>}
        {params.movement && <p className="form-success">Mouvement de caisse enregistré.</p>}
        {params.error === "session_already_open" && <p className="form-error" role="alert">Une caisse est déjà ouverte par votre compte sur ce dépôt. Fermez cette session avant d’en ouvrir une nouvelle.</p>}
        {params.error === "session_permission" && <p className="form-error" role="alert">Vous n’avez pas les droits nécessaires pour ouvrir une caisse dans cette entreprise. Vérifiez votre rôle.</p>}
        {params.error === "session_location" && <p className="form-error" role="alert">Le dépôt sélectionné est introuvable, inactif ou ne dépend pas de cette entreprise. Actualisez la page et choisissez un dépôt actif.</p>}
        {params.error === "session_failed" && <p className="form-error" role="alert">L’ouverture a été refusée par le serveur. Vérifiez le dépôt, vos droits et l’existence d’une session déjà ouverte.</p>}
        {params.error && !params.error.startsWith("session_") && <p className="form-error" role="alert">Opération impossible : vérifiez les droits, la caisse ouverte, le montant et les informations saisies.</p>}
        {data.map(({ workspace, locations, products, sessions, reconciliations, closedSessions, sales, cashMovements, isManager, ownedSessionCount, error }) => (
          <section className="catalog-tenant" key={workspace.tenant_id}>
            <div className="catalog-heading"><div><h2>{workspace.tenant?.name ?? "Entreprise"}</h2><p>{isManager ? "Mode gestionnaire · supervision des caisses" : "Mode caissier · votre caisse et vos ventes"}</p></div><span className="pill">{sales.length} ventes récentes</span></div>
            {isManager && <details className="pos-admin-kpis-details"><summary>Vue administrateur</summary><div className="pos-admin-kpis"><article><span>Caisses ouvertes</span><strong>{sessions.length}</strong><small>Sessions en cours</small></article><article><span>Ventes récentes</span><strong>{sales.reduce((sum, sale) => sum + Number(sale.total), 0).toLocaleString("fr-FR")} F</strong><small>Sur les 20 dernières ventes</small></article><article><span>Espèces théoriques</span><strong>{sessions.reduce((sum, session) => sum + Number(reconciliations[session.id]?.expected_cash ?? 0), 0).toLocaleString("fr-FR")} F</strong><small>À compter actuellement</small></article><article><span>Vos caisses</span><strong>{ownedSessionCount}</strong><small>Sessions ouvertes par vous</small></article></div></details>}}
            {error && <p className="form-error">Erreur de chargement : {error}</p>}
            {(!sessions.length || isManager) ? (
              <form action={openCashSession} className="catalog-form pos-session-form">
                <h3>Ouvrir votre session de caisse</h3>
                <input type="hidden" name="tenant_id" value={workspace.tenant_id} />
                <input type="hidden" name="location_id" value={locations[0]?.id ?? ""} /><p className="catalog-help">Point de vente attribué automatiquement : {locations[0]?.name ?? "aucun point de vente configuré"}. Le caissier n’a pas à choisir de dépôt.</p>
                <label>Fond de caisse initial (FCFA)<input name="opening_cash" type="number" min="0" step="0.01" defaultValue="0" required /></label>
                <button className="primary" type="submit" disabled={!locations.length}>Ouvrir la caisse</button>
                {!locations.length && <p className="catalog-help">Configurez un point de vente pour l’entreprise une seule fois. Le caissier n’aura plus à le sélectionner.</p>}
              </form>
            ) : sessions.map((session) => (
              <div className="pos-session" key={session.id}>
                <div className="pos-session-heading"><div><span className="catalog-state">Caisse ouverte</span><h3>{session.location?.name ?? "Point de vente"} · {session.location?.code ?? ""}</h3><p>Ouverte le {new Date(session.opened_at).toLocaleString("fr-FR")} · Fond initial : {Number(session.opening_cash).toLocaleString("fr-FR")} F</p></div>
                  {reconciliations[session.id] ? <CashClosePreview sessionId={session.id} expectedCash={Number(reconciliations[session.id].expected_cash)} closeAction={closeCashSession} /> : <p className="form-error">Clôture bloquée : rapprochement indisponible.</p>}
                </div>
                {reconciliations[session.id] && (
                  <div className="pos-reconciliation">
                    <div className="pos-reconciliation-total"><span>Solde espèces théorique à clôturer</span><strong>{Number(reconciliations[session.id].expected_cash).toLocaleString("fr-FR")} F</strong></div>
                    <div className="pos-reconciliation-grid">
                      <div><span>Ventes réglées en espèces</span><strong>{Number(reconciliations[session.id].cash_sales).toLocaleString("fr-FR")} F</strong></div>
                      <div><span>Entrées d&apos;espèces</span><strong>+{Number(reconciliations[session.id].cash_in).toLocaleString("fr-FR")} F</strong></div>
                      <div><span>Sorties d&apos;espèces</span><strong>−{Number(reconciliations[session.id].cash_out).toLocaleString("fr-FR")} F</strong></div>
                    </div>
                    <div className="pos-reconciliation-payments">
                      <span>Ventilation des ventes par paiement</span>
                      <div>{(reconciliations[session.id].payments ?? []).map((payment) => {
                        const labels: Record<string, string> = { cash: "Espèces", wave: "Wave", orange_money: "Orange Money", mobile_money: "Autre Mobile Money", card: "Carte", bank_transfer: "Virement" };
                        return <span key={payment.payment_method}>{labels[payment.payment_method] ?? payment.payment_method} : <strong>{Number(payment.amount).toLocaleString("fr-FR")} F</strong></span>;
                      })}</div>
                    </div>
                    <p>Calcul espèces : fond initial + ventes espèces + entrées − sorties. Wave et Orange Money ne sont pas inclus dans le montant d&apos;espèces à compter.</p>
                  </div>
                )}
                {!reconciliations[session.id] && (
                  <p className="form-error" role="status">
                    Le rapprochement automatique n&apos;est pas disponible. Actualisez la page avant de clôturer la caisse et vérifiez vos droits d&apos;accès.
                  </p>
                )}
                <details className="pos-cash-tools"><summary>Gestion des espèces · mouvements et historique</summary><div className="pos-cash-tools-inner">
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
                </div></details>
                {session.opened_by === user.id ? (products.length ? <><OfflinePOSSeed userId={user.id} tenantId={workspace.tenant_id} tenantName={workspace.tenant?.name ?? "Entreprise"} locationId={session.location_id} locationName={session.location?.name ?? "Point de vente"} sessionId={session.id} products={products} /><POSCheckout userId={user.id} tenantId={workspace.tenant_id} locationId={session.location_id} sessionId={session.id} clientSaleId={randomUUID()} products={products} /></> : <p className="catalog-empty">Ajoutez des produits actifs au catalogue avant de vendre.</p>) : <p className="pos-manager-session-note">Session de {session.opened_by.slice(0, 8)}… · supervision uniquement. Les ventes sont réservées au caissier titulaire.</p>}
              </div>
            ))}
            <div className="catalog-table-wrap">
              <h3>{isManager ? "Historique des clôtures et rapprochements" : "Vos clôtures"}</h3>
              {closedSessions.length ? <table className="catalog-table"><thead><tr><th>Point de vente / clôture</th><th>Fond initial</th><th>Solde théorique</th><th>Espèces comptées</th><th>Écart</th></tr></thead><tbody>{closedSessions.map((session) => (
                <tr key={session.id}><td><strong>{session.location?.name ?? "Point de vente"}</strong><small>{new Date(session.closed_at).toLocaleString("fr-FR")}</small></td><td>{Number(session.opening_cash).toLocaleString("fr-FR")} F</td><td>{Number(session.expected_cash).toLocaleString("fr-FR")} F</td><td>{Number(session.closing_cash).toLocaleString("fr-FR")} F</td><td><strong>{Number(session.cash_variance) > 0 ? "+" : ""}{Number(session.cash_variance).toLocaleString("fr-FR")} F</strong></td></tr>
              ))}</tbody></table> : <p className="catalog-empty">Aucune clôture enregistrée.</p>}
            </div>
            <div className="catalog-table-wrap">
              <h3>{isManager ? "Dernières ventes de l’entreprise" : "Vos dernières ventes"}</h3>
              {sales.length ? <table className="catalog-table"><thead><tr><th>Date</th><th>Ticket</th><th>Caissier</th><th>HT</th><th>Taxes</th><th>Total TTC</th></tr></thead><tbody>{sales.map((sale) => <tr key={sale.id}><td>{new Date(sale.created_at).toLocaleString("fr-FR")}</td><td><Link href={`/app/pos/receipt/${sale.id}`} className="pos-reprint-link"><strong>{sale.id.slice(0, 8).toUpperCase()}</strong><small>Voir / réimprimer</small></Link></td><td>{sale.cashier?.full_name ?? "Utilisateur"}</td><td>{Number(sale.subtotal).toLocaleString("fr-FR")} F</td><td>{Number(sale.tax_total).toLocaleString("fr-FR")} F</td><td><strong>{Number(sale.total).toLocaleString("fr-FR")} F</strong></td></tr>)}</tbody></table> : <p className="catalog-empty">Aucune vente enregistrée.</p>}
            </div>
          </section>
        ))}
      </section>
    </main>
  );
}
