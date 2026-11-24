import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowUpRight, BarChart3, Boxes, CreditCard, Package, Users, Settings2, ShieldCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Membership = {
  tenant_id: string;
  role: string;
  custom_role_profile_id?: string | null;
  tenant: { id: string; name: string; slug: string } | null;
};
type BusinessProfile = { tenant_id: string; business_type: string; enabled_modules: string[] };

const sectorNames: Record<string, string> = {
  general: "Commerce général", grocery: "Alimentation et supermarché",
  hardware: "Quincaillerie et matériaux", fashion: "Mode et habillement",
  pharmacy: "Pharmacie et parapharmacie", restaurant: "Restauration",
  auto_parts: "Pièces détachées et automobile", electronics: "Électronique et informatique",
  beauty: "Beauté et cosmétiques", wholesale: "Grossiste et distribution",
  services: "Prestations de services", other: "Autre activité",
};

const companyModules: { title: string; description: string; href: string; action: string; icon: typeof CreditCard; access?: string[]; adminOnly?: boolean; secondaryHref?: string; secondaryLabel?: string }[] = [
  { title: "Caisse", description: "Scanner, rechercher, vendre et encaisser.", href: "/app/pos", action: "Ouvrir la caisse", icon: CreditCard, access: ["cash_register"] },
  { title: "Ventes", description: "Retrouver les ventes et les tickets depuis la caisse.", href: "/app/sales", action: "Voir les ventes", icon: BarChart3, access: ["sales_read", "sales_manage"] },
  { title: "Produits & Stocks", description: "Catalogue, quantités, mouvements et inventaires.", href: "/app/products", secondaryHref: "/app/stock", secondaryLabel: "Ouvrir les stocks", action: "Gérer les produits", icon: Package, access: ["products_read", "products_manage", "stock_read", "stock_manage"] },
  { title: "Approvisionnement", description: "Fournisseurs, commandes et réceptions.", href: "/app/purchasing", action: "Gérer les achats", icon: Boxes, access: ["purchasing_read", "purchasing_manage"] },
  { title: "Rapports", description: "Chiffre d’affaires, marges et activité.", href: "/app/reports", action: "Consulter", icon: BarChart3, access: ["reports_read", "accounting_read"] },
  { title: "Personnel", description: "Employés, profils personnalisés et accès.", href: "/app/team", action: "Gérer", icon: Users, adminOnly: true },
  { title: "Paramètres", description: "Configuration de votre entreprise.", href: "/app/company-settings", action: "Configurer", icon: Settings2, adminOnly: true },
];
 
export default async function AppHome() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (user.app_metadata?.role === "platform_admin") redirect("/app/platform-admin");

  const { data, error } = await supabase.from("tenant_memberships")
    .select("tenant_id,role,custom_role_profile_id,tenant:tenants(id,name,slug)")
    .eq("user_id", user.id);
  if (error) {
    return <main className="shell"><h1>Votre espace</h1><p className="form-error">Impossible de charger vos entreprises. Réessayez dans quelques instants.</p></main>;
  }

  const memberships = (data ?? []) as unknown as Membership[];
  const tenantIds = memberships.map((membership) => membership.tenant_id);
  const { data: profileData } = tenantIds.length
    ? await supabase.from("tenant_business_profiles").select("tenant_id,business_type,enabled_modules").in("tenant_id", tenantIds)
    : { data: [] as BusinessProfile[] };
  const profiles = new Map(((profileData ?? []) as BusinessProfile[]).map((profile) => [profile.tenant_id, profile]));
  const firstTenant = memberships.find((membership) => membership.tenant);
  const firstProfile = firstTenant ? profiles.get(firstTenant.tenant_id) : undefined;
  const displayName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "";
  const profileIds = memberships.map((membership) => membership.custom_role_profile_id).filter((id): id is string => Boolean(id));
  const { data: customProfiles } = profileIds.length
    ? await supabase.from("tenant_role_profiles").select("id,permissions,allowed_roles").in("id", profileIds)
    : { data: [] as { id: string; permissions: string[]; allowed_roles: string[] }[] };
  const accessByTenant = new Map<string, Set<string>>();
  const legacyPermissions: Record<string, string[]> = {
    manager: ["cash_register","cash_manage","sales_read","sales_manage","products_read","products_manage","stock_read","stock_manage","purchasing_read","purchasing_manage","reports_read","accounting_read","accounting_manage","audit_read"],
    cashier: ["cash_register","sales_read"],
    stock: ["products_read","products_manage","stock_read","stock_manage","purchasing_read","purchasing_manage"],
    accountant: ["purchasing_read","purchasing_manage","reports_read","accounting_read","accounting_manage"],
    viewer: ["sales_read","products_read","stock_read","purchasing_read","reports_read","accounting_read"],
  };
  const allPermissions = ["cash_register","cash_manage","sales_read","sales_manage","products_read","products_manage","stock_read","stock_manage","purchasing_read","purchasing_manage","reports_read","accounting_read","accounting_manage","team_manage","settings_manage","audit_read"];
  for (const membership of memberships) {
    const granted = new Set<string>();
    if (["owner", "admin"].includes(membership.role)) {
      allPermissions.forEach((permission) => granted.add(permission));
    } else if (membership.custom_role_profile_id) {
      const profile = customProfiles?.find((item) => item.id === membership.custom_role_profile_id);
      (profile?.permissions?.length ? profile.permissions : (profile?.allowed_roles ?? []).flatMap((role: string) => legacyPermissions[role] ?? []))
        .forEach((permission: string) => granted.add(permission));
    } else {
      (legacyPermissions[membership.role] ?? []).forEach((permission) => granted.add(permission));
    }
    accessByTenant.set(membership.tenant_id, granted);
  }


  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/app" className="brand"><span className="mark">i</span><span>iDIABA</span></Link>
        <nav className="app-actions" aria-label="Navigation principale">
          <Link href="/app/pos">Caisse</Link>
          {user.app_metadata?.role === "platform_admin" && <Link href="/app/platform-admin">Administration SaaS</Link>}
          <form action="/auth/signout" method="post"><button className="secondary">Déconnexion</button></form>
        </nav>
      </header>

      <section className="workspace">
        <div className="app-welcome">
          <div>
            <p className="eyebrow">VOTRE GESTION COMMERCIALE</p>
            <h1>Bonjour{displayName ? `, ${displayName}` : ""} 👋</h1>
            <p className="lead">Les essentiels de votre commerce, sans menus compliqués.</p>
          </div>
          <span className="welcome-chip"><span aria-hidden="true">●</span> Espace sécurisé</span>
        </div>

        {firstTenant?.tenant && (
          <div className="business-context">
            <div><span className="eyebrow">COMMERCE ACTIF</span><strong>{firstTenant.tenant.name}</strong></div>
            <span className="pill">{sectorNames[firstProfile?.business_type ?? "general"] ?? "Commerce général"}</span>
            <Link href="/app/company-settings">Modifier le profil <ArrowUpRight size={14} /></Link>
          </div>
        )}

        <div className="app-section-heading">
          <div><p className="eyebrow">VOTRE ENTREPRISE</p><h2>Les espaces essentiels</h2></div>
          <p>Chaque profil voit uniquement les espaces correspondant à ses accès.</p>
        </div>
        <div className="app-module-grid">
          {memberships.filter((membership) => membership.tenant).map((membership) => {
            const grantedAccess = accessByTenant.get(membership.tenant_id) ?? new Set<string>();
            const canManageCompany = ["owner", "admin"].includes(membership.role);
            const visibleModules = companyModules.filter((module) => module.adminOnly ? canManageCompany : (module.access ?? []).some((role) => grantedAccess.has(role)));
            return (
              <section className="catalog-tenant" key={membership.tenant_id}>
                <div className="catalog-heading"><div><h2>{membership.tenant!.name}</h2><p>Espaces de cette entreprise</p></div><span className="pill">{membership.role}</span></div>
                <div className="app-module-grid">
                  {visibleModules.map(({ title, description, href, action, icon: Icon, secondaryHref, secondaryLabel }) => (
                    <article className="app-module-card" key={title}>
                      <Link href={href} className="app-module-main">
                        <span className="app-module-icon"><Icon size={20} strokeWidth={1.9} /></span>
                        <div><strong>{title}</strong><p>{description}</p></div>
                        <span className="app-module-link">{action}<ArrowUpRight size={15} /></span>
                      </Link>
                      {secondaryHref && <Link href={secondaryHref} className="app-module-secondary">{secondaryLabel} <ArrowUpRight size={13} /></Link>}
                    </article>
                  ))}
                  {(canManageCompany || grantedAccess.has("audit_read")) && <Link href="/app/audit" className="app-module-card"><span className="app-module-icon"><ShieldCheck size={20} /></span><div><strong>Journal d’audit</strong><p>Historique des opérations sensibles et des modifications.</p></div><span className="app-module-link">Consulter<ArrowUpRight size={15} /></span></Link>}
                </div>
                {!visibleModules.length && <p className="catalog-empty">Aucun espace n’est associé à ce profil. Contactez l’administrateur de l’entreprise.</p>}
              </section>
            );
          })}
        </div>

        <details className="workspace-list-details">
          <summary>Vos entreprises ({memberships.length})</summary>
          {memberships.length ? (
            <div className="workspace-list">
              {memberships.filter((membership) => membership.tenant).map((membership) => (
                <article key={membership.tenant!.id} className="workspace-item">
                  <div><strong>{membership.tenant!.name}</strong><small>{membership.tenant!.slug}</small></div>
                  <span className="role">{sectorNames[profiles.get(membership.tenant_id)?.business_type ?? "general"] ?? "Commerce général"} · {membership.role}</span>
                </article>
              ))}
            </div>
          ) : <p className="catalog-empty">Aucun espace entreprise n&apos;est encore associé à ce compte.</p>}
        </details>
      </section>
    </main>
  );
}
