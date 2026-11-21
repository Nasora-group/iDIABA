"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const RESET_URL = "https://idiaba.onrender.com/auth/reset-password";

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const supabase = createClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: RESET_URL,
      });
      if (resetError) throw resetError;
      setMessage("Si un compte correspond à cette adresse, un e-mail de réinitialisation vient d’être envoyé. Vérifiez aussi vos courriers indésirables.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible d’envoyer le lien. Réessayez.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>Adresse e-mail<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-success" role="status">{message}</p>}
      <button className="primary auth-submit" disabled={busy}>{busy ? "Envoi en cours…" : "Envoyer le lien de réinitialisation"}</button>
    </form>
  );
}
