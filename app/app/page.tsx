import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, Boxes, ChartNoAxesCombined, ClipboardList, CreditCard, Package, ShoppingCart, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Membership = {
  role: string;
  tenant: { id: string; name: string; slug: string } | null;
};

const modules = [
  { title: "Catalogue produits", description: "Références, catégories, prix et codes-barres.", href: "/app/products", action: "Gérer les produits", icon: Package },
  { title: "Stocks & dépôts", description: "Stocks disponibles, dépôts et journal des mouvements.", href: "/app/stock", action: "Consulter les stocks", icon: Boxes },
  { title: "Caisse & ventes", description: "Encaissements, paiements multiples et clôture de caisse.", href: "/app/pos", action: "Ouvrir la caisse", icon: CreditCard },
  { title: "Achats & fournisseurs", description: "Commandes fournisseurs et réceptions de marchandises.", href: "/app/purchasing", action: "Gérer les achats", icon: ShoppingCart },
  { title: "Comptabilité", description: "Dépenses, écritures et balance comptable.", href: "/app/accounting", action: "Voir la comptabilité", icon: ChartNoAxesCombined },
  { title: "Inventaires", description: "Préparation des comptages et contrôle des écarts.", href: "/app/stock", action: "Accéder aux stocks", icon: ClipboardList },
];

export default async function AppHome() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("role, tenant:tenants(id,name,slug)")
    .eq("user_id", user.id);

  if (error) {
    return <main className="shell"><h1>Votre espace</h1><p className="form-error">Impossible de charger vos entreprises. Réessayez dans quelques instants.</p></main>;
  }

  const memberships = (data ?? []) as unknown as Membership[];
  const displayName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "";

  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/app" className="brand"><span className="mark">i</span><span>iDIABA</span></Link>
        <nav className="app-actions" aria-label="Navigation principale">
          <Link href="/app/products">Produits</Link>
          <Link href="/app/stock">Stocks</Link>
          <Link href="/app/pos">Caisse</Link>
          <Link href="/app/purchasing">Achats</Link>
          <Link href="/app/accounting">Comptabilité</Link>
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
          <span className="welcome-chip"><span aria-hidden="true">●</span> Espace sécurisé</span>
        </div>

        <div className="app-section-heading">
          <div><p className="eyebrow">PILOTAGE QUOTIDIEN</p><h2>Vos modules</h2></div>
          <p>Les données affichées sont celles de vos entreprises.</p>
        </div>
        <div className="app-module-grid">
          {modules.map(({ title, description, href, action, icon: Icon }) => (
            <Link href={href} className="app-module-card" key={title}>
              <span className="app-module-icon"><Icon size={20} strokeWidth={1.9} /></span>
              <div><strong>{title}</strong><p>{description}</p></div>
              <span className="app-module-link">{action}<ArrowUpRight size={15} /></span>
            </Link>
          ))}
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
                <span className="role">{membership.role}</span>
              </article>
            ))}
          </div>
        ) : <p className="catalog-empty">Aucun espace entreprise n'est encore associé à ce compte.</p>}
      </section>
    </main>
  );
}
