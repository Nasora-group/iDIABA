"use server";

import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { updateSubscriptionPlan, reviewSubscriptionRequest } from "./actions";

export const dynamic = "force-dynamic";

type Plan = {
  id: string; code: string; name: string; description: string;
  price_monthly_fcfa: number | string | null; price_yearly_fcfa: number | string | null;
  max_users: number | null; max_locations: number | null; max_products: number | null; max_monthly_sales: number | null;
};
type Relation<T> = T | T[] | null;
type RequestRow = {
  id: string; tenant_id: string; billing_interval: string; payment_method: string;
  payment_reference: string; created_at: string; status: string;
  tenant: Relation<{ name: string }>; plan: Relation<{ name: string; code: string }>;
};
type PaymentRow = { id: string; subscription_request_id: string; provider: string; status: string; amount_fcfa: number | string; provider_transaction_id: string | null; paid_at: string | null };
type SubscriptionRow = {
  tenant_id: string; status: string;
  tenant: Relation<{ name: string }>; plan: Relation<{ name: string }>;
};
function one<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}
function value(value: number | string | null) { return value === null ? "" : String(value); }
function price(value: number | string | null) { return value === null ? "Non défini" : Number(value).toLocaleString("fr-FR") + " FCFA"; }
function money(value: number | string) { return Number(value).toLocaleString("fr-FR") + " FCFA"; }
function date(value: string) { return new Date(value).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }); }
function statusLabel(status: string) {
  if (status === "active") return "Actif";
  if (status === "trialing") return "Essai";
  if (status === "past_due") return "À régulariser";
  if (status === "canceled") return "Résilié";
  if (status === "pending") return "En attente";
  return status;
}

export default async function PlatformAdminPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; reviewed?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (user.app_metadata?.role !== "platform_admin") redirect("/app");

  const [plansResult, requestsResult, subscriptionsResult, paymentsResult] = await Promise.all([
    supabase.from("subscription_plans").select("id,code,name,description,price_monthly_fcfa,price_yearly_fcfa,max_users,max_locations,max_products,max_monthly_sales").order("code"),
    supabase.from("subscription_requests").select("id,tenant_id,billing_interval,payment_method,payment_reference,created_at,status,tenant:tenants(name),plan:subscription_plans(name,code)").order("created_at", { ascending: false }).limit(100),
    supabase.from("tenant_subscriptions").select("tenant_id,status,plan:subscription_plans(name),tenant:tenants(name)").order("created_at", { ascending: false }).limit(100),
    supabase.from("subscription_payments").select("id,subscription_request_id,provider,status,amount_fcfa,provider_transaction_id,paid_at").order("created_at", { ascending: false }).limit(200),
  ]);
  const plans = (plansResult.data ?? []) as unknown as Plan[];
  const requests = (requestsResult.data ?? []) as unknown as RequestRow[];
  const subscriptions = (subscriptionsResult.data ?? []) as unknown as SubscriptionRow[];
  const payments = (paymentsResult.data ?? []) as unknown as PaymentRow[];
  const pendingCount = requests.filter((request) => request.status === "pending").length;
  const activeCount = subscriptions.filter((subscription) => subscription.status === "active").length;
  const paidPayments = payments.filter((payment) => payment.status === "paid");
  const paidTotal = paidPayments.reduce((sum, payment) => sum + Number(payment.amount_fcfa || 0), 0);
  const displayName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "Administrateur";

  return (
    <main className="shell platform-shell">
      <header className="topbar platform-topbar">
        <Link href="/app" className="brand"><span className="mark">i</span><span>iDIABA <small>ADMIN</small></span></Link>
        <nav className="app-actions" aria-label="Navigation administration">
          <a href="#overview">Vue d’ensemble</a><a href="#requests">Demandes</a><a href="#tenants">Entreprises</a><a href="#plans">Formules</a>
          <Link href="/app">Espace commerce</Link>
          <form action="/auth/signout" method="post"><button className="secondary">Déconnexion</button></form>
        </nav>
      </header>

      <section className="workspace platform-workspace">
        <div className="platform-hero">
          <div>
            <p className="eyebrow">PILOTAGE DE LA PLATEFORME</p>
            <h1>Bonjour{displayName !== "Administrateur" ? `, ${displayName}` : ""}</h1>
            <p className="lead">Suivez les entreprises, les abonnements et les paiements depuis votre espace d’administration iDIABA.</p>
          </div>
          <div className="platform-hero-aside"><span className="platform-live-dot" /> Console sécurisée <small>Accès Super Admin</small></div>
        </div>

        {params.saved && <p className="form-success" role="status">Formule mise à jour.</p>}
        {params.reviewed && <p className="form-success" role="status">Demande traitée.</p>}
        {params.error && <p className="form-error" role="alert">{params.error === "review" ? "Impossible de traiter cette demande. Vérifiez son état et le tarif de la formule." : "Les informations saisies sont invalides ou n'ont pas pu être enregistrées."}</p>}

        <section id="overview" className="platform-overview">
          <div className="platform-section-title"><div><p className="eyebrow">INDICATEURS CLÉS</p><h2>Vue d’ensemble</h2></div><span>Données récentes chargées</span></div>
          <div className="platform-kpi-grid">
            <article className="platform-kpi"><span>Formules configurées</span><strong>{plans.length}</strong><small>Offres disponibles dans le catalogue</small></article>
            <article className="platform-kpi"><span>Demandes à traiter</span><strong>{pendingCount}</strong><small>Sur les 100 dernières demandes</small></article>
            <article className="platform-kpi"><span>Abonnements actifs</span><strong>{activeCount}</strong><small>Sur les 100 derniers abonnements</small></article>
            <article className="platform-kpi"><span>Paiements confirmés</span><strong>{money(paidTotal)}</strong><small>{paidPayments.length} paiements sur les 200 derniers</small></article>
          </div>
        </section>

        <section id="requests" className="platform-admin-section">
          <div className="platform-section-title"><div><p className="eyebrow">VALIDATION COMMERCIALE</p><h2>Demandes de souscription</h2></div><span>{pendingCount} en attente</span></div>
          {requests.length ? <div className="platform-request-list">{requests.map((request) => {
            const tenant = one(request.tenant);
            const plan = one(request.plan);
            const requestPayments = payments.filter((payment) => payment.subscription_request_id === request.id);
            return <article className="platform-request-card" key={request.id}>
              <div className="platform-request-header"><div><strong>{tenant?.name ?? "Entreprise"}</strong><span>{plan?.name ?? "Formule"} · {request.billing_interval === "monthly" ? "Mensuel" : "Annuel"}</span></div><span className={"subscription-status " + (request.status === "pending" ? "pending" : "")}>{request.status === "pending" ? "En attente" : request.status === "approved" ? "Acceptée" : request.status === "rejected" ? "Refusée" : "Annulée"}</span></div>
              <div className="platform-request-meta"><span>Moyen de paiement <strong>{request.payment_method === "orange_money" ? "Orange Money" : request.payment_method === "wave" ? "Wave" : request.payment_method}</strong></span><span>Référence <strong>{request.payment_reference || "Non renseignée"}</strong></span><span>Reçue <strong>{date(request.created_at)}</strong></span></div>
              {requestPayments.map((payment) => <p className="platform-payment-line" key={payment.id}>Paiement : <strong>{money(payment.amount_fcfa)}</strong> · {payment.status === "paid" ? "Confirmé" : payment.status === "processing" ? "En cours" : payment.status === "failed" ? "Échoué" : "En attente"}{payment.provider_transaction_id ? " · Transaction " + payment.provider_transaction_id : ""}</p>)}
              {request.status === "pending" && <form action={reviewSubscriptionRequest} className="platform-review-form">
                <input type="hidden" name="request_id" value={request.id} />
                <label>Note interne<input name="admin_note" maxLength={500} placeholder="Contrôle du paiement, motif du refus…" /></label>
                <div>{request.payment_method !== "wave" && <button className="primary" name="decision" value="approve" type="submit">Valider et activer</button>}<button className="secondary" name="decision" value="reject" type="submit">Refuser la demande</button></div>
              </form>}
            </article>;
          })}</div> : <div className="platform-empty"><strong>Aucune demande pour le moment</strong><span>Les nouvelles demandes de souscription apparaîtront ici.</span></div>}
        </section>

        <section id="tenants" className="platform-admin-section">
          <div className="platform-section-title"><div><p className="eyebrow">ÉCOSYSTÈME IDIABA</p><h2>Entreprises et abonnements</h2></div><span>{subscriptions.length} espaces récents</span></div>
          {subscriptions.length ? <div className="platform-tenant-table-wrap"><table className="platform-tenant-table"><thead><tr><th>Entreprise</th><th>Formule</th><th>État</th></tr></thead><tbody>{subscriptions.map((subscription) => {
            const tenant = one(subscription.tenant);
            const plan = one(subscription.plan);
            return <tr key={subscription.tenant_id}><td><strong>{tenant?.name ?? "Entreprise"}</strong><small>ID : {subscription.tenant_id.slice(0, 8)}…</small></td><td>{plan?.name ?? "Sans formule"}</td><td><span className={"platform-state " + (subscription.status === "active" ? "is-active" : "")}>{statusLabel(subscription.status)}</span></td></tr>;
          })}</tbody></table></div> : <div className="platform-empty"><strong>Aucun abonnement enregistré</strong><span>Les espaces abonnés apparaîtront dans ce tableau.</span></div>}
        </section>

        <section id="plans" className="platform-admin-section">
          <div className="platform-section-title"><div><p className="eyebrow">OFFRES COMMERCIALES</p><h2>Formules et tarifs</h2></div><span>{plans.length} formules</span></div>
          <p className="catalog-help">Les tarifs sont en FCFA. Laissez une limite vide pour indiquer une capacité illimitée. Les prix doivent être renseignés avant de pouvoir approuver un abonnement payant.</p>
          <div className="platform-plan-grid">
            {plans.map((plan) => <form action={updateSubscriptionPlan} className="platform-plan-card" key={plan.id}>
              <input type="hidden" name="id" value={plan.id} />
              <div className="platform-plan-heading"><strong>{plan.name}</strong><span>{plan.code}</span></div>
              <label>Nom<input name="name" defaultValue={plan.name} required maxLength={80} /></label>
              <label>Description<input name="description" defaultValue={plan.description} maxLength={240} /></label>
              <div className="platform-form-grid">
                <label>Prix mensuel<input type="number" name="price_monthly_fcfa" min="0" step="1" defaultValue={value(plan.price_monthly_fcfa)} placeholder="FCFA" /></label>
                <label>Prix annuel<input type="number" name="price_yearly_fcfa" min="0" step="1" defaultValue={value(plan.price_yearly_fcfa)} placeholder="FCFA" /></label>
                <label>Utilisateurs<input type="number" name="max_users" min="1" step="1" defaultValue={value(plan.max_users)} placeholder="Illimité" /></label>
                <label>Dépôts<input type="number" name="max_locations" min="1" step="1" defaultValue={value(plan.max_locations)} placeholder="Illimité" /></label>
                <label>Produits<input type="number" name="max_products" min="1" step="1" defaultValue={value(plan.max_products)} placeholder="Illimité" /></label>
                <label>Ventes / mois<input type="number" name="max_monthly_sales" min="1" step="1" defaultValue={value(plan.max_monthly_sales)} placeholder="Illimité" /></label>
              </div>
              <p className="catalog-help">Actuel : {price(plan.price_monthly_fcfa)} / mois · {price(plan.price_yearly_fcfa)} / an</p>
              <button className="secondary" type="submit">Enregistrer la formule</button>
            </form>)}
          </div>
        </section>
      </section>
    </main>
  );
}
