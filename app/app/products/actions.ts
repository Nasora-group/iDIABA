"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function requiredText(value: FormDataEntryValue | null, label: string, max: number) {
  const text = String(value ?? "").trim();
  if (!text || text.length > max) throw new Error(`${label} est obligatoire (maximum ${max} caractères).`);
  return text;
}

function nonNegativeAmount(value: FormDataEntryValue | null, label: string, max: number) {
  const raw = String(value ?? "0").trim().replace(",", ".");
  const amount = Number(raw);
  if (!raw || !Number.isFinite(amount) || amount < 0 || amount > max) {
    throw new Error(`${label} doit être un nombre positif valide.`);
  }
  return amount;
}

function validTenantId(value: FormDataEntryValue | null) {
  const tenantId = String(value ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId)) {
    throw new Error("Espace entreprise invalide.");
  }
  return tenantId;
}

export async function createCategory(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenantId = validTenantId(formData.get("tenant_id"));
  const name = requiredText(formData.get("name"), "Le nom de la catégorie", 80);
  const description = String(formData.get("description") ?? "").trim().slice(0, 500);
  const { error } = await supabase.from("product_categories").insert({
    tenant_id: tenantId,
    name,
    description,
  });
  if (error) redirect("/app/products?error=category");
  revalidatePath("/app/products");
  redirect("/app/products?created=category");
}

export async function createProduct(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenantId = validTenantId(formData.get("tenant_id"));
  const name = requiredText(formData.get("name"), "Le nom du produit", 160);
  const sku = requiredText(formData.get("sku"), "La référence SKU", 64).toUpperCase();
  const barcode = String(formData.get("barcode") ?? "").trim() || null;
  if (barcode && barcode.length > 80) redirect("/app/products?error=validation");
  const unit = requiredText(formData.get("unit"), "L'unité", 24);
  const productKind = String(formData.get("product_kind") ?? "product");
  if (!["product", "service"].includes(productKind)) redirect("/app/products?error=validation");
  const trackStock = productKind === "product" && formData.get("track_stock") === "on";
  const purchasePrice = nonNegativeAmount(formData.get("purchase_price"), "Le prix d'achat", 999999999999);
  const salePrice = nonNegativeAmount(formData.get("sale_price"), "Le prix de vente", 999999999999);
  const taxRate = nonNegativeAmount(formData.get("tax_rate"), "La taxe", 100);
  const categoryValue = String(formData.get("category_id") ?? "").trim();
  const categoryId = categoryValue || null;

  const { error } = await supabase.from("products").insert({
    tenant_id: tenantId,
    category_id: categoryId,
    name,
    sku,
    barcode,
    unit,
    product_kind: productKind,
    track_stock: trackStock,
    purchase_price: purchasePrice,
    sale_price: salePrice,
    tax_rate: taxRate,
    created_by: user.id,
  });
  if (error) redirect("/app/products?error=product");
  revalidatePath("/app/products");
  redirect("/app/products?created=product");
}

export async function archiveProduct(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenantId = validTenantId(formData.get("tenant_id"));
  const productId = String(formData.get("product_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(productId)) redirect("/app/products?error=validation");

  const { error } = await supabase.from("products")
    .update({ is_active: false })
    .eq("id", productId)
    .eq("tenant_id", tenantId);
  if (error) redirect("/app/products?error=archive");
  revalidatePath("/app/products");
  redirect("/app/products?archived=1");
}

export async function updateProduct(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenantId = validTenantId(formData.get("tenant_id"));
  const productId = String(formData.get("product_id") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId)) redirect("/app/products?error=validation");
  const name = requiredText(formData.get("name"), "Le nom du produit", 160);
  const sku = requiredText(formData.get("sku"), "La référence SKU", 64).toUpperCase();
  const barcode = String(formData.get("barcode") ?? "").trim() || null;
  if (barcode && barcode.length > 80) redirect("/app/products?error=validation");
  const unit = requiredText(formData.get("unit"), "L'unité", 24);
  const productKind = String(formData.get("product_kind") ?? "product");
  if (!["product", "service"].includes(productKind)) redirect("/app/products?error=validation");
  const trackStock = productKind === "product" && formData.get("track_stock") === "on";
  const purchasePrice = nonNegativeAmount(formData.get("purchase_price"), "Le prix d'achat", 999999999999);
  const salePrice = nonNegativeAmount(formData.get("sale_price"), "Le prix de vente", 999999999999);
  const taxRate = nonNegativeAmount(formData.get("tax_rate"), "La taxe", 100);
  const categoryValue = String(formData.get("category_id") ?? "").trim();
  const categoryId = categoryValue || null;
  if (categoryId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(categoryId)) redirect("/app/products?error=validation");

  const { error } = await supabase.from("products").update({
    category_id: categoryId, name, sku, barcode, unit,
    product_kind: productKind, track_stock: trackStock,
    purchase_price: purchasePrice, sale_price: salePrice, tax_rate: taxRate,
  }).eq("id", productId).eq("tenant_id", tenantId);
  if (error) redirect("/app/products?error=update");
  revalidatePath("/app/products");
  revalidatePath("/app/pos");
  revalidatePath("/app/stock");
  redirect("/app/products?updated=product");
}

export async function restoreProduct(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenantId = validTenantId(formData.get("tenant_id"));
  const productId = String(formData.get("product_id") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId)) redirect("/app/products?error=validation");
  const { error } = await supabase.from("products").update({ is_active: true }).eq("id", productId).eq("tenant_id", tenantId);
  if (error) redirect("/app/products?error=restore");
  revalidatePath("/app/products");
  revalidatePath("/app/pos");
  revalidatePath("/app/stock");
  redirect("/app/products?restored=1");
}

export async function updateCategory(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const tenantId = validTenantId(formData.get("tenant_id"));
  const categoryId = String(formData.get("category_id") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(categoryId)) redirect("/app/products?error=validation");
  const name = requiredText(formData.get("name"), "Le nom de la catégorie", 80);
  const description = String(formData.get("description") ?? "").trim().slice(0, 500);
  const { error } = await supabase.from("product_categories").update({ name, description }).eq("id", categoryId).eq("tenant_id", tenantId);
  if (error) redirect("/app/products?error=category_update");
  revalidatePath("/app/products");
  redirect("/app/products?categoryUpdated=1");
}

export async function setCategoryActive(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const tenantId = validTenantId(formData.get("tenant_id"));
  const categoryId = String(formData.get("category_id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(categoryId)) redirect("/app/products?error=validation");
  const { error } = await supabase.from("product_categories").update({ is_active: active }).eq("id", categoryId).eq("tenant_id", tenantId);
  if (error) redirect("/app/products?error=category_update");
  revalidatePath("/app/products");
  revalidatePath("/app/pos");
  redirect(active ? "/app/products?categoryRestored=1" : "/app/products?categoryArchived=1");
}
