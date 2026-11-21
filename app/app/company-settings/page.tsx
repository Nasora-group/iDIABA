import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updateCompanySettings } from "./actions";

type TenantSettings = {
  id: string; name: string; slug: string; logo_url: string | null; rccm: string; ninea: string;
  address: string; phone: string; currency_code: string; default_tax_rate: number | string;
};
type Membership = { tenant_id: string; role: string; tenant: TenantSettings | null };

export const dynamic = "force-dynamic";

export default async function CompanySettingsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data, error } = await supabase.from("tenant_memberships")
    .select("tenant_id,role,tenant:tenants(id,name,slug,logo_url,rccm,ninea,address,phone,currency_code,default_tax_rate)")
    .eq("user_id", user.id);
  if (error) return <main className="shell"><p className="form-error">Impossible de charger les paramètres de l’entreprise.</p></main>;
  const memberships = (data ?? []) as unknown as Membership[];
  const messages: Record<string, string> = {
    saved: "Paramètres enregistrés.",
    invalid: "Vérifiez les informations saisies. Le taux doit être compris entre 0 et 100 et la devise doit utiliser 3 lettres.",
    denied: "Modification refusée. Seuls le propriétaire et l’administrateur peuvent modifier ces informations.",
  };
  return (
    <main className="shell">
      <header className="topbar"><Link href="/app" className="brand"><span className="mark">i</span><span>iDIABA</span></Link><nav className="product-nav"><Link href="/app">Mon espace</Link><Link href="/app/stock">Stocks</Link><span>Paramètres entreprise</span></nav></header>
      <section className="workspace catalog-workspace">
        <p className="eyebrow">ORGANISATION · IDENTITÉ ET FISCALITÉ</p>
        <h1>Paramètres de l’entreprise</h1>
        <p className="lead">Renseignez les informations qui apparaîtront sur les documents commerciaux et serviront aux calculs de taxes par défaut.</p>
        {params.status && messages[params.status] && <p className={params.status === "saved" ? "form-success" : "form-error"}>{messages[params.status]}</p>}
        {memberships.map((membership) => {
          const tenant = membership.tenant;
          if (!tenant) return null;
          const canEdit = ["owner", "admin"].includes(membership.role);
          return (
            <section className="catalog-tenant" key={tenant.id}>
              <div className="catalog-heading"><div><h2>{tenant.name}</h2><p>{tenant.slug} · Rôle : {membership.role}</p></div><span className="pill">{canEdit ? "Administration" : "Lecture seule"}</span></div>
              <form action={updateCompanySettings} className="catalog-form">
                <input type="hidden" name="tenant_id" value={tenant.id} />
                <label>Nom de l’entreprise<input name="name" defaultValue={tenant.name} required minLength={2} maxLength={120} disabled={!canEdit} /></label>
                <div className="catalog-fields">
                  <label>RCCM<input name="rccm" defaultValue={tenant.rccm} maxLength={80} disabled={!canEdit} /></label>
                  <label>NINEA<input name="ninea" defaultValue={tenant.ninea} maxLength={80} disabled={!canEdit} /></label>
                </div>
                <label>Adresse<input name="address" defaultValue={tenant.address} maxLength={250} disabled={!canEdit} /></label>
                <label>Téléphone<input name="phone" defaultValue={tenant.phone} maxLength={40} disabled={!canEdit} /></label>
                <label>URL du logo (HTTPS)<input type="url" name="logo_url" defaultValue={tenant.logo_url ?? ""} placeholder="https://..." disabled={!canEdit} /></label>
                <div className="catalog-fields">
                  <label>Devise (code ISO)<input name="currency_code" defaultValue={tenant.currency_code} maxLength={3} pattern="[A-Za-z]{3}" required disabled={!canEdit} /></label>
                  <label>TVA par défaut (%)<input type="number" name="default_tax_rate" defaultValue={Number(tenant.default_tax_rate)} min="0" max="100" step="0.01" required disabled={!canEdit} /></label>
                </div>
                {canEdit && <button className="primary" type="submit">Enregistrer les paramètres</button>}
              </form>
            </section>
          );
        })}
      </section>
    </main>
  );
}
