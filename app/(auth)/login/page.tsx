import Link from "next/link";
import AuthForm from "../auth-form";
import { safeAppPath } from "@/lib/tenant";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const destination = safeAppPath(next);
  const nextQuery = destination !== "/app" ? `?next=${encodeURIComponent(destination)}` : "";
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link className="brand auth-brand" href="/"><span className="mark">i</span><span>iDIABA</span></Link>
        <p className="eyebrow">BIENVENUE</p>
        <h1>Connexion à votre espace</h1>
        <p className="auth-intro">Retrouvez votre activité et vos données de gestion.</p>
        <AuthForm mode="login" next={destination} />
        <p className="auth-switch">Vous n’avez pas de compte ? <Link href={`/signup${nextQuery}`}>Créer un espace</Link></p>
      </section>
    </main>
  );
}
