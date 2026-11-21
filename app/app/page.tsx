import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";
import { createClient } from "@/lib/supabase/server";

type Membership = {
  role: string;
  tenant: { id: string; name: string; slug: string } | null;
};

export default async function AppHome() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("role, tenant:tenants(id,name,slug)")
    .eq("user_id", user.id);

  if (error) {
    return <main className="shell"><h1>Votre espace</h1><p>Impossible de charger vos entreprises : {error.message}</p></main>;
  }

  const memberships = (data ?? []) as unknown as Membership[];
  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="mark">i</span><span>iDIABA</span></div>
        <div className="app-actions"><Link href="/app/products">Catalogue produits</Link><form action="/auth/signout" method="post"><button className="secondary">Déconnexion</button></form></div>
      </header>
      <section className="workspace">
        <p className="eyebrow">ESPACE DE TRAVAIL</p>
        <h1>Bienvenue{user.user_metadata?.full_name ? `, ${user.user_metadata.full_name}` : ""}</h1>
        <p className="lead">Votre compte est connecté. Les modules de gestion seront activés progressivement.</p>
        <div className="app-module-card">
          <div><strong>Catalogue produits</strong><p>Gérez les références, les prix, les catégories et les codes-barres de vos entreprises.</p></div>
          <Link className="primary" href="/app/products">Ouvrir le catalogue</Link>
        </div>
        <h2>Vos entreprises</h2>
        {memberships.length ? (
          <div className="workspace-list">
            {memberships.filter((membership) => membership.tenant).map((membership) => (
              <article key={membership.tenant!.id} className="workspace-item">
                <div><strong>{membership.tenant!.name}</strong><small>{membership.tenant!.slug}</small></div>
                <span className="role">{membership.role}</span>
              </article>
            ))}
          </div>
        ) : <p>Aucun espace entreprise associé à ce compte.</p>}
      </section>
    </main>
  );
}
