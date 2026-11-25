"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const fail = (code: string): never => redirect("/app/documents?error=" + encodeURIComponent(code));

export async function createCommercialDocument(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenantId = String(formData.get("tenant_id") ?? "");
  const customerRaw = String(formData.get("customer_id") ?? "");
  const documentType = String(formData.get("document_type") ?? "");
  const validUntilRaw = String(formData.get("valid_until") ?? "");
  const dueDateRaw = String(formData.get("due_date") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();
  const itemsRaw = String(formData.get("items_json") ?? "");

  if (!uuid(tenantId) || (customerRaw && !uuid(customerRaw))
      || !["quote", "sales_order"].includes(documentType)
      || notes.length > 2000 || itemsRaw.length > 30000) fail("validation");

  let items: unknown;
  try { items = JSON.parse(itemsRaw); } catch { fail("items"); }
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) fail("items");

  const normalized = items.map((item: unknown) => {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    const productId = String(row.product_id ?? "");
    const quantity = String(row.quantity ?? "").trim().replace(",", ".");
    const unitPrice = String(row.unit_price ?? "").trim().replace(",", ".");
    const taxRate = String(row.tax_rate ?? "0").trim().replace(",", ".");
    if (!uuid(productId) || !/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/.test(quantity)
        || Number(quantity) <= 0
        || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(unitPrice)
        || !/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(taxRate)
        || Number(taxRate) > 100) return null;
    return { product_id: productId, quantity, unit_price: unitPrice, tax_rate: taxRate };
  });
  if (normalized.some((item) => item === null)) fail("items");

  const { error } = await supabase.rpc("create_commercial_document", {
    p_tenant_id: tenantId,
    p_customer_id: customerRaw || null,
    p_document_type: documentType,
    p_valid_until: validUntilRaw || null,
    p_due_date: dueDateRaw || null,
    p_notes: notes,
    p_items: normalized,
  });
  if (error) fail("create");
  revalidatePath("/app/documents");
  revalidatePath("/app");
  redirect("/app/documents?created=1");
}

export async function updateCommercialDocumentStatus(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const documentId = String(formData.get("document_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!uuid(documentId) || !["sent", "accepted", "rejected", "cancelled"].includes(status)) fail("status");
  const { error } = await supabase.rpc("update_commercial_document_status", {
    p_document_id: documentId, p_status: status,
  });
  if (error) fail("status");
  revalidatePath("/app/documents");
  redirect("/app/documents?updated=1");
}

export async function convertQuoteToOrder(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const quoteId = String(formData.get("document_id") ?? "");
  if (!uuid(quoteId)) fail("convert");
  const { error } = await supabase.rpc("convert_quote_to_order", { p_quote_id: quoteId });
  if (error) fail("convert");
  revalidatePath("/app/documents");
  redirect("/app/documents?converted=1");
}

export async function createInvoiceFromSale(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const tenantId = String(formData.get("tenant_id") ?? "");
  const saleId = String(formData.get("sale_id") ?? "");
  if (!uuid(tenantId) || !uuid(saleId)) fail("invoice");
  const { error } = await supabase.rpc("create_invoice_from_sale", {
    p_tenant_id: tenantId, p_sale_id: saleId,
  });
  if (error) fail("invoice");
  revalidatePath("/app/documents");
  revalidatePath("/app/sales");
  redirect("/app/documents?invoice=1");
}
