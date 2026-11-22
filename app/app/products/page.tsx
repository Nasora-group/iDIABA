import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { archiveProduct, createCategory, createProduct, restoreProduct, updateProduct } from "./actions";

type Workspace = {
  tenant_id: string;
  role: string;
  tenant: { id: string; name: string; slug: string } | null;
};
type Category = { id: string; name: string };
type Product = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  category_id: string | null;
  unit: string;
  purchase_price: number;
  sale_price: number;
  tax_rate: number;
  is_active: boolean;
  category: { name: string } | null;
};

export const dynamic = "force-dynamic";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; updated?: string; archived?: string; restored?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membershipData, error: membershipError } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, role, tenant:tenants(id,name,slug)")
    .eq("user_id", user.id);
  const workspaces = (membershipData ?? []) as unknown as Workspace[];

  const catalogs = await Promise.all(workspaces.map(async (workspace) => {
    const [categoryResult, productResult] = await Promise.all([
      supabase.from("product_categories").select("id,name").eq("tenant_id", workspace.tenant_id).eq("is_active", true).order("name"),
      supabase.from("products").select("id,name,sku,barcode,category_id,unit,purchase_price,sale_price,tax_rate,is_active,category:product_categories(name)").eq("tenant_id", workspace.tenant_id).order("name"),
    ]);
    return {
      workspace,
      categories: (categoryResult.data ?? []) as unknown as Category[],
      products: (productResult.data ?? []) as unknown as Product[],
      error: categoryResult.error?.message ?? productResult.error?.message ?? null,
    };
  }));

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="mark">i</span><span>iDIABA</span></div>
        <nav className="product-nav"><Link href="/app">Mon espace</Link><span>Catalogue produits</span><Link href="/app/stock">Stocks</Link><Link href="/app/inventory">Inventaires</Link><Link href="/app/pos">Caisse</Link><Link href="/app/purchasing">Achats</Link><Link href="/app/accounting">Comptabilité</Link></nav>
      </header>
      <section className="workspace catalog-workspace">
        <p className="eyebrow">SPRINT 2 · CATALOGUE</p>
        <h1>Produits & catégories</h1>
        <p className="lead">Centralisez vos références, codes-barres, unités, prix et taux de taxe par entreprise.</p>
        {params.created && <p className="form-success">Enregistrement effectué.</p>}
        {params.updated && <p className="form-success">Produit mis à jour.</p>}
        {params.archived && <p className="form-success">Produit archivé. Son historique est conservé.</p>}\n        {params.restored && <p className="form-success">Produit réactivé.</p>}
        {params.error && <p className="form-error">Opération impossible. Vérifiez les champs, les doublons SKU/code-barres et vos droits d&apos;accès.</p>}
        {membershipError && <p className="form-error">Impossible de charger les espaces entreprise.</p>}
        {!catalogs.length && <p>Aucun espace entreprise n&apos;est associé à ce compte.</p>}
        {catalogs.map(({ workspace, categories, products, error }) => (
          <section className="catalog-tenant" key={workspace.tenant_id}>
            <div className="catalog-heading">
              <div><h2>{workspace.tenant?.name ?? "Entreprise"}</h2><p>Rôle : {workspace.role}</p></div>
              <span className="pill">{products.length} référence(s)</span>
            </div>
            {error && <p className="form-error">Erreur de chargement : {error}</p>}
            <div className="catalog-forms">
              <form action={createProduct} className="catalog-form">
                <h3>Ajouter un produit</h3>
                <input type="hidden" name="tenant_id" value={workspace.tenant_id} />
                <label>Nom du produit<input name="name" required maxLength={160} placeholder="Ex. Riz parfumé 5 kg" /></label>
                <div className="catalog-fields">
                  <label>Référence SKU<input name="sku" required maxLength={64} placeholder="RIZ-5KG" /></label>
                  <label>Code-barres<input name="barcode" maxLength={80} placeholder="Optionnel" /></label>
                </div>
                <div className="catalog-fields">
                  <label>Catégorie<select name="category_id" defaultValue=""><option value="">Sans catégorie</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
                  <label>Unité<input name="unit" required maxLength={24} defaultValue="unité" /></label>
                </div>
                <div className="catalog-fields">
                  <label>Prix d&apos;achat (FCFA)<input name="purchase_price" type="number" min="0" step="0.01" defaultValue="0" required /></label>
                  <label>Prix de vente (FCFA)<input name="sale_price" type="number" min="0" step="0.01" defaultValue="0" required /></label>
                </div>
                <label>Taxe (%)<input name="tax_rate" type="number" min="0" max="100" step="0.01" defaultValue="0" required /></label>
                <button className="primary" type="submit">Enregistrer le produit</button>
              </form>
              <form action={createCategory} className="catalog-form catalog-category-form">
                <h3>Créer une catégorie</h3>
                <input type="hidden" name="tenant_id" value={workspace.tenant_id} />
                <label>Nom<input name="name" required maxLength={80} placeholder="Ex. Épicerie" /></label>
                <label>Description<input name="description" maxLength={500} placeholder="Optionnel" /></label>
                <button className="secondary" type="submit">Ajouter la catégorie</button>
                <p className="catalog-help">{categories.length} catégorie(s) active(s)</p>
              </form>
            </div>
            <div className="catalog-table-wrap">
              <h3>Références enregistrées</h3>
              {products.length ? (
                <table className="catalog-table">
                  <thead><tr><th>Produit</th><th>SKU / code-barres</th><th>Catégorie</th><th>Achat</th><th>Vente</th><th>Taxe</th><th>État</th><th /></tr></thead>
                  <tbody>{products.map((product) => (
                    <tr key={product.id}>
                      <td><strong>{product.name}</strong><small>{product.unit}</small></td>
                      <td>{product.sku}<small>{product.barcode ?? "Sans code-barres"}</small></td>
                      <td>{product.category?.name ?? "—"}</td>
                      <td>{Number(product.purchase_price).toLocaleString("fr-FR")} F</td>
                      <td>{Number(product.sale_price).toLocaleString("fr-FR")} F</td>
                      <td>{Number(product.tax_rate)} %</td>
                      <td><span className={product.is_active ? "catalog-state" : "catalog-state inactive"}>{product.is_active ? "Actif" : "Archivé"}</span></td>
                      <td><details className="product-edit-details"><summary>Modifier</summary><form action={updateProduct} className="catalog-form catalog-edit-form"><input type="hidden" name="tenant_id" value={workspace.tenant_id} /><input type="hidden" name="product_id" value={product.id} /><label>Nom<input name="name" defaultValue={product.name} required maxLength={160} /></label><div className="catalog-fields"><label>SKU<input name="sku" defaultValue={product.sku} required maxLength={64} /></label><label>Code-barres<input name="barcode" defaultValue={product.barcode ?? ""} maxLength={80} /></label></div><div className="catalog-fields"><label>Catégorie<select name="category_id" defaultValue={product.category_id ?? ""}><option value="">Sans catégorie</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Unité<input name="unit" defaultValue={product.unit} required maxLength={24} /></label></div><div className="catalog-fields"><label>Achat<input name="purchase_price" type="number" min="0" step="0.01" defaultValue={product.purchase_price} required /></label><label>Vente<input name="sale_price" type="number" min="0" step="0.01" defaultValue={product.sale_price} required /></label></div><label>Taxe (%)<input name="tax_rate" type="number" min="0" max="100" step="0.01" defaultValue={product.tax_rate} required /></label><button className="secondary" type="submit">Enregistrer</button></form></details>{product.is_active && <form action={archiveProduct}><input type="hidden" name="tenant_id" value={workspace.tenant_id} /><input type="hidden" name="product_id" value={product.id} /><button className="archive-button" type="submit">Archiver</button></form>}{!product.is_active && <form action={restoreProduct}><input type="hidden" name="tenant_id" value={workspace.tenant_id} /><input type="hidden" name="product_id" value={product.id} /><button className="secondary" type="submit">Réactiver</button></form>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              ) : <p className="catalog-empty">Aucun produit pour le moment. Ajoutez votre première référence ci-dessus.</p>}
            </div>
          </section>
        ))}
      </section>
    </main>
  );
}
