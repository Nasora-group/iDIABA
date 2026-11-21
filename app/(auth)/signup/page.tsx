import Link from "next/link";
import AuthForm from "../auth-form";
import { safeAppPath } from "@/lib/tenant";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const destination = safeAppPath(next);
  const isInvite = destination.startsWith("/app/invite/");
  const nextQuery = destination !== "/app" ? `?next=${encodeURIComponent(destination)}` : "";
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link className="brand auth-brand" href="/"><span className="mark">i</span><span>iDIABA</span></Link>
        <p className="eyebrow">{isInvite ? "INVITATION" : "DÉMARRER"}</p>
        <h1>{isInvite ? "Créez votre compte" : "Créez votre espace"}</h1>
        <p className="auth-intro">{isInvite ? "Utilisez l’adresse e-mail à laquelle l’invitation a été envoyée pour rejoindre l’entreprise." : "Votre entreprise sera isolée dans son propre espace de gestion."}</p>
        <AuthForm mode="signup" next={destination} invite={isInvite} />
        <p className="auth-switch">Déjà inscrit ? <Link href={`/login${nextQuery}`}>Se connecter</Link></p>
      </section>
    </main>
  );
}
