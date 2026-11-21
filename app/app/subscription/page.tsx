import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { startSubscriptionPayment } from "./actions";

export const dynamic = "force-dynamic";

type Relation<T> = T | T[] | null;
type Membership = { tenant_id: string; role: string; tenant: Relation<{ id: string; name: string }> };
type Plan = {
  id: string; code: string; name: string; description: string;
  price_monthly_fcfa: number | string | null; price_yearly_fcfa: number | string | null;
  max_users: number | null; max_locations: number | null; max_products: number | null; max_monthly_sales: number | null;
};
type Subscription = {
  status: string; billing_interval: string; trial_ends_at: string | null; current_period_ends_at: string | null;
  plan: Plan | Plan[] | null;
};
type RequestRow = { id: string; status: string; payment_method: string; payment_reference: string; created_at: string; plan: Relation<{ name: string }> };
type PaymentRow = { id: string; provider: string; status: string; amount_fcfa: number | string; created_at: string; paid_at: string | null; provider_transaction_id: string | null };
function one<T>(value: Relation<T>): T | null { return Array.isArray(value) ? value[0] ?? null : value; }

function formatLimit(value: number | null, unit: string) {
  return value === null ? "Illimité" : value.toLocaleString("fr-FR") + " " + unit;
}
function formatPrice(value: number | string | null) {
  if (value === null) return "Tarif à définir";
  return Number(value) === 0 ? "Gratuit" : Number(value).toLocaleString("fr-FR") + " FCFA";
}
function statusLabel(status: string, trialEndsAt: string | null) {
  if (status === "trialing" && trialEndsAt && new Date(trialEndsAt).getTime() <= Date.now()) return "Essai expiré";
  return ({ trialing: "Essai en cours", active: "Actif", past_due: "Paiement en attente", suspended: "Suspendu", canceled: "Résilié", expired: "Expiré" } as Record<string, string>)[status] ?? status;
}

export default async function SubscriptionPage({ searchParams }: { searchParams: Promise<{ error?: string; requested?: string; method?: string; payment?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase.from("tenant_memberships")
    .select("tenant_id,role,tenant:tenants(id,name)").eq("user_id", user.id);
  const workspaces = ((memberships ?? []) as unknown as Membership[])
    .map((item) => ({ ...item, tenant: one(item.tenant) }))
    .filter((item) => item.tenant && ["owner", "admin"].includes(item.role));

  const { data: plans } = await supabase.from("subscription_plans")
    .select("id,code,name,description,price_monthly_fcfa,price_yearly_fcfa,max_users,max_locations,max_products,max_monthly_sales")
    .eq("is_active", true).order("price_monthly_fcfa", { ascending: true, nullsFirst: false });
  const availablePlans = (plans ?? []) as Plan[];

  const panels = await Promise.all(workspaces.map(async (workspace) => {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
    const [subResult, products, locations, users, sales, requests, payments] = await Promise.all([
      supabase.from("tenant_subscriptions").select("status,billing_interval,trial_ends_at,current_period_ends_at,plan:subscription_plans(id,code,name,description,price_monthly_fcfa,price_yearly_fcfa,max_users,max_locations,max_products,max_monthly_sales)").eq("tenant_id", workspace.tenant_id).maybeSingle(),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("tenant_id", workspace.tenant_id).eq("is_active", true),
      supabase.from("stock_locations").select("id", { count: "exact", head: true }).eq("tenant_id", workspace.tenant_id).eq("is_active", true),
      supabase.from("tenant_memberships").select("id", { count: "exact", head: true }).eq("tenant_id", workspace.tenant_id),
      supabase.from("sales").select("id", { count: "exact", head: true }).eq("tenant_id", workspace.tenant_id).eq("status", "completed").gte("created_at", monthStart).lt("created_at", nextMonth),
      supabase.from("subscription_requests").select("id,status,payment_method,payment_reference,created_at,plan:subscription_plans(name)").eq("tenant_id", workspace.tenant_id).order("created_at", { ascending: false }).limit(5),
      supabase.from("subscription_payments").select("id,provider,status,amount_fcfa,created_at,paid_at,provider_transaction_id").eq("tenant_id", workspace.tenant_id).order("created_at", { ascending: false }).limit(5),
    ]);
    const subscription = subResult.data as unknown as Subscription | null;
    const plan = Array.isArray(subscription?.plan) ? subscription.plan[0] : subscription?.plan;
    return {
      tenantId: workspace.tenant_id, tenantName: workspace.tenant!.name, role: workspace.role,
      subscription, plan,
      usage: { products: products.count ?? 0, locations: locations.count ?? 0, users: users.count ?? 0, sales: sales.count ?? 0 },
      requests: (requests.data ?? []) as unknown as RequestRow[],
      payments: (payments.data ?? []) as unknown as PaymentRow[],
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
        {params.requested && <p className="form-success" role="status">{params.method === "orange_money" ? "Votre demande Orange Money a été envoyée. La validation sera effectuée après contrôle de la transaction." : "Votre demande a été envoyée à l&apos;équipe iDIABA."}</p>}
        {params.payment === "processing" && <p className="form-success" role="status">Retour depuis Wave reçu. L&apos;abonnement sera activé uniquement après confirmation sécurisée du paiement.</p>}
        {params.payment === "failed" && <p className="form-error" role="alert">Le paiement Wave n&apos;a pas abouti. Vous pouvez réessayer.</p>}
        {params.error && <p className="form-error" role="alert">{params.error === "request" ? "Impossible d'envoyer la demande. Vérifiez qu'aucune autre demande n'est déjà en attente." : params.error === "wave_unconfigured" ? "Le paiement Wave n'est pas encore configuré. L'administrateur doit ajouter les clés API sécurisées." : params.error === "wave_unavailable" ? "Wave est momentanément indisponible. Aucun abonnement n'a été activé." : params.error === "payment_request" ? "Impossible de préparer le paiement. Vérifiez le tarif de la formule." : params.error === "orange_reference" ? "Saisissez la référence de votre paiement Orange Money pour permettre sa vérification." : "Informations de demande invalides."}</p>}
        {!panels.length && <p className="catalog-empty">Seuls les propriétaires et administrateurs peuvent consulter les abonnements des entreprises.</p>}
        {panels.map((panel) => (
          <section className="subscription-card" key={panel.tenantId}>
            <div className="subscription-header">
              <div><p className="eyebrow">ENTREPRISE</p><h2>{panel.tenantName}</h2></div>
              <span className="subscription-status">{panel.subscription ? statusLabel(panel.subscription.status, panel.subscription.trial_ends_at) : "Non configuré"}</span>
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
            </> : <p className="form-error">Aucun abonnement n&apos;est associé à cette entreprise. Contactez le support.</p>}
            <details className="subscription-request">
              <summary>Demander une autre formule</summary>
              <form action={startSubscriptionPayment}>
                <input type="hidden" name="tenant_id" value={panel.tenantId} />
                <div className="subscription-form-grid">
                  <label>Formule souhaitée<select name="plan_code" required defaultValue="starter">{availablePlans.filter((plan) => plan.code !== "trial" && plan.code !== panel.plan?.code).map((plan) => <option value={plan.code} key={plan.id}>{plan.name} · {formatPrice(plan.price_monthly_fcfa)} / mois</option>)}</select></label>
                  <label>Facturation<select name="billing_interval" defaultValue="monthly"><option value="monthly">Mensuelle</option><option value="yearly">Annuelle</option></select></label>
                  <label>Moyen de paiement<select name="payment_method" defaultValue="wave"><option value="wave">Wave · paiement en ligne</option><option value="orange_money">Orange Money · validation manuelle</option></select></label>
                  <label>Référence Orange Money (obligatoire si ce moyen est choisi)<input name="payment_reference" maxLength={160} placeholder="Référence après paiement" /></label>
                </div>
                <p className="catalog-help">Wave ouvre une page de paiement sécurisée. L&apos;abonnement est activé uniquement après confirmation serveur du paiement. Orange Money reste en validation manuelle tant que l&apos;accès marchand/API Orange n&apos;est pas configuré.</p>
                <button className="primary" type="submit">Envoyer la demande</button>
              </form>
            </details>
            {panel.payments.length > 0 && <div className="subscription-history"><h3>Paiements en ligne</h3>{panel.payments.map((payment) => <div key={payment.id}><span>{payment.provider === "wave" ? "Wave" : "Orange Money"} · {Number(payment.amount_fcfa).toLocaleString("fr-FR")} FCFA · {new Date(payment.created_at).toLocaleDateString("fr-FR")}</span><strong>{payment.status === "paid" ? "Payé" : payment.status === "processing" ? "En cours" : payment.status === "failed" ? "Échoué" : payment.status === "expired" ? "Expiré" : "En attente"}</strong></div>)}</div>}
            {panel.requests.length > 0 && <div className="subscription-history"><h3>Demandes récentes</h3>{panel.requests.map((request) => <div key={request.id}><span>{one(request.plan)?.name ?? "Formule"} · {request.payment_method === "orange_money" ? "Orange Money" : request.payment_method === "wave" ? "Wave" : request.payment_method} · {new Date(request.created_at).toLocaleDateString("fr-FR")}</span><strong>{request.status === "pending" ? "En attente" : request.status === "approved" ? "Acceptée" : request.status === "rejected" ? "Refusée" : "Annulée"}</strong></div>)}</div>}
          </section>
        ))}
        <p className="catalog-help">L&apos;essai dure 14 jours. Les formules payantes et leurs tarifs devront être configurés avant l&apos;ouverture commerciale. Les limites sont contrôlées directement dans la base de données.</p>
      </section>
    </main>
  );
}
