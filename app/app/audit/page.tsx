import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

type Relation<T> = T | T[] | null;
type Membership = { tenant_id: string; role: string; tenant: Relation<{ name: string }> };
type AuditRow = {
  id: number; tenant_id: string; actor_id: string | null; action: string;
  entity: string; entity_id: string | null; old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null; created_at: string;
  tenant: Relation<{ name: string }>;
};
function one<T>(value: Relation<T>): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
function labelAction(action: string) { return action === "INSERT" ? "Création" : action === "UPDATE" ? "Modification" : "Suppression"; }

export default async function AuditPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase.from("tenant_memberships")
    .select("tenant_id,role,tenant:tenants(name)").eq("user_id", user.id);
  const allMemberships = (memberships ?? []) as unknown as Membership[];
  const activeId = await getActiveTenantId(allMemberships.map((item) => item.tenant_id));
  const allowed = allMemberships
    .filter((item) => item.tenant_id === activeId && ["owner", "admin"].includes(item.role));
  const tenantIds = allowed.map((item) => item.tenant_id);
  if (!tenantIds.length) {
    return <main className="shell"><section className="workspace"><h1>Journal d&apos;audit</h1><p className="catalog-empty">Cette rubrique est réservée aux propriétaires et administrateurs.</p><Link href="/app">Retour au tableau de bord</Link></section></main>;
  }

  const { data, error } = await supabase.from("audit_logs")
    .select("id,tenant_id,actor_id,action,entity,entity_id,old_data,new_data,created_at,tenant:tenants(name)")
    .in("tenant_id", tenantIds).order("created_at", { ascending: false }).limit(100);
  const logs = (data ?? []) as unknown as AuditRow[];

  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/app" className="brand"><span className="mark">i</span><span>iDIABA</span></Link>
        <nav className="app-actions"><Link href="/app">Tableau de bord</Link><Link href="/app/subscription">Abonnements</Link></nav>
      </header>
      <section className="workspace">
        <p className="eyebrow">SÉCURITÉ & TRAÇABILITÉ</p>
        <h1>Journal d&apos;audit</h1>
        <p className="lead">Historique des opérations sensibles réalisées sur vos entreprises. Les entrées sont ajoutées automatiquement et ne peuvent pas être modifiées depuis l&apos;application.</p>
        {error && <p className="form-error">Impossible de charger le journal. Réessayez.</p>}
        <div className="audit-summary"><strong>{logs.length}</strong><span>événements récents affichés · maximum 100</span></div>
        <div className="audit-list">
          {logs.map((log) => {
            const tenant = one(log.tenant);
            return <article className="audit-row" key={log.id}>
              <div className="audit-row-heading">
                <span className={"audit-action audit-" + log.action.toLowerCase()}>{labelAction(log.action)}</span>
                <strong>{log.entity}</strong>
                <span>{tenant?.name ?? "Entreprise"}</span>
                <time dateTime={log.created_at}>{new Date(log.created_at).toLocaleString("fr-FR")}</time>
              </div>
              <p>Enregistrement : <code>{log.entity_id ?? "—"}</code> · Utilisateur : <code>{log.actor_id ? log.actor_id.slice(0,8) + "…" : "Système"}</code></p>
              <details>
                <summary>Voir les données avant / après</summary>
                <div className="audit-json-grid">
                  {log.old_data && <div><strong>Avant</strong><pre>{JSON.stringify(log.old_data,null,2)}</pre></div>}
                  {log.new_data && <div><strong>Après</strong><pre>{JSON.stringify(log.new_data,null,2)}</pre></div>}
                </div>
              </details>
            </article>;
          })}
          {!logs.length && !error && <p className="catalog-empty">Aucune opération enregistrée pour le moment.</p>}
        </div>
      </section>
    </main>
  );
}
