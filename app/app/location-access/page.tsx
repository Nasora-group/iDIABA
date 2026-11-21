import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { assignLocationMember, removeLocationMember } from "./actions";

type Workspace = { tenant_id: string; role: string; tenant: { name: string } | null };
type Member = { user_id: string; role: string; profile: { full_name: string | null } | null };
type Location = { id: string; name: string; code: string; location_type: string };
type Assignment = { location_id: string; user_id: string };

export const dynamic = "force-dynamic";

const roleLabels: Record<string, string> = {
  owner: "Propriétaire", admin: "Administrateur", manager: "Responsable",
  cashier: "Caissier", stock: "Gestionnaire stock", accountant: "Comptable", viewer: "Consultation",
};
const messages: Record<string, string> = {
  assigned: "Accès au site attribué.", removed: "Accès au site retiré.",
  exists: "Cet employé est déjà affecté à ce site.", validation: "Données invalides.",
  forbidden: "Vous n’avez pas les droits nécessaires.", error: "Opération impossible. Vérifiez les droits et les données.",
};

export default async function LocationAccessPage({ searchParams }: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: memberships } = await supabase.from("tenant_memberships")
    .select("tenant_id,role,tenant:tenants(name)").eq("user_id", user.id);
  const workspaces = ((memberships ?? []) as unknown as Workspace[])
    .filter(w => ["owner", "admin", "manager"].includes(w.role));

  const groups = await Promise.all(workspaces.map(async workspace => {
    const [locationsResult, membersResult, assignmentsResult] = await Promise.all([
      supabase.from("stock_locations").select("id,name,code,location_type")
        .eq("tenant_id", workspace.tenant_id).eq("is_active", true).order("name"),
      supabase.from("tenant_memberships").select("user_id,role")
        .eq("tenant_id", workspace.tenant_id).order("created_at"),
      supabase.from("stock_location_memberships").select("location_id,user_id")
        .eq("tenant_id", workspace.tenant_id),
    ]);
    const memberRows = membersResult.data ?? [];
    const { data: profiles } = memberRows.length
      ? await supabase.from("profiles").select("id,full_name").in("id", memberRows.map(m => m.user_id))
      : { data: [] };
    const names = new Map((profiles ?? []).map(p => [p.id, p.full_name]));
    const members = memberRows.map(m => ({
      user_id: m.user_id, role: m.role,
      profile: { full_name: names.get(m.user_id) ?? null },
    })) as Member[];
    return {
      workspace,
      locations: (locationsResult.data ?? []) as Location[],
      members,
      assignments: (assignmentsResult.data ?? []) as Assignment[],
      error: locationsResult.error?.message ?? membersResult.error?.message ?? assignmentsResult.error?.message ?? null,
    };
  }));

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="mark">i</span><span>iDIABA</span></div>
        <nav className="product-nav">
          <Link href="/app">Mon espace</Link><Link href="/app/team">Équipe</Link><span>Accès boutiques</span>
          <Link href="/app/stock">Stocks</Link>
        </nav>
      </header>
      <section className="workspace catalog-workspace">
        <p className="eyebrow">SÉCURITÉ · MULTI-BOUTIQUES</p>
        <h1>Accès aux boutiques et dépôts</h1>
        <p className="lead">Affectez les caissiers, magasiniers et autres employés aux sites qu’ils peuvent consulter et utiliser. Un site sans affectation nominative conserve son accès historique à tous les membres de l’entreprise.</p>
        {params.status && messages[params.status] && <p className={["assigned","removed"].includes(params.status) ? "form-success" : "form-error"}>{messages[params.status]}</p>}
        {!groups.length && <p className="catalog-empty">Cette page est réservée aux propriétaires, administrateurs et responsables d’entreprise.</p>}
        {groups.map(({ workspace, locations, members, assignments, error }) => (
          <section className="catalog-tenant" key={workspace.tenant_id}>
            <div className="catalog-heading"><div><h2>{workspace.tenant?.name ?? "Entreprise"}</h2><p>{locations.length} site(s) actif(s)</p></div></div>
            {error && <p className="form-error">Chargement incomplet des affectations. Vérifiez les droits d’accès.</p>}
            {!locations.length && <p className="catalog-empty">Aucune boutique ou aucun dépôt actif. Créez d’abord un site dans la gestion des stocks.</p>}
            {locations.map(location => {
              const assignedIds = assignments.filter(a => a.location_id === location.id).map(a => a.user_id);
              const eligible = members.filter(m => !["owner", "admin", "manager"].includes(m.role));
              return (
                <article className="workspace-item" key={location.id}>
                  <div>
                    <strong>{location.name}</strong>
                    <small>{location.code} · {location.location_type === "warehouse" ? "Dépôt" : "Boutique"} · {assignedIds.length} affectation(s)</small>
                  </div>
                  <form action={assignLocationMember} className="member-actions">
                    <input type="hidden" name="tenant_id" value={workspace.tenant_id} />
                    <input type="hidden" name="location_id" value={location.id} />
                    <label>Ajouter un employé
                      <select name="user_id" defaultValue="" required>
                        <option value="" disabled>Choisir un membre</option>
                        {eligible.filter(m => !assignedIds.includes(m.user_id)).map(m => (
                          <option value={m.user_id} key={m.user_id}>{m.profile?.full_name || m.user_id.slice(0, 8)} · {roleLabels[m.role] ?? m.role}</option>
                        ))}
                      </select>
                    </label>
                    <button type="submit" disabled={!eligible.some(m => !assignedIds.includes(m.user_id))}>Affecter</button>
                  </form>
                  <div className="workspace-list">
                    {assignments.filter(a => a.location_id === location.id).map(assignment => {
                      const member = members.find(m => m.user_id === assignment.user_id);
                      return (
                        <article className="workspace-item" key={assignment.user_id}>
                          <div><strong>{member?.profile?.full_name || "Employé"}</strong><small>{roleLabels[member?.role ?? ""] ?? member?.role}</small></div>
                          <form action={removeLocationMember}>
                            <input type="hidden" name="tenant_id" value={workspace.tenant_id} />
                            <input type="hidden" name="location_id" value={location.id} />
                            <input type="hidden" name="user_id" value={assignment.user_id} />
                            <button className="secondary" type="submit">Retirer</button>
                          </form>
                        </article>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </section>
        ))}
      </section>
    </main>
  );
}
