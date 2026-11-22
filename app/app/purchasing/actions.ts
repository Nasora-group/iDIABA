"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function fail(code: string): never {
  redirect("/app/purchasing?error=" + encodeURIComponent(code));
}
function required(value: FormDataEntryValue | null, max: number) {
  const result = String(value ?? "").trim();
  if (!result || result.length > max) fail("validation");
  return result;
}
function decimal(value: FormDataEntryValue | null, max: number, allowZero = false) {
  const raw = String(value ?? "").trim().replace(",", ".");
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,3})?$/.test(raw)) return null;
  const amount = Number(raw);
  return Number.isFinite(amount) && amount <= max && (allowZero ? amount >= 0 : amount > 0) ? raw : null;
}

export async function createSupplier(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const tenantId = String(formData.get("tenant_id") ?? "");
  if (!validUuid(tenantId)) fail("validation");
  const name = required(formData.get("name"), 160);
  const contact_name = String(formData.get("contact_name") ?? "").trim().slice(0, 120);
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 40);
  const email = String(formData.get("email") ?? "").trim().slice(0, 160);
  const address = String(formData.get("address") ?? "").trim().slice(0, 500);
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 1000);
  const { error } = await supabase.from("suppliers").insert({
    tenant_id: tenantId, name, contact_name, phone, email, address, notes,
  });
  if (error) fail("supplier");
  revalidatePath("/app/purchasing");
  redirect("/app/purchasing?created=supplier");
}

export async function createPurchaseOrder(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenantId = String(formData.get("tenant_id") ?? "");
  const supplierId = String(formData.get("supplier_id") ?? "");
  const locationId = String(formData.get("location_id") ?? "");
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 1000);
  if (![tenantId, supplierId, locationId].every(validUuid)) fail("validation");

  const productIds = formData.getAll("product_id");
  const quantities = formData.getAll("quantity");
  const unitCosts = formData.getAll("unit_cost");
  if (productIds.length < 1 || productIds.length > 20
      || productIds.length !== quantities.length || productIds.length !== unitCosts.length) fail("validation");

  const items: { product_id: string; quantity: string; unit_cost: string }[] = [];
  const seenProducts = new Set<string>();
  for (let i = 0; i < productIds.length; i += 1) {
    const productId = String(productIds[i] ?? "").trim();
    const quantityRaw = String(quantities[i] ?? "").trim();
    const costRaw = String(unitCosts[i] ?? "").trim();
    if (!productId && !quantityRaw && !costRaw) continue;
    const quantity = decimal(quantities[i], 1000000000);
    const unitCost = decimal(unitCosts[i], 999999999999, true);
    if (!validUuid(productId) || quantity === null || unitCost === null || seenProducts.has(productId)) fail("lines");
    seenProducts.add(productId);
    items.push({ product_id: productId, quantity, unit_cost: unitCost });
  }
  if (!items.length) fail("lines");

  const { error } = await supabase.rpc("create_purchase_order", {
    p_tenant_id: tenantId,
    p_supplier_id: supplierId,
    p_location_id: locationId,
    p_items: items,
    p_notes: notes,
  });
  if (error) fail("order");
  revalidatePath("/app/purchasing");
  redirect("/app/purchasing?created=order");
}

export async function receivePurchaseOrder(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const orderId = String(formData.get("purchase_order_id") ?? "");
  if (!validUuid(orderId)) fail("validation");

  const lineIds = formData.getAll("order_item_id");
  const quantities = formData.getAll("quantity");
  if (!lineIds.length || lineIds.length > 100 || lineIds.length !== quantities.length) fail("receipt");

  const seenLines = new Set<string>();
  const items: { order_item_id: string; quantity: string }[] = [];
  for (let i = 0; i < lineIds.length; i += 1) {
    const lineId = String(lineIds[i] ?? "");
    const rawQuantity = String(quantities[i] ?? "").trim();
    const quantity = decimal(rawQuantity === "" ? "0" : rawQuantity, 1000000000, true);
    if (!validUuid(lineId) || quantity === null || seenLines.has(lineId)) fail("receipt");
    seenLines.add(lineId);
    if (Number(quantity) > 0) items.push({ order_item_id: lineId, quantity });
  }
  if (!items.length) fail("receipt");

  const { error } = await supabase.rpc("receive_purchase_order", {
    p_purchase_order_id: orderId,
    p_items: items,
    p_notes: "Réception de marchandises",
  });
  if (error) fail("receipt");
  revalidatePath("/app/purchasing");
  revalidatePath("/app/stock");
  revalidatePath("/app");
  redirect("/app/purchasing?received=1");
}

export async function updateSupplier(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const tenantId = String(formData.get("tenant_id") ?? "");
  const supplierId = String(formData.get("supplier_id") ?? "");
  if (![tenantId, supplierId].every(validUuid)) fail("validation");
  const name = required(formData.get("name"), 160);
  const contact_name = String(formData.get("contact_name") ?? "").trim().slice(0, 120);
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 40);
  const email = String(formData.get("email") ?? "").trim().slice(0, 160);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("validation");
  const address = String(formData.get("address") ?? "").trim().slice(0, 500);
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 1000);
  const { error } = await supabase.from("suppliers").update({ name, contact_name, phone, email, address, notes })
    .eq("id", supplierId).eq("tenant_id", tenantId);
  if (error) fail("supplier_update");
  revalidatePath("/app/purchasing");
  redirect("/app/purchasing?updated=supplier");
}

export async function setSupplierActive(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const tenantId = String(formData.get("tenant_id") ?? "");
  const supplierId = String(formData.get("supplier_id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (![tenantId, supplierId].every(validUuid)) fail("validation");
  const { error } = await supabase.from("suppliers").update({ is_active: active })
    .eq("id", supplierId).eq("tenant_id", tenantId);
  if (error) fail("supplier_update");
  revalidatePath("/app/purchasing");
  redirect(active ? "/app/purchasing?restored=supplier" : "/app/purchasing?archived=supplier");
}


export async function createReorderPurchaseOrder(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const tenantId = String(formData.get("tenant_id") ?? "");
  const supplierId = String(formData.get("supplier_id") ?? "");
  const locationId = String(formData.get("location_id") ?? "");
  if (![tenantId, supplierId, locationId].every(validUuid)) fail("validation");

  const [thresholdResult, balanceResult, productResult] = await Promise.all([
    supabase.from("stock_reorder_thresholds").select("product_id,minimum_quantity").eq("tenant_id", tenantId).eq("location_id", locationId),
    supabase.from("stock_balances").select("product_id,quantity_on_hand").eq("tenant_id", tenantId).eq("location_id", locationId),
    supabase.from("products").select("id,purchase_price,is_active").eq("tenant_id", tenantId).eq("is_active", true),
  ]);
  if (thresholdResult.error || balanceResult.error || productResult.error) fail("reorder");
  const balances = new Map((balanceResult.data ?? []).map((row) => [row.product_id, Number(row.quantity_on_hand)]));
  const products = new Map((productResult.data ?? []).map((row) => [row.id, row]));
  const items = (thresholdResult.data ?? []).flatMap((threshold) => {
    const product = products.get(threshold.product_id);
    const available = balances.get(threshold.product_id) ?? 0;
    const need = Math.max(0, Number(threshold.minimum_quantity) - available);
    return product && need > 0 ? [{ product_id: threshold.product_id, quantity: String(need), unit_cost: String(product.purchase_price ?? 0) }] : [];
  });
  if (!items.length) fail("no_reorder");
  const { error } = await supabase.rpc("create_purchase_order", {
    p_tenant_id: tenantId, p_supplier_id: supplierId, p_location_id: locationId,
    p_items: items, p_notes: "Réapprovisionnement automatique suggéré par iDIABA (seuil minimum).",
  });
  if (error) fail("reorder");
  revalidatePath("/app/purchasing");
  revalidatePath("/app/stock");
  redirect("/app/purchasing?created=reorder");
}
