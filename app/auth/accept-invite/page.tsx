import Link from "next/link";
import AcceptInviteForm from "./accept-invite-form";

export default function AcceptInvitePage() {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link className="brand auth-brand" href="/"><span className="mark">i</span><span>iDIABA</span></Link>
        <p className="eyebrow">INVITATION</p>
        <h1>Activer votre compte</h1>
        <p className="auth-intro">Choisissez un mot de passe pour rejoindre l’espace de votre entreprise.</p>
        <AcceptInviteForm />
      </section>
    </main>
  );
}
