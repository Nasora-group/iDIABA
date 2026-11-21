import Link from "next/link";
import ForgotPasswordForm from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link className="brand auth-brand" href="/"><span className="mark">i</span><span>iDIABA</span></Link>
        <p className="eyebrow">RÉCUPÉRATION DU COMPTE</p>
        <h1>Mot de passe oublié ?</h1>
        <p className="auth-intro">Saisissez votre adresse e-mail. Nous vous enverrons un lien sécurisé pour créer un nouveau mot de passe.</p>
        <ForgotPasswordForm />
        <p className="auth-switch"><Link href="/login">Retour à la connexion</Link></p>
      </section>
    </main>
  );
}
