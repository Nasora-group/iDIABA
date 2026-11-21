"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordForm() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [valid, setValid] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" && session) {
        setEmail(session.user.email ?? "");
        setValid(true);
        setReady(true);
      }
    });

    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (data.session) {
        setEmail(data.session.user.email ?? "");
        setValid(true);
      } else if (sessionError) {
        setError("Le lien de réinitialisation est invalide ou expiré. Demandez un nouveau lien.");
      }
      setReady(true);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (password !== confirmation) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setSuccess("Votre mot de passe a été modifié. Vous allez être redirigé vers votre espace.");
      window.setTimeout(() => router.replace("/app"), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "La modification du mot de passe a échoué.");
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <p className="auth-intro" role="status">Vérification du lien sécurisé…</p>;

  if (!valid) {
    return (
      <div className="auth-form">
        <p className="form-error" role="alert">{error || "Aucune session de réinitialisation valide n’a été détectée."}</p>
        <Link className="primary auth-submit recovery-link" href="/forgot-password">Demander un nouveau lien</Link>
        <p className="auth-switch"><Link href="/login">Retour à la connexion</Link></p>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      {email && <label>Compte concerné<input value={email} readOnly /></label>}
      <label>Nouveau mot de passe<input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required /></label>
      <label>Confirmer le nouveau mot de passe<input type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} minLength={8} required /></label>
      <p className="recovery-hint">Utilisez au moins 8 caractères. Évitez un mot de passe déjà utilisé.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {success && <p className="form-success" role="status">{success}</p>}
      <button className="primary auth-submit" disabled={busy || !!success}>{busy ? "Modification…" : "Enregistrer le nouveau mot de passe"}</button>
    </form>
  );
}
