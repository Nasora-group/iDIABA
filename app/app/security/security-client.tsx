"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Factor = { id: string; status: string; friendly_name?: string | null };

export default function SecurityClient() {
  const [factor, setFactor] = useState<Factor | null>(null);
  const [pendingFactorId, setPendingFactorId] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data, error: factorError } = await supabase.auth.mfa.listFactors();
    if (factorError) throw factorError;
    const verified = (data.totp ?? []).find((item) => item.status === "verified");
    const pending = (data.totp ?? []).find((item) => item.status !== "verified");
    setFactor(verified ? { id: verified.id, status: verified.status, friendly_name: verified.friendly_name } : null);
    setPendingFactorId(pending?.id ?? "");
  }, []);

  useEffect(() => {
    let active = true;
    void refresh().catch((e: unknown) => {
      if (active) setError(e instanceof Error ? e.message : "Impossible de lire les paramètres de sécurité.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);

  async function beginEnrollment() {
    setBusy(true); setError(""); setMessage("");
    try {
      const supabase = createClient();
      if (pendingFactorId) {
        const { error: removeError } = await supabase.auth.mfa.unenroll({ factorId: pendingFactorId });
        if (removeError) throw removeError;
      }
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "iDIABA Authenticator",
      });
      if (enrollError) throw enrollError;
      setPendingFactorId(data.id);
      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
      setMessage("Scannez le QR code avec votre application d’authentification, puis saisissez le code à 6 chiffres.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Activation de la double authentification impossible.");
    } finally { setBusy(false); }
  }

  async function verifyEnrollment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingFactorId || !/^\d{6}$/.test(code)) { setError("Saisissez un code à 6 chiffres."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const supabase = createClient();
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: pendingFactorId });
      if (challengeError) throw challengeError;
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: pendingFactorId,
        challengeId: challenge.id,
        code,
      });
      if (verifyError) throw verifyError;
      setQrCode(""); setSecret(""); setCode("");
      await refresh();
      setMessage("Double authentification activée. À votre prochaine connexion, un code sera demandé.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Code incorrect ou expiré. Réessayez.");
    } finally { setBusy(false); }
  }

  async function disableFactor() {
    if (!factor) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const supabase = createClient();
      const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
      if (unenrollError) throw unenrollError;
      setFactor(null);
      setMessage("Double authentification désactivée.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Désactivation impossible.");
    } finally { setBusy(false); }
  }

  if (loading) return <div className="offline-panel"><p>Chargement des paramètres de sécurité…</p></div>;

  return (
    <div className="offline-panel">
      <div className="catalog-heading">
        <div><h2>Double authentification (2FA)</h2><p>Un deuxième facteur protège l’accès même si votre mot de passe est compromis.</p></div>
        <span className="pill">{factor ? "Activée" : "Non activée"}</span>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-success" role="status">{message}</p>}
      {factor ? (
        <div>
          <p>Votre compte est protégé par une application d’authentification.</p>
          <button type="button" className="secondary" onClick={() => void disableFactor()} disabled={busy}>Désactiver la 2FA</button>
          <p className="catalog-help">La désactivation réduit la protection du compte. Les administrateurs devraient conserver cette protection activée.</p>
        </div>
      ) : qrCode ? (
        <form className="catalog-form" onSubmit={verifyEnrollment}>
          <p>1. Scannez ce QR code avec votre application d’authentification.</p>
          <div className="mfa-qr"><img src={qrCode} alt="QR code de configuration de la double authentification" /></div>
          <p>Si le scan est impossible, saisissez cette clé manuellement :</p>
          <code className="mfa-secret">{secret}</code>
          <label>2. Code de vérification à 6 chiffres<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required /></label>
          <button className="primary" disabled={busy || code.length !== 6}>{busy ? "Vérification…" : "Activer la double authentification"}</button>
        </form>
      ) : (
        <div>
          <p>Associez une application d’authentification pour générer des codes temporaires, même sans connexion Internet.</p>
          <button type="button" className="primary" onClick={() => void beginEnrollment()} disabled={busy}>{busy ? "Préparation…" : "Configurer la double authentification"}</button>
        </div>
      )}
    </div>
  );
}
