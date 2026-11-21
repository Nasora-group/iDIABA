import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveTenantId } from "@/lib/tenant";
import { ASSIGNABLE_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/tenant-labels";
import { changeMemberRole, inviteMember, leaveCompany, removeMember, renameCompany, revokeInvitation } from "./actions";
import CopyLink from "./copy-link";

export const dynamic = "force-dynamic";

type Relation<T> = T | T[] | null;
type Membership = { tenant_id: string; role: string; tenant: Relation<{ id: string; name: string; slug: string }> };
type Member = { user_id: string; role: string; full_name: string; email: string; joined_at: string };
type Invitation = { id: string; email: string; role: string; token: string; expires_at: string; created_at: string };
type SearchParams = { error?: string; saved?: string; invited?: string; revoked?: string; updated?: string; removed?: string };

function one<T>(value: Relation<T>): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
const formatDate = (value: string) => new Date(value).toLocaleDateString("fr-FR");

export default async function CompanyPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.from("tenant_memberships")
    .select("tenant_id,role,tenant:tenants(id,name,slug)").eq("user_id", user.id);
  const memberships = ((data ?? []) as unknown as Membership[]).map((item) => ({ ...item, tenant: one(item.tenant) }));
  if (!memberships.length) redirect("/app/company/new");

  const activeId = await getActiveTenantId(memberships.map((item) => item.tenant_id));
  const active = memberships.find((item) => item.tenant_id === activeId) ?? memberships[0];
  const tenant = active.tenant;
  const isOwner = active.role === "owner";
  const canManage = isOwner || active.role === "admin";
  const invitableRoles = ASSIGNABLE_ROLES.filter((role) => isOwner || !["owner", "admin"].includes(role));

  let members: Member[] = [];
  let invitations: Invitation[] = [];
  let loadError: string | null = null;
  if (canManage) {
    const [memberResult, inviteResult] = await Promise.all([
      supabase.rpc("list_tenant_members", { target_tenant: active.tenant_id }),
      supabase.from("tenant_invitations")
        .select("id,email,role,token,expires_at,created_at")
        .eq("tenant_id", active.tenant_id).eq("status", "pending").order("created_at", { ascending: false }),
    ]);
    members = (memberResult.data ?? []) as Member[];
    invitations = (inviteResult.data ?? []) as Invitation[];
    loadError = memberResult.error?.message ?? inviteResult.error?.message ?? null;
  }

  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const origin = host ? `${protocol}://${host}` : (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");

  const canEditMember = (member: Member) => isOwner || !["owner", "admin"].includes(member.role);

  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/app" className="brand"><span className="mark">i</span><span>iDIABA</span></Link>
        <nav className="app-actions" aria-label="Navigation principale">
          <Link href="/app">Tableau de bord</Link>
          <Link href="/app/subscription">Abonnement</Link>
          <Link href="/app/company/new">Nouvelle entreprise</Link>
        </nav>
      </header>
      <section className="workspace">
        <p className="eyebrow">MULTI-ENTREPRISE</p>
        <h1>Entreprise &amp; équipe</h1>
        <p className="lead">Gérez les informations de <strong>{tenant?.name}</strong>, les membres de l&apos;équipe et leurs droits d&apos;accès. Les données de chaque entreprise restent strictement séparées.</p>

        {params.saved && <p className="form-success" role="status">Nom de l&apos;entreprise mis à jour.</p>}
        {params.invited && <p className="form-success" role="status">Invitation créée. Copiez le lien ci-dessous et envoyez-le à la personne invitée.</p>}
        {params.revoked && <p className="form-success" role="status">Invitation annulée.</p>}
        {params.updated && <p className="form-success" role="status">Rôle mis à jour.</p>}
        {params.removed && <p className="form-success" role="status">Membre retiré de l&apos;entreprise.</p>}
        {params.error && <p className="form-error" role="alert">{params.error}</p>}
        {loadError && <p className="form-error" role="alert">Chargement partiel de l&apos;équipe : {loadError}</p>}

        <section className="catalog-tenant">
          <div className="catalog-heading">
            <div><h2>Informations</h2><p>Identifiant : {tenant?.slug} · Votre rôle : {ROLE_LABELS[active.role] ?? active.role}</p></div>
          </div>
          {canManage ? (
            <form action={renameCompany} className="company-inline-form">
              <input type="hidden" name="tenant_id" value={active.tenant_id} />
              <label>Nom de l&apos;entreprise<input name="name" defaultValue={tenant?.name ?? ""} required minLength={2} maxLength={120} /></label>
              <button className="primary" type="submit">Enregistrer</button>
            </form>
          ) : <p className="catalog-help">Seuls les propriétaires et administrateurs peuvent modifier ces informations.</p>}
        </section>

        {canManage ? (
          <>
            <section className="catalog-tenant">
              <div className="catalog-heading">
                <div><h2>Équipe</h2><p>{members.length} membre(s) dans cette entreprise</p></div>
                <span className="pill">{invitations.length} invitation(s) en attente</span>
              </div>
              <div className="catalog-table-wrap">
                <table className="catalog-table">
                  <thead><tr><th>Membre</th><th>Rôle</th><th>Depuis</th><th /></tr></thead>
                  <tbody>
                    {members.map((member) => {
                      const isSelf = member.user_id === user.id;
                      const editable = canEditMember(member);
                      const roleOptions = isOwner ? ASSIGNABLE_ROLES : ASSIGNABLE_ROLES.filter((role) => !["owner", "admin"].includes(role));
                      return (
                        <tr key={member.user_id}>
                          <td><strong>{member.full_name || member.email || "Utilisateur"}{isSelf ? " (vous)" : ""}</strong><small>{member.email}</small></td>
                          <td>
                            {editable ? (
                              <form action={changeMemberRole} className="role-form">
                                <input type="hidden" name="tenant_id" value={active.tenant_id} />
                                <input type="hidden" name="user_id" value={member.user_id} />
                                <select name="role" defaultValue={member.role} aria-label={`Rôle de ${member.email}`}>
                                  {roleOptions.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                                </select>
                                <button className="secondary" type="submit">Appliquer</button>
                              </form>
                            ) : <span className="role">{ROLE_LABELS[member.role] ?? member.role}</span>}
                          </td>
                          <td>{formatDate(member.joined_at)}</td>
                          <td>
                            {isSelf ? (
                              <form action={leaveCompany}><input type="hidden" name="tenant_id" value={active.tenant_id} /><button className="archive-button" type="submit">Quitter</button></form>
                            ) : editable ? (
                              <form action={removeMember}><input type="hidden" name="tenant_id" value={active.tenant_id} /><input type="hidden" name="user_id" value={member.user_id} /><button className="archive-button" type="submit">Retirer</button></form>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="catalog-tenant">
              <div className="catalog-heading"><div><h2>Inviter un membre</h2><p>L&apos;invitation est valable 7 jours et liée à l&apos;adresse e-mail saisie.</p></div></div>
              <form action={inviteMember} className="company-inline-form">
                <input type="hidden" name="tenant_id" value={active.tenant_id} />
                <label>Adresse e-mail<input name="email" type="email" required maxLength={254} placeholder="collaborateur@exemple.com" autoComplete="off" /></label>
                <label>Rôle
                  <select name="role" defaultValue="cashier">{invitableRoles.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select>
                </label>
                <button className="primary" type="submit">Créer l&apos;invitation</button>
              </form>
              <ul className="role-help">{invitableRoles.map((role) => <li key={role}><strong>{ROLE_LABELS[role]}</strong> — {ROLE_DESCRIPTIONS[role]}</li>)}</ul>
              {invitations.length > 0 && (
                <div className="invitation-list">
                  <h3>Invitations en attente</h3>
                  {invitations.map((invitation) => {
                    const expired = new Date(invitation.expires_at).getTime() <= Date.now();
                    return (
                      <article className="invitation-item" key={invitation.id}>
                        <div>
                          <strong>{invitation.email}</strong>
                          <small>{ROLE_LABELS[invitation.role] ?? invitation.role} · {expired ? "Expirée le " : "Expire le "}{formatDate(invitation.expires_at)}</small>
                        </div>
                        {!expired && <CopyLink value={`${origin}/app/invite/${invitation.token}`} />}
                        <form action={revokeInvitation}><input type="hidden" name="invitation_id" value={invitation.id} /><button className="archive-button" type="submit">Annuler</button></form>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        ) : (
          <section className="catalog-tenant">
            <div className="catalog-heading"><div><h2>Votre accès</h2><p>{ROLE_DESCRIPTIONS[active.role] ?? ""}</p></div></div>
            <p className="catalog-help">La gestion de l&apos;équipe est réservée aux propriétaires et administrateurs.</p>
            <form action={leaveCompany}><input type="hidden" name="tenant_id" value={active.tenant_id} /><button className="archive-button" type="submit">Quitter cette entreprise</button></form>
          </section>
        )}
      </section>
    </main>
  );
}
