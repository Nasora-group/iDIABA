import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createCompany } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewCompanyPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/app" className="brand"><span className="mark">i</span><span>iDIABA</span></Link>
        <nav className="app-actions" aria-label="Navigation principale"><Link href="/app">Tableau de bord</Link></nav>
      </header>
      <section className="workspace">
        <p className="eyebrow">MULTI-ENTREPRISE</p>
        <h1>Nouvelle entreprise</h1>
        <p className="lead">Ajoutez une autre entreprise à votre compte. Elle dispose de ses propres produits, stocks, caisses, comptabilité, équipe et abonnement, totalement séparés de vos autres entreprises.</p>
        {params.error && <p className="form-error" role="alert">{params.error}</p>}
        <section className="catalog-tenant">
          <form action={createCompany} className="company-inline-form">
            <label>Nom de l&apos;entreprise<input name="name" required minLength={2} maxLength={120} placeholder="Ex. Boutique Diaba Dakar" autoFocus /></label>
            <button className="primary" type="submit">Créer l&apos;entreprise</button>
          </form>
          <p className="catalog-help">Vous en devenez propriétaire et elle démarre avec un essai gratuit de 14 jours. Un compte peut créer jusqu&apos;à 5 entreprises.</p>
        </section>
      </section>
    </main>
  );
}
