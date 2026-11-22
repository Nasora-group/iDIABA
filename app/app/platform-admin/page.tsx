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

  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/app" className="brand"><span className="mark">i</span><span>iDIABA</span></Link>
        <nav className="app-actions"><Link href="/app">Tableau de bord</Link><Link href="/app/subscription">Abonnements</Link></nav>
      </header>
      <section className="workspace">
        <p className="eyebrow">ADMINISTRATION PLATEFORME</p>
        <h1>Console iDIABA</h1>
        <p className="lead">Configurez les formules et traitez les demandes de souscription après vérification des paiements reçus.</p>
        {params.saved && <p className="form-success" role="status">Formule mise à jour.</p>}
        {params.reviewed && <p className="form-success" role="status">Demande traitée.</p>}
        {params.error && <p className="form-error" role="alert">{params.error === "review" ? "Impossible de traiter cette demande. Vérifiez son état et le tarif de la formule." : "Les informations saisies sont invalides ou n'ont pas pu être enregistrées."}</p>}

        <section className="platform-admin-section">
          <h2>Formules et tarifs</h2>
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

        <section className="platform-admin-section">
          <h2>Demandes de souscription</h2>
          {requests.length ? <div className="platform-request-list">{requests.map((request) => {
            const tenant = one(request.tenant);
            const plan = one(request.plan);
            return <article className="platform-request-card" key={request.id}>
              <div className="platform-request-header"><div><strong>{tenant?.name ?? "Entreprise"}</strong><span>{plan?.name ?? "Formule"} · {request.billing_interval === "monthly" ? "Mensuel" : "Annuel"}</span></div><span className={"subscription-status " + (request.status === "pending" ? "pending" : "")}>{request.status === "pending" ? "En attente" : request.status === "approved" ? "Acceptée" : request.status === "rejected" ? "Refusée" : "Annulée"}</span></div>
              <p>Moyen : {request.payment_method === "orange_money" ? "Orange Money" : request.payment_method === "wave" ? "Wave" : request.payment_method} · Référence : {request.payment_reference || "Non renseignée"}</p>
              {payments.filter((payment) => payment.subscription_request_id === request.id).map((payment) => <p key={payment.id}>Paiement : {Number(payment.amount_fcfa).toLocaleString("fr-FR")} FCFA · {payment.status === "paid" ? "Confirmé" : payment.status === "processing" ? "En cours" : payment.status === "failed" ? "Échoué" : "En attente"}{payment.provider_transaction_id ? " · Transaction " + payment.provider_transaction_id : ""}</p>)}
              <small>Reçue le {new Date(request.created_at).toLocaleString("fr-FR")}</small>
              {request.status === "pending" && <form action={reviewSubscriptionRequest} className="platform-review-form">
                <input type="hidden" name="request_id" value={request.id} />
                <label>Note interne<input name="admin_note" maxLength={500} placeholder="Contrôle du paiement, motif du refus…" /></label>
                <div>{request.payment_method !== "wave" && <button className="primary" name="decision" value="approve" type="submit">Valider le paiement et activer</button>}<button className="secondary" name="decision" value="reject" type="submit">Refuser</button></div>
              </form>}
            </article>;
          })}</div> : <p className="catalog-empty">Aucune demande pour le moment.</p>}
        </section>

        <section className="platform-admin-section">
          <h2>Abonnements des entreprises</h2>
          <div className="platform-request-list">{subscriptions.map((sub) => { const tenant = one(sub.tenant); const plan = one(sub.plan); return <div className="platform-request-card" key={sub.tenant_id}><strong>{tenant?.name ?? sub.tenant_id}</strong><span>{plan?.name ?? "Sans formule"} · {sub.status}</span></div>; })}</div>
        </section>
      </section>
    </main>
  );
}
