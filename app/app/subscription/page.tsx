import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requestSubscriptionChange } from "./actions";

export const dynamic = "force-dynamic";

type Membership = { tenant_id: string; role: string; tenant: { id: string; name: string } | null };
type Plan = {
  id: string; code: string; name: string; description: string;
  price_monthly_fcfa: number | string | null; price_yearly_fcfa: number | string | null;
  max_users: number | null; max_locations: number | null; max_products: number | null; max_monthly_sales: number | null;
};
type Subscription = {
  status: string; billing_interval: string; trial_ends_at: string | null; current_period_ends_at: string | null;
  plan: Plan | Plan[] | null;
};
type RequestRow = { id: string; status: string; payment_method: string; payment_reference: string; created_at: string; plan: { name: string } | null };

function formatLimit(value: number | null, unit: string) {
  return value === null ? "Illimité" : value.toLocaleString("fr-FR") + " " + unit;
}
function formatPrice(value: number | string | null) {
  if (value === null) return "Tarif à définir";
  return Number(value) === 0 ? "Gratuit" : Number(value).toLocaleString("fr-FR") + " FCFA";
}
function statusLabel(status: string) {
  return ({ trialing: "Essai en cours", active: "Actif", past_due: "Paiement en attente", suspended: "Suspendu", canceled: "Résilié", expired: "Expiré" } as Record<string, string>)[status] ?? status;
}

export default async function SubscriptionPage({ searchParams }: { searchParams: Promise<{ error?: string; requested?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase.from("tenant_memberships")
    .select("tenant_id,role,tenant:tenants(id,name)").eq("user_id", user.id);
  const workspaces = ((memberships ?? []) as unknown as Membership[])
    .filter((item) => item.tenant && ["owner", "admin"].includes(item.role));

  const { data: plans } = await supabase.from("subscription_plans")
    .select("id,code,name,description,price_monthly_fcfa,price_yearly_fcfa,max_users,max_locations,max_products,max_monthly_sales")
    .eq("is_active", true).order("price_monthly_fcfa", { ascending: true, nullsFirst: false });
  const availablePlans = (plans ?? []) as Plan[];

  const panels = await Promise.all(workspaces.map(async (workspace) => {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
    const [subResult, products, locations, users, sales, requests] = await Promise.all([
      supabase.from("tenant_subscriptions").select("status,billing_interval,trial_ends_at,current_period_ends_at,plan:subscription_plans(id,code,name,description,price_monthly_fcfa,price_yearly_fcfa,max_users,max_locations,max_products,max_monthly_sales)").eq("tenant_id", workspace.tenant_id).maybeSingle(),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("tenant_id", workspace.tenant_id).eq("is_active", true),
      supabase.from("stock_locations").select("id", { count: "exact", head: true }).eq("tenant_id", workspace.tenant_id).eq("is_active", true),
      supabase.from("tenant_memberships").select("id", { count: "exact", head: true }).eq("tenant_id", workspace.tenant_id),
      supabase.from("sales").select("id", { count: "exact", head: true }).eq("tenant_id", workspace.tenant_id).eq("status", "completed").gte("created_at", monthStart).lt("created_at", nextMonth),
      supabase.from("subscription_requests").select("id,status,payment_method,payment_reference,created_at,plan:subscription_plans(name)").eq("tenant_id", workspace.tenant_id).order("created_at", { ascending: false }).limit(5),
    ]);
    const subscription = subResult.data as unknown as Subscription | null;
    const plan = Array.isArray(subscription?.plan) ? subscription.plan[0] : subscription?.plan;
    return {
      tenantId: workspace.tenant_id, tenantName: workspace.tenant!.name, role: workspace.role,
      subscription, plan,
      usage: { products: products.count ?? 0, locations: locations.count ?? 0, users: users.count ?? 0, sales: sales.count ?? 0 },
      requests: (requests.data ?? []) as unknown as RequestRow[],
    };
  }));

  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/app" className="brand"><span className="mark">i</span><span>iDIABA</span></Link>
        <nav className="app-actions" aria-label="Navigation principale">
          <Link href="/app">Tableau de bord</Link><Link href="/app/pos">Caisse</Link><Link href="/app/stock">Stocks</Link>
        </nav>
      </header>
      <section className="workspace">
        <p className="eyebrow">GESTION SAAS</p>
        <h1>Abonnements & limites</h1>
        <p className="lead">Suivez votre formule, vos volumes et les demandes de changement pour chaque entreprise.</p>
        {params.requested && <p className="form-success" role="status">Votre demande a été envoyée. Elle sera traitée par l'équipe iDIABA.</p>}
        {params.error && <p className="form-error" role="alert">{params.error === "request" ? "Impossible d'envoyer la demande. Vérifiez qu'aucune autre demande n'est déjà en attente." : "Informations de demande invalides."}</p>}
        {!panels.length && <p className="catalog-empty">Seuls les propriétaires et administrateurs peuvent consulter les abonnements des entreprises.</p>}
        {panels.map((panel) => (
          <section className="subscription-card" key={panel.tenantId}>
            <div className="subscription-header">
              <div><p className="eyebrow">ENTREPRISE</p><h2>{panel.tenantName}</h2></div>
              <span className="subscription-status">{panel.subscription ? statusLabel(panel.subscription.status) : "Non configuré"}</span>
            </div>
            {panel.plan ? <>
              <div className="subscription-current">
                <div><span>Formule actuelle</span><strong>{panel.plan.name}</strong><small>{panel.plan.description}</small></div>
                <div><span>Prix indicatif</span><strong>{formatPrice(panel.plan.price_monthly_fcfa)} / mois</strong><small>{panel.subscription?.status === "trialing" && panel.subscription.trial_ends_at ? "Fin de l'essai : " + new Date(panel.subscription.trial_ends_at).toLocaleDateString("fr-FR") : panel.subscription?.current_period_ends_at ? "Fin de période : " + new Date(panel.subscription.current_period_ends_at).toLocaleDateString("fr-FR") : "Période non renseignée"}</small></div>
              </div>
              <div className="subscription-usage">
                <div><span>Utilisateurs</span><strong>{panel.usage.users} / {formatLimit(panel.plan.max_users, "comptes")}</strong></div>
                <div><span>Dépôts</span><strong>{panel.usage.locations} / {formatLimit(panel.plan.max_locations, "dépôts")}</strong></div>
                <div><span>Produits actifs</span><strong>{panel.usage.products} / {formatLimit(panel.plan.max_products, "produits")}</strong></div>
                <div><span>Ventes ce mois</span><strong>{panel.usage.sales} / {formatLimit(panel.plan.max_monthly_sales, "ventes")}</strong></div>
              </div>
            </> : <p className="form-error">Aucun abonnement n'est associé à cette entreprise. Contactez le support.</p>}
            <details className="subscription-request">
              <summary>Demander une autre formule</summary>
              <form action={requestSubscriptionChange}>
                <input type="hidden" name="tenant_id" value={panel.tenantId} />
                <div className="subscription-form-grid">
                  <label>Formule souhaitée<select name="plan_code" required defaultValue="starter">{availablePlans.filter((plan) => plan.code !== "trial").map((plan) => <option value={plan.code} key={plan.id}>{plan.name} · {formatPrice(plan.price_monthly_fcfa)} / mois</option>)}</select></label>
                  <label>Facturation<select name="billing_interval" defaultValue="monthly"><option value="monthly">Mensuelle</option><option value="yearly">Annuelle</option></select></label>
                  <label>Moyen de paiement<select name="payment_method" defaultValue="wave"><option value="wave">Wave</option><option value="orange_money">Orange Money</option><option value="bank_transfer">Virement bancaire</option><option value="cash">Espèces</option><option value="other">Autre</option></select></label>
                  <label>Référence de paiement (facultatif)<input name="payment_reference" maxLength={160} placeholder="Référence de transaction" /></label>
                </div>
                <p className="catalog-help">Les tarifs des formules payantes restent à configurer. Cette demande ne déclenche aucun prélèvement ni activation automatique.</p>
                <button className="primary" type="submit">Envoyer la demande</button>
              </form>
            </details>
            {panel.requests.length > 0 && <div className="subscription-history"><h3>Demandes récentes</h3>{panel.requests.map((request) => <div key={request.id}><span>{request.plan?.name ?? "Formule"} · {new Date(request.created_at).toLocaleDateString("fr-FR")}</span><strong>{request.status === "pending" ? "En attente" : request.status === "approved" ? "Acceptée" : request.status === "rejected" ? "Refusée" : "Annulée"}</strong></div>)}</div>}
          </section>
        ))}
        <p className="catalog-help">L'essai dure 14 jours. Les formules payantes et leurs tarifs devront être configurés avant l'ouverture commerciale. Les limites sont contrôlées directement dans la base de données.</p>
      </section>
    </main>
  );
}
