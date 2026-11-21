import Link from "next/link";
import AuthForm from "../auth-form";

export default function LoginPage() {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link className="brand auth-brand" href="/"><span className="mark">i</span><span>iDIABA</span></Link>
        <p className="eyebrow">BIENVENUE</p>
        <h1>Connexion à votre espace</h1>
        <p className="auth-intro">Retrouvez votre activité et vos données de gestion.</p>
        <AuthForm mode="login" />
        <p className="auth-switch">Vous n’avez pas de compte ? <Link href="/signup">Créer un espace</Link></p>
      </section>
    </main>
  );
}
