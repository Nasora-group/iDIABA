import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowUpRight, BarChart3, Boxes, ClipboardList, CreditCard,
  Package, ShoppingCart, Users, Warehouse, Settings2, FileText, ShieldCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Membership = {
  tenant_id: string;
  role: string;
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

const coreModules = [
  { title: "Caisse et ventes", description: "Encaisser, imprimer les tickets et suivre les ventes.", href: "/app/pos", action: "Ouvrir la caisse", icon: CreditCard },
  { title: "Catalogue", description: "Produits, services, catégories, références et tarifs.", href: "/app/products", action: "Gérer le catalogue", icon: Package },
  { title: "Stocks", description: "Disponibilités, mouvements et seuils de réapprovisionnement.", href: "/app/stock", action: "Voir les stocks", icon: Boxes },
  { title: "Achats", description: "Fournisseurs, commandes et réceptions.", href: "/app/purchasing", action: "Gérer les achats", icon: ShoppingCart },
  { title: "Clients", description: "Fiches clients, historique et retours.", href: "/app/customers", action: "Voir les clients", icon: Users },
  { title: "Rapports", description: "Chiffre d’affaires, marges et activité commerciale.", href: "/app/reports", action: "Consulter les rapports", icon: BarChart3 },
];

const managementModules = [
  { title: "Inventaires", description: "Comptages et ajustements contrôlés.", href: "/app/inventory", action: "Gérer", icon: ClipboardList },
  { title: "Boutiques et dépôts", description: "Organiser plusieurs établissements.", href: "/app/locations", action: "Gérer", icon: Warehouse },
  { title: "Transferts", description: "Déplacer les marchandises entre sites.", href: "/app/transfers", action: "Gérer", icon: Boxes },
  { title: "Factures fournisseurs", description: "Échéances et règlements.", href: "/app/supplier-invoices", action: "Suivre", icon: FileText },
  { title: "Comptabilité", description: "Dépenses, écritures et balance.", href: "/app/accounting", action: "Consulter", icon: BarChart3 },
  { title: "Équipe", description: "Utilisateurs, rôles et autorisations.", href: "/app/team", action: "Gérer", icon: Users },
  { title: "Paramètres", description: "Secteur, modules, identité et fiscalité.", href: "/app/company-settings", action: "Configurer", icon: Settings2 },
];

export default async function AppHome() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase.from("tenant_memberships")
    .select("tenant_id,role,tenant:tenants(id,name,slug)")
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
  const canViewAudit = memberships.some((membership) => ["owner", "admin"].includes(membership.role));

  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/app" className="brand"><span className="mark">i</span><span>iDIABA</span></Link>
        <nav className="app-actions" aria-label="Navigation principale">
          <Link href="/app/pos">Caisse</Link>
          <Link href="/app/products">Catalogue</Link>
          <Link href="/app/stock">Stocks</Link>
          <Link href="/app/reports">Rapports</Link>
          <Link href="/app/company-settings">Configuration</Link>
          {user.app_metadata?.role === "platform_admin" && <Link href="/app/platform-admin">Administration SaaS</Link>}
          <form action="/auth/signout" method="post"><button className="secondary">Déconnexion</button></form>
        </nav>
      </header>

      <section className="workspace">
        <div className="app-welcome">
          <div>
            <p className="eyebrow">VOTRE GESTION COMMERCIALE</p>
            <h1>Bonjour{displayName ? `, ${displayName}` : ""} 👋</h1>
            <p className="lead">Toutes les opérations de votre commerce dans un seul espace, sur ordinateur comme sur téléphone.</p>
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
          <div><p className="eyebrow">OPÉRATIONS QUOTIDIENNES</p><h2>Accès rapide</h2></div>
          <p>Les outils essentiels pour gérer votre activité.</p>
        </div>
        <div className="app-module-grid">
          {coreModules.map(({ title, description, href, action, icon: Icon }) => (
            <Link href={href} className="app-module-card" key={title}>
              <span className="app-module-icon"><Icon size={20} strokeWidth={1.9} /></span>
              <div><strong>{title}</strong><p>{description}</p></div>
              <span className="app-module-link">{action}<ArrowUpRight size={15} /></span>
            </Link>
          ))}
        </div>

        <div className="app-section-heading">
          <div><p className="eyebrow">GESTION ET ADMINISTRATION</p><h2>Autres outils</h2></div>
          <p>Activez et configurez les fonctions adaptées à votre organisation.</p>
        </div>
        <div className="app-module-grid">
          {managementModules.map(({ title, description, href, action, icon: Icon }) => (
            <Link href={href} className="app-module-card" key={title}>
              <span className="app-module-icon"><Icon size={20} strokeWidth={1.9} /></span>
              <div><strong>{title}</strong><p>{description}</p></div>
              <span className="app-module-link">{action}<ArrowUpRight size={15} /></span>
            </Link>
          ))}
          {canViewAudit && <Link href="/app/audit" className="app-module-card"><span className="app-module-icon"><ShieldCheck size={20} /></span><div><strong>Journal d’audit</strong><p>Historique des opérations sensibles et des modifications.</p></div><span className="app-module-link">Consulter<ArrowUpRight size={15} /></span></Link>}
          {user.app_metadata?.role === "platform_admin" && <Link href="/app/platform-admin" className="app-module-card"><span className="app-module-icon"><CreditCard size={20} /></span><div><strong>Administration SaaS</strong><p>Abonnements, formules, quotas et entreprises.</p></div><span className="app-module-link">Ouvrir<ArrowUpRight size={15} /></span></Link>}
        </div>

        <div className="app-section-heading">
          <div><p className="eyebrow">ORGANISATION</p><h2>Vos entreprises</h2></div>
          <p>{memberships.length} espace(s) associé(s) à votre compte</p>
        </div>
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
      </section>
    </main>
  );
}
