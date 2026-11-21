"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function MFAChallengePage({ searchParams }: { searchParams: { next?: string } }) {
  const router = useRouter();
  const started = useRef(false);
  const [factorId, setFactorId] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const destination = searchParams.next?.startsWith("/app") ? searchParams.next : "/app";

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { router.replace("/login"); return; }
        const { data, error: listError } = await supabase.auth.mfa.listFactors();
        if (listError) throw listError;
        const factor = (data.totp ?? []).find((item) => item.status === "verified");
        if (!factor) { router.replace("/app/security"); return; }
        const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: factor.id });
        if (challengeError) throw challengeError;
        setFactorId(factor.id);
        setChallengeId(challenge.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Impossible de préparer la vérification.");
      }
    })();
  }, [router]);

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factorId || !challengeId || !/^\d{6}$/.test(code)) return;
    setBusy(true); setError("");
    try {
      const supabase = createClient();
      const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId, code });
      if (verifyError) throw verifyError;
      router.replace(destination);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Code incorrect ou expiré.");
    } finally { setBusy(false); }
  }

  return (
    <main className="shell auth-shell">
      <section className="auth-card">
        <Link href="/login" className="brand"><span className="mark">i</span><span>iDIABA</span></Link>
        <p className="eyebrow">VÉRIFICATION DE SÉCURITÉ</p>
        <h1>Confirmez votre identité</h1>
        <p className="lead">Saisissez le code temporaire affiché dans votre application d’authentification.</p>
        <form className="auth-form" onSubmit={verify}>
          <label>Code à 6 chiffres<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary auth-submit" disabled={busy || !challengeId || code.length !== 6}>{busy ? "Vérification…" : "Valider le code"}</button>
        </form>
      </section>
    </main>
  );
}
