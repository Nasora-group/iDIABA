import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import DocumentsForm from "./documents-form";
import { convertQuoteToOrder, updateCommercialDocumentStatus } from "./actions";

export const dynamic = "force-dynamic";

type Membership = { tenant_id: string; role: string; custom_role_profile_id: string | null; tenant: { name: string; currency_code: string } | null };
type Customer = { id: string; name: string };
type Product = { id: string; name: string; sku: string; sale_price: number | string; tax_rate: number | string };
type Document = { id: string; document_number: string; document_type: string; status: string; customer_id: string | null; customer: { name: string } | null; issue_date: string; valid_until: string | null; total: number | string; paid_amount: number | string; currency_code: string; source_sale_id: string | null };

const money = (value: number | string) => Number(value).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const typeLabel: Record<string,string> = { quote: "Devis", sales_order: "Commande client", invoice: "Facture" };
const statusLabel: Record<string,string> = { draft: "Brouillon", sent: "Envoyé", accepted: "Accepté", rejected: "Refusé", converted: "Converti", cancelled: "Annulé", issued: "Émise", partially_paid: "Partiellement réglée", paid: "Réglée" };
const legacyPermissions: Record<string,string[]> = { manager: ["sales_read","sales_manage"], cashier: ["sales_read"], accountant: ["sales_read"], viewer: ["sales_read"] };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ created?: string; updated?: string; converted?: string; invoice?: string; error?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membershipsRows } = await supabase.from("tenant_memberships").select("tenant_id,role,custom_role_profile_id,tenant:tenants(name,currency_code)").eq("user_id", user.id);
  const memberships = (membershipsRows ?? []) as unknown as Membership[];
  const profileIds = memberships.map(row => row.custom_role_profile_id).filter((id): id is string => Boolean(id));
  const { data: profiles } = profileIds.length ? await supabase.from("tenant_role_profiles").select("id,permissions,allowed_roles").in("id", profileIds) : { data: [] as { id: string; permissions: string[]; allowed_roles: string[] }[] };
  const profileMap = new Map((profiles ?? []).map(profile => [profile.id, profile]));

  const workspaces = await Promise.all(memberships.map(async membership => {
    const profile = membership.custom_role_profile_id ? profileMap.get(membership.custom_role_profile_id) : null;
    const granted = profile?.permissions?.length ? profile.permissions : (profile?.allowed_roles ?? [membership.role]).flatMap(role => legacyPermissions[role] ?? []);
    const canManage = ["owner","admin"].includes(membership.role) || granted.includes("sales_manage");
    const canRead = canManage || granted.includes("sales_read");
    if (!canRead) return { membership, canManage, customers: [] as Customer[], products: [] as Product[], documents: [] as Document[], error: null };
    const [customers, products, documents] = await Promise.all([
      canManage
        ? supabase.from("customers").select("id,name").eq("tenant_id",membership.tenant_id).eq("is_active",true).order("name").limit(500)
        : Promise.resolve({ data: [], error: null }),
      canManage
        ? supabase.from("products").select("id,name,sku,sale_price,tax_rate").eq("tenant_id",membership.tenant_id).eq("is_active",true).order("name").limit(1000)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("commercial_documents").select("id,document_number,document_type,status,customer_id,customer:customers(name),issue_date,valid_until,total,paid_amount,currency_code,source_sale_id").eq("tenant_id",membership.tenant_id).order("created_at",{ascending:false}).limit(200),
    ]);
    return { membership, canManage, customers: (customers.data ?? []) as Customer[], products: (products.data ?? []) as Product[], documents: (documents.data ?? []) as unknown as Document[], error: customers.error?.message ?? products.error?.message ?? documents.error?.message ?? null };
  }));

  return (
    <main className="shell">
      <header className="topbar"><Link href="/app" className="brand"><span className="mark">i</span><span>iDIABA</span></Link><nav className="product-nav"><Link href="/app">Mon espace</Link><Link href="/app/pos">Caisse</Link><Link href="/app/sales">Ventes</Link><span>Devis & documents</span></nav></header>
      <section className="workspace catalog-workspace">
        <p className="eyebrow">GESTION COMMERCIALE</p><h1>Devis, commandes et factures</h1>
        <p className="lead">Préparez vos devis, transformez-les en commandes et retrouvez les factures émises depuis les ventes de la caisse. Les stocks et la comptabilité restent pilotés par les opérations de vente validées.</p>
        {params.created && <p className="form-success">Document enregistré.</p>}
        {params.updated && <p className="form-success">Statut du devis mis à jour.</p>}
        {params.converted && <p className="form-success">Devis converti en commande client.</p>}
        {params.invoice && <p className="form-success">Facture créée à partir de la vente.</p>}
        {params.error && <p className="form-error">Opération impossible. Vérifiez les droits, les articles, le client et le statut du document.</p>}
        {workspaces.map(({ membership, canManage, customers, products, documents, error }) => (
          <section className="catalog-tenant" key={membership.tenant_id}>
            <div className="catalog-heading"><div><h2>{membership.tenant?.name ?? "Entreprise"}</h2><p>{documents.length} document(s) récent(s)</p></div><span className="pill">{canManage ? "Gestion commerciale" : "Consultation"}</span></div>
            {error && <p className="form-error">Chargement incomplet : {error}</p>}
            {canManage && <DocumentsForm tenantId={membership.tenant_id} customers={customers} products={products} currency={membership.tenant?.currency_code ?? "XOF"} />}
            <div className="catalog-table-wrap">
              <h3>Historique des documents</h3>
              {documents.length ? <table className="catalog-table"><thead><tr><th>Document</th><th>Client</th><th>Date</th><th>État</th><th>Total</th><th>Actions</th></tr></thead><tbody>
                {documents.map(document => <tr key={document.id}>
                  <td><strong>{document.document_number}</strong><small>{typeLabel[document.document_type] ?? document.document_type}{document.valid_until ? " · Valide jusqu'au " + new Date(document.valid_until).toLocaleDateString("fr-FR") : ""}</small></td>
                  <td>{document.customer?.name ?? "Client comptoir"}</td>
                  <td>{new Date(document.issue_date).toLocaleDateString("fr-FR")}</td>
                  <td><span className="catalog-state">{statusLabel[document.status] ?? document.status}</span></td>
                  <td><strong>{money(document.total)} {document.currency_code}</strong>{document.document_type === "invoice" && <small>Réglé : {money(document.paid_amount)} {document.currency_code}</small>}</td>
                  <td>{canManage && document.document_type === "quote" && ["draft","sent","accepted"].includes(document.status) ? <div className="commercial-document-actions">
                    {document.status === "draft" && <form action={updateCommercialDocumentStatus}><input type="hidden" name="document_id" value={document.id}/><input type="hidden" name="status" value="sent"/><button className="secondary" type="submit">Marquer envoyé</button></form>}
                    <form action={updateCommercialDocumentStatus}><input type="hidden" name="document_id" value={document.id}/><input type="hidden" name="status" value="accepted"/><button className="secondary" type="submit">Accepter</button></form>
                    <form action={convertQuoteToOrder}><input type="hidden" name="document_id" value={document.id}/><button className="primary" type="submit">Convertir en commande</button></form>
                  </div> : document.document_type === "invoice" ? "Issue de la caisse" : "—"}</td>
                </tr>)}
              </tbody></table> : <p className="catalog-empty">Aucun document. Créez votre premier devis ou commande ci-dessus.</p>}
            </div>
          </section>
        ))}
      </section>
    </main>
  );
}
