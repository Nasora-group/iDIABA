import Link from "next/link";
import { MODULE_TITLES, type ModuleKey } from "@/lib/permissions";

export default function AccessDenied({ module }: { module: ModuleKey }) {
  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/app" className="brand"><span className="mark">i</span><span>iDIABA</span></Link>
        <nav className="app-actions" aria-label="Navigation principale"><Link href="/app">Tableau de bord</Link></nav>
      </header>
      <section className="workspace">
        <p className="eyebrow">ACCÈS LIMITÉ</p>
        <h1>{MODULE_TITLES[module]}</h1>
        <p className="form-error" role="alert">Votre rôle dans l&apos;entreprise active ne donne pas accès à cette rubrique. Demandez à un propriétaire ou administrateur de modifier votre rôle, ou changez d&apos;entreprise avec le sélecteur en haut de page.</p>
        <p><Link href="/app">Retour au tableau de bord</Link></p>
      </section>
    </main>
  );
}
