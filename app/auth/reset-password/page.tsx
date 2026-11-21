import Link from "next/link";
import ResetPasswordForm from "./reset-password-form";
import "./reset-password.css";

export default function ResetPasswordPage() {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link className="brand auth-brand" href="/"><span className="mark">i</span><span>iDIABA</span></Link>
        <p className="eyebrow">SÉCURITÉ DU COMPTE</p>
        <h1>Créer un nouveau mot de passe</h1>
        <p className="auth-intro">Choisissez un mot de passe d’au moins 8 caractères pour sécuriser votre compte iDIABA.</p>
        <ResetPasswordForm />
      </section>
    </main>
  );
}
