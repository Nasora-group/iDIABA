import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, Boxes, Building2, ChartNoAxesCombined, ClipboardList, CreditCard, Package, ShoppingCart, ShieldCheck, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveTenantId } from "@/lib/tenant";
import { ROLE_LABELS } from "@/lib/tenant-labels";
import { canAccess, type ModuleKey } from "@/lib/permissions";
import { switchCompany } from "./company/actions";

export const dynamic = "force-dynamic";

type Relation<T> = T | T[] | null;
type Membership = {
  tenant_id: string;
  role: string;
  tenant: Relation<{ id: string; name: string; slug: string }>;
};

const modules = [
  { title: "Vue consolidée", description: "Chiffre d’affaires, dépenses et marge de toutes vos entreprises côte à côte.", key: "overview" as ModuleKey, href: "/app/overview", action: "Comparer mes entreprises", icon: ChartNoAxesCombined },
  { title: "Catalogue produits", description: "Références, catégories, prix et codes-barres.", key: "products" as ModuleKey, href: "/app/products", action: "Gérer les produits", icon: Package },
  { title: "Stocks & dépôts", description: "Stocks disponibles, dépôts et journal des mouvements.", key: "stock" as ModuleKey, href: "/app/stock", action: "Consulter les stocks", icon: Boxes },
  { title: "Caisse & ventes", description: "Encaissements, paiements multiples et clôture de caisse.", key: "pos" as ModuleKey, href: "/app/pos", action: "Ouvrir la caisse", icon: CreditCard },
  { title: "Achats & fournisseurs", description: "Commandes fournisseurs et réceptions de marchandises.", key: "purchasing" as ModuleKey, href: "/app/purchasing", action: "Gérer les achats", icon: ShoppingCart },
  { title: "Comptabilité", description: "Dépenses, écritures et balance comptable.", key: "accounting" as ModuleKey, href: "/app/accounting", action: "Voir la comptabilité", icon: ChartNoAxesCombined },
  { title: "Inventaires physiques", description: "Comptez les articles, contrôlez les écarts et ajustez le stock de façon tracée.", key: "inventory" as ModuleKey, href: "/app/inventory", action: "Gérer les inventaires", icon: ClipboardList },
  { title: "Clients & retours", description: "Fichier clients, historique des tickets, retours partiels et avoirs.", key: "customers" as ModuleKey, href: "/app/customers", action: "Gérer les clients", icon: Users },
  { title: "Entreprise & équipe", description: "Membres, rôles, invitations et informations de l’entreprise active.", key: "company" as ModuleKey, href: "/app/company", action: "Gérer l’équipe", icon: Building2 },
  { title: "Abonnements & limites", description: "Formules, volumes et demandes de changement par entreprise.", key: "subscription" as ModuleKey, href: "/app/subscription", action: "Gérer l’abonnement", icon: CreditCard },
];

export default async function AppHome({ searchParams }: { searchParams: Promise<{ company?: string; joined?: string; left?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, role, tenant:tenants(id,name,slug)")
    .eq("user_id", user.id);

  if (error) {
    return <main className="shell"><h1>Votre espace</h1><p className="form-error">Impossible de charger vos entreprises. Réessayez dans quelques instants.</p></main>;
  }

  const memberships = ((data ?? []) as unknown as Membership[])
    .map((membership) => ({ ...membership, tenant: Array.isArray(membership.tenant) ? membership.tenant[0] ?? null : membership.tenant }))
    .sort((a, b) => (a.tenant?.name ?? "").localeCompare(b.tenant?.name ?? "", "fr"));
  const activeId = await getActiveTenantId(memberships.map((membership) => membership.tenant_id));
  const activeMembership = memberships.find((membership) => membership.tenant_id === activeId) ?? null;
  const displayName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "";
  const canViewAudit = !!activeMembership && ["owner", "admin"].includes(activeMembership.role);

  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/app" className="brand"><span className="mark">i</span><span>iDIABA</span></Link>
        <nav className="app-actions" aria-label="Navigation principale">
          {canAccess(activeMembership?.role, "products") && <Link href="/app/products">Produits</Link>}
          {canAccess(activeMembership?.role, "stock") && <Link href="/app/stock">Stocks</Link>}
          {canAccess(activeMembership?.role, "inventory") && <Link href="/app/inventory">Inventaires</Link>}
          {canAccess(activeMembership?.role, "customers") && <Link href="/app/customers">Clients</Link>}
          {canAccess(activeMembership?.role, "pos") && <Link href="/app/pos">Caisse</Link>}
          {canAccess(activeMembership?.role, "purchasing") && <Link href="/app/purchasing">Achats</Link>}
          {canAccess(activeMembership?.role, "accounting") && <Link href="/app/accounting">Comptabilité</Link>}
          {canAccess(activeMembership?.role, "subscription") && <Link href="/app/subscription">Abonnement</Link>}
          <Link href="/app/company">Équipe</Link>
          {canViewAudit && <Link href="/app/overview">Vue consolidée</Link>}
          {canViewAudit && <Link href="/app/audit">Journal d’audit</Link>}
          {canViewAudit && <Link href="/app/reports">Rapports</Link>}
          {user.app_metadata?.role === "platform_admin" && <Link href="/app/platform-admin">Admin SaaS</Link>}
          <form action="/auth/signout" method="post"><button className="secondary">Déconnexion</button></form>
        </nav>
      </header>

      <section className="workspace">
        <div className="app-welcome">
          <div>
            <p className="eyebrow">VOTRE ESPACE DE GESTION</p>
            <h1>Bonjour{displayName ? `, ${displayName}` : ""} 👋</h1>
            <p className="lead">Retrouvez vos outils de gestion au même endroit. Sélectionnez un module pour commencer votre activité.</p>
          </div>
          <span className="welcome-chip"><span aria-hidden="true">●</span> {activeMembership?.tenant?.name ?? "Espace sécurisé"}</span>
        </div>
        {params.company === "created" && <p className="form-success" role="status">Entreprise créée. Elle est maintenant votre entreprise active.</p>}
        {params.joined && <p className="form-success" role="status">Vous avez rejoint l’entreprise. Elle est maintenant votre entreprise active.</p>}
        {params.left && <p className="form-success" role="status">Vous avez quitté l’entreprise.</p>}

        <div className="app-section-heading">
          <div><p className="eyebrow">PILOTAGE QUOTIDIEN</p><h2>Vos modules</h2></div>
          <p>Les données affichées sont celles de l’entreprise active{activeMembership?.tenant ? ` : ${activeMembership.tenant.name}` : ""}.</p>
        </div>
        <div className="app-module-grid">
          {modules.filter((item) => canAccess(activeMembership?.role, item.key)).map(({ title, description, href, action, icon: Icon }) => (
            <Link href={href} className="app-module-card" key={title}>
              <span className="app-module-icon"><Icon size={20} strokeWidth={1.9} /></span>
              <div><strong>{title}</strong><p>{description}</p></div>
              <span className="app-module-link">{action}<ArrowUpRight size={15} /></span>
            </Link>
          ))}
          {canViewAudit && <Link href="/app/reports" className="app-module-card"><span className="app-module-icon"><ChartNoAxesCombined size={20} strokeWidth={1.9} /></span><div><strong>Rapports de gestion</strong><p>Chiffre d’affaires, dépenses, achats, retours et stock.</p></div><span className="app-module-link">Consulter<ArrowUpRight size={15} /></span></Link>}
          {canViewAudit && <Link href="/app/audit" className="app-module-card"><span className="app-module-icon"><ShieldCheck size={20} strokeWidth={1.9} /></span><div><strong>Journal d’audit</strong><p>Traçabilité des créations, modifications et suppressions.</p></div><span className="app-module-link">Consulter<ArrowUpRight size={15} /></span></Link>}
          {user.app_metadata?.role === "platform_admin" && <Link href="/app/platform-admin" className="app-module-card"><span className="app-module-icon"><CreditCard size={20} strokeWidth={1.9} /></span><div><strong>Administration iDIABA</strong><p>Tarifs, quotas et validation des abonnements.</p></div><span className="app-module-link">Ouvrir la console<ArrowUpRight size={15} /></span></Link>}
        </div>

        <div className="app-section-heading">
          <div><p className="eyebrow">ORGANISATION</p><h2>Vos entreprises</h2></div>
          <p>{memberships.length} espace(s) associé(s) à votre compte</p>
        </div>
        {memberships.length ? (
          <div className="workspace-list">
            {memberships.filter((membership) => membership.tenant).map((membership) => {
              const isActive = membership.tenant_id === activeId;
              return (
                <article key={membership.tenant_id} className={isActive ? "workspace-item workspace-item-active" : "workspace-item"}>
                  <div><strong>{membership.tenant!.name}</strong><small>{membership.tenant!.slug}</small></div>
                  <div className="workspace-item-side">
                    <span className="role">{ROLE_LABELS[membership.role] ?? membership.role}</span>
                    {isActive ? <span className="pill">Active</span> : (
                      <form action={switchCompany}>
                        <input type="hidden" name="tenant_id" value={membership.tenant_id} />
                        <input type="hidden" name="return_to" value="/app" />
                        <button className="secondary" type="submit">Utiliser</button>
                      </form>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : <p className="catalog-empty">Aucun espace entreprise n&apos;est encore associé à ce compte. <Link href="/app/company/new">Créer une entreprise</Link></p>}
        <p className="catalog-help"><Link href="/app/company/new">+ Ajouter une autre entreprise</Link></p>
      </section>
    </main>
  );
}
