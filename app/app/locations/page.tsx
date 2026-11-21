import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { assignLocationMember, removeLocationMember, updateStockLocation } from "./actions";

type Workspace = { tenant_id: string; role: string; tenant: { name: string } | null };
type Location = { id: string; name: string; code: string; location_type: "store" | "warehouse"; address: string; phone: string; description: string; is_active: boolean };
type Member = { user_id: string; role: string; full_name: string };
type Assignment = { id: string; location_id: string; user_id: string };

export const dynamic = "force-dynamic";

export default async function LocationsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: rows } = await supabase.from("tenant_memberships")
    .select("tenant_id,role,tenant:tenants(name)").eq("user_id",user.id);
  const workspaces = (rows ?? []) as unknown as Workspace[];
  const messages: Record<string,string> = {
    updated:"Établissement mis à jour.",
    assigned:"Utilisateur affecté à l’établissement.",
    removed:"Affectation retirée.",
    validation:"Vérifiez le nom, le code et le type de l’établissement.",
    denied:"Seuls le propriétaire, l’administrateur ou le responsable peuvent gérer les affectations.",
    assignment_error:"Affectation impossible. Vérifiez que l’utilisateur appartient bien à cette entreprise.",
    error:"Modification impossible. Vérifiez le code et les droits.",
  };
  const groups = await Promise.all(workspaces.map(async (workspace) => {
    const [locationResult, memberResult, assignmentResult] = await Promise.all([
      supabase.from("stock_locations").select("id,name,code,location_type,address,phone,description,is_active")
        .eq("tenant_id",workspace.tenant_id).order("name"),
      ["owner","admin","manager"].includes(workspace.role)
        ? supabase.from("tenant_memberships").select("user_id,role").eq("tenant_id",workspace.tenant_id).order("created_at")
        : Promise.resolve({data:[],error:null}),
      supabase.from("stock_location_memberships").select("id,location_id,user_id").eq("tenant_id",workspace.tenant_id),
    ]);
    const members = (memberResult.data ?? []) as {user_id:string;role:string}[];
    const profiles = members.length
      ? await supabase.from("profiles").select("id,full_name").in("id",members.map(m=>m.user_id))
      : {data:[]};
    const names = new Map((profiles.data ?? []).map(p=>[p.id,p.full_name]));
    const staff = members.filter(m=>!["owner","admin","manager"].includes(m.role))
      .map(m=>({user_id:m.user_id,role:m.role,full_name:names.get(m.user_id) || "Utilisateur"})) as Member[];
    return {
      workspace,
      locations:(locationResult.data ?? []) as Location[],
      staff,
      assignments:(assignmentResult.data ?? []) as Assignment[],
      error:locationResult.error?.message ?? memberResult.error?.message ?? assignmentResult.error?.message ?? null,
    };
  }));

  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/app" className="brand"><span className="mark">i</span><span>iDIABA</span></Link>
        <nav className="product-nav"><Link href="/app">Mon espace</Link><Link href="/app/stock">Stocks</Link><Link href="/app/transfers">Transferts</Link><span>Accès établissements</span></nav>
      </header>
      <section className="workspace catalog-workspace">
        <p className="eyebrow">ORGANISATION · BOUTIQUES ET DÉPÔTS</p>
        <h1>Accès par établissement</h1>
        <p className="lead">Affectez les membres à leurs boutiques ou dépôts. Dès qu’un établissement possède des affectations, seuls ses membres affectés et les administrateurs/responsables peuvent consulter et traiter ses opérations.</p>
        {params.status && messages[params.status] && <p className={["updated","assigned","removed"].includes(params.status)?"form-success":"form-error"}>{messages[params.status]}</p>}
        {groups.map(({workspace,locations,staff,assignments,error}) => {
          const canManage = ["owner","admin","manager"].includes(workspace.role);
          return (
            <section className="catalog-tenant" key={workspace.tenant_id}>
              <div className="catalog-heading"><div><h2>{workspace.tenant?.name ?? "Entreprise"}</h2><p>{locations.length} établissement(s) · Rôle : {workspace.role}</p></div></div>
              {error && <p className="form-error">Erreur de chargement : {error}</p>}
              {locations.map(location => {
                const assigned = assignments.filter(a=>a.location_id===location.id);
                const available = staff.filter(m=>!assigned.some(a=>a.user_id===m.user_id));
                return (
                  <article className="offline-panel" key={location.id}>
                    <div className="catalog-heading"><div><h3>{location.name}</h3><p>{location.code} · {location.location_type==="store"?"Boutique / point de vente":"Dépôt / entrepôt"} · {location.is_active?"Actif":"Inactif"}</p></div><span className="pill">{assigned.length} affectation(s)</span></div>
                    {canManage ? (
                      <>
                        <form action={updateStockLocation} className="catalog-form">
                          <input type="hidden" name="tenant_id" value={workspace.tenant_id}/>
                          <input type="hidden" name="location_id" value={location.id}/>
                          <div className="catalog-fields">
                            <label>Nom<input name="name" defaultValue={location.name} maxLength={100} required/></label>
                            <label>Code<input name="code" defaultValue={location.code} maxLength={32} required/></label>
                          </div>
                          <label>Type<select name="location_type" defaultValue={location.location_type}><option value="store">Boutique / point de vente</option><option value="warehouse">Dépôt / entrepôt</option></select></label>
                          <label>Adresse<input name="address" defaultValue={location.address} maxLength={250}/></label>
                          <label>Téléphone<input name="phone" defaultValue={location.phone} maxLength={40}/></label>
                          <label>Description<input name="description" defaultValue={location.description} maxLength={500}/></label>
                          <label className="checkbox-line"><input type="checkbox" name="is_active" defaultChecked={location.is_active}/> Établissement actif</label>
                          <button className="secondary" type="submit">Enregistrer l’établissement</button>
                        </form>
                        <div className="catalog-form">
                          <h4>Personnel affecté</h4>
                          {assigned.length ? assigned.map(a => {
                            const member=staff.find(m=>m.user_id===a.user_id);
                            return <div className="workspace-item" key={a.id}><div><strong>{member?.full_name ?? "Utilisateur"}</strong><small>{member?.role ?? ""}</small></div><form action={removeLocationMember}><input type="hidden" name="tenant_id" value={workspace.tenant_id}/><input type="hidden" name="assignment_id" value={a.id}/><button className="secondary" type="submit">Retirer</button></form></div>;
                          }) : <p className="catalog-help">Aucune affectation : l’accès reste partagé avec les membres de l’entreprise.</p>}
                          {available.length>0 && <form action={assignLocationMember} className="catalog-fields"><input type="hidden" name="tenant_id" value={workspace.tenant_id}/><input type="hidden" name="location_id" value={location.id}/><label>Affecter un utilisateur<select name="user_id" required defaultValue=""><option value="" disabled>Choisir un membre</option>{available.map(m=><option key={m.user_id} value={m.user_id}>{m.full_name} · {m.role}</option>)}</select></label><button className="primary" type="submit">Affecter</button></form>}
                        </div>
                      </>
                    ) : (
                      <p className="catalog-help">Consultation uniquement. Contactez le responsable de l’entreprise pour modifier les affectations.</p>
                    )}
                  </article>
                );
              })}
              {!locations.length && <p className="catalog-empty">Aucun établissement actif ou disponible.</p>}
            </section>
          );
        })}
      </section>
    </main>
  );
}
