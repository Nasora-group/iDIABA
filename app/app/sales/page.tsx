import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Membership = { tenant_id: string; role: string; custom_role_profile_id: string | null; tenant: { name: string } | null };
type Sale = { id: string; total: number | string; created_at: string; cashier_id: string | null; customer_id: string | null };

const legacySalesPermissions: Record<string, string[]> = { manager: ["sales_read","sales_manage"], cashier: ["sales_read"], accountant: ["sales_read"], viewer: ["sales_read"] };
const money = (value: number | string) => Number(value).toLocaleString("fr-FR", { maximumFractionDigits: 2 });

export default async function SalesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membershipRows, error } = await supabase.from("tenant_memberships")
    .select("tenant_id,role,custom_role_profile_id,tenant:tenants(name)")
    .eq("user_id", user.id);
  if (error) return <main className="shell"><section className="workspace"><h1>Ventes</h1><p className="form-error">Impossible de charger vos entreprises.</p></section></main>;

  const memberships = (membershipRows ?? []) as unknown as Membership[];
  const profileIds = memberships.map((m) => m.custom_role_profile_id).filter((id): id is string => Boolean(id));
  const { data: profileRows } = profileIds.length
    ? await supabase.from("tenant_role_profiles").select("id,permissions,allowed_roles").in("id", profileIds)
    : { data: [] as { id: string; permissions: string[]; allowed_roles: string[] }[] };
  const profiles = new Map((profileRows ?? []).map((p) => [p.id, p]));

  const groups = await Promise.all(memberships.map(async (membership) => {
    const customProfile = membership.custom_role_profile_id ? profiles.get(membership.custom_role_profile_id) : null;
    const permissions = customProfile?.permissions?.length
      ? customProfile.permissions
      : (customProfile?.allowed_roles ?? [membership.role]).flatMap((role) => legacySalesPermissions[role] ?? []);
    const canView = ["owner", "admin"].includes(membership.role)
      || permissions.some((permission) => ["sales_read", "sales_manage"].includes(permission));
    if (!canView) return { membership, sales: [] as Sale[], denied: true };
    const { data } = await supabase.from("sales")
      .select("id,total,created_at,cashier_id,customer_id")
      .eq("tenant_id", membership.tenant_id)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(100);
    return { membership, sales: (data ?? []) as Sale[], denied: false };
  }));

  const cashierIds = [...new Set(groups.flatMap((g) => g.sales.map((s) => s.cashier_id).filter((id): id is string => Boolean(id))))];
  const { data: people } = cashierIds.length
    ? await supabase.from("profiles").select("id,full_name").in("id", cashierIds)
    : { data: [] as { id: string; full_name: string | null }[] };
  const names = new Map((people ?? []).map((p) => [p.id, p.full_name || "Utilisateur"]));

  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/app" className="brand"><span className="mark">i</span><span>iDIABA</span></Link>
        <nav className="product-nav"><Link href="/app">Accueil</Link><Link href="/app/pos">Caisse</Link><span>Ventes</span></nav>
      </header>
      <section className="workspace catalog-workspace">
        <p className="eyebrow">ACTIVITÉ COMMERCIALE</p>
        <h1>Ventes</h1>
        <p className="lead">Consultez les ventes validées et retrouvez les tickets sans passer par l’écran d’encaissement.</p>
        {groups.map(({ membership, sales, denied }) => (
          <section className="catalog-tenant" key={membership.tenant_id}>
            <div className="catalog-heading"><div><h2>{membership.tenant?.name ?? "Entreprise"}</h2><p>{sales.length} vente(s) récente(s)</p></div><Link className="secondary" href="/app/pos">Nouvelle vente</Link></div>
            {denied ? <p className="catalog-empty">Votre profil ne dispose pas de l’accès aux ventes.</p> : sales.length ? (
              <div className="catalog-table-wrap"><table className="catalog-table"><thead><tr><th>Date</th><th>Ticket</th><th>Caissier</th><th>Total</th><th>Action</th></tr></thead><tbody>
                {sales.map((sale) => <tr key={sale.id}>
                  <td>{new Date(sale.created_at).toLocaleString("fr-FR")}</td>
                  <td><strong>{sale.id.slice(0, 8).toUpperCase()}</strong></td>
                  <td>{sale.cashier_id ? names.get(sale.cashier_id) ?? "Utilisateur" : "Non renseigné"}</td>
                  <td><strong>{money(sale.total)} FCFA</strong></td>
                  <td><Link href={`/app/pos/receipt/${sale.id}`}>Voir le ticket</Link></td>
                </tr>)}
              </tbody></table></div>
            ) : <p className="catalog-empty">Aucune vente finalisée pour le moment.</p>}
          </section>
        ))}
      </section>
    </main>
  );
}
