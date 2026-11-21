"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Props = { mode: "login" | "signup" };

export default function AuthForm({ mode }: Props) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
              workspace_name: company.trim(),
              workspace_slug: company.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
            },
          },
        });
        if (signUpError) throw signUpError;
        if (!data.user) throw new Error("Création de compte impossible.");
        if (!data.session) {
          setMessage("Compte créé. Vérifiez votre e-mail pour confirmer votre inscription, puis connectez-vous.");
          return;
        }
      } else {
        const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
        if (loginError) throw loginError;
      }
      router.push("/app");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Une erreur est survenue.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      {mode === "signup" && (
        <>
          <label>Nom complet<input autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required /></label>
          <label>Nom de l&apos;entreprise<input value={company} onChange={(e) => setCompany(e.target.value)} required minLength={2} /></label>
        </>
      )}
      <label>E-mail<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>Mot de passe<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required /></label>
      {mode === "login" && <p className="auth-switch recovery-forgot"><Link href="/forgot-password">Mot de passe oublié ?</Link></p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-success" role="status">{message}</p>}
      <button className="primary auth-submit" disabled={busy}>{busy ? "Veuillez patienter…" : mode === "login" ? "Se connecter" : "Créer mon espace"}</button>
    </form>
  );
}
