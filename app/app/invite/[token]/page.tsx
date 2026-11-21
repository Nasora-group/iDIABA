import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS } from "@/lib/tenant-labels";
import { acceptInvitation } from "../../company/actions";

export const dynamic = "force-dynamic";

type Preview = { tenant_name: string; role: string; status: string; expired: boolean; email_matches: boolean };

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/app/invite/${token}`)}`);

  let preview: Preview | null = null;
  if (/^[0-9a-f]{64}$/.test(token)) {
    const { data } = await supabase.rpc("get_invitation_preview", { invite_token: token });
    preview = ((data ?? []) as Preview[])[0] ?? null;
  }

  let problem: string | null = null;
  if (!preview) problem = "Cette invitation est introuvable. Vérifiez le lien reçu.";
  else if (preview.status !== "pending") problem = "Cette invitation a déjà été utilisée ou annulée.";
  else if (preview.expired) problem = "Cette invitation a expiré. Demandez-en une nouvelle à l'administrateur de l'entreprise.";
  else if (!preview.email_matches) problem = `Cette invitation est destinée à une autre adresse e-mail que ${user.email ?? "celle de votre compte"}. Déconnectez-vous et utilisez le compte invité.`;

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link className="brand auth-brand" href="/app"><span className="mark">i</span><span>iDIABA</span></Link>
        <p className="eyebrow">INVITATION</p>
        <h1>Rejoindre une entreprise</h1>
        {query.error && <p className="form-error" role="alert">{query.error}</p>}
        {problem || !preview ? (
          <>
            <p className="form-error" role="alert">{problem}</p>
            <div className="invite-actions">
              <Link className="secondary" href="/app">Retour à mon espace</Link>
              {preview && !preview.email_matches && (
                <form action="/auth/signout" method="post"><button className="secondary" type="submit">Changer de compte</button></form>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="auth-intro">Vous êtes invité à rejoindre <strong>{preview.tenant_name}</strong> avec le rôle <strong>{ROLE_LABELS[preview.role] ?? preview.role}</strong>.</p>
            <form action={acceptInvitation}>
              <input type="hidden" name="token" value={token} />
              <button className="primary auth-submit" type="submit">Rejoindre l&apos;entreprise</button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
