import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SecurityClient from "./security-client";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/app" className="brand"><span className="mark">i</span><span>iDIABA</span></Link>
        <nav className="product-nav"><Link href="/app">Mon espace</Link><Link href="/app/team">Équipe</Link><span>Sécurité</span></nav>
      </header>
      <section className="workspace catalog-workspace">
        <p className="eyebrow">COMPTE · PROTECTION</p>
        <h1>Sécurité du compte</h1>
        <p className="lead">Protégez votre compte avec une application d’authentification compatible TOTP (Google Authenticator, Microsoft Authenticator, 1Password, etc.).</p>
        <SecurityClient />
      </section>
    </main>
  );
}
