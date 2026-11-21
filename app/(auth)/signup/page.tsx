import Link from "next/link";
import AuthForm from "../auth-form";

export default function SignupPage() {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link className="brand auth-brand" href="/"><span className="mark">i</span><span>iDIABA</span></Link>
        <p className="eyebrow">DÉMARRER</p>
        <h1>Créez votre espace</h1>
        <p className="auth-intro">Votre entreprise sera isolée dans son propre espace de gestion.</p>
        <AuthForm mode="signup" />
        <p className="auth-switch">Déjà inscrit ? <Link href="/login">Se connecter</Link></p>
      </section>
    </main>
  );
}
