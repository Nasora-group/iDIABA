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
  const productId = String(formData.get("product_id") ?? "");
  const quantity = decimal(formData.get("quantity"), 1000000000);
  const unitCost = decimal(formData.get("unit_cost"), 999999999999, true);
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 1000);
  if (![tenantId, supplierId, locationId, productId].every(validUuid) || quantity === null || unitCost === null) fail("validation");

  const { error } = await supabase.rpc("create_purchase_order", {
    p_tenant_id: tenantId,
    p_supplier_id: supplierId,
    p_location_id: locationId,
    p_items: [{ product_id: productId, quantity, unit_cost: unitCost }],
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

  const { data: lines, error: linesError } = await supabase
    .from("purchase_order_items")
    .select("id,quantity,received_quantity")
    .eq("purchase_order_id", orderId);
  if (linesError || !lines?.length) fail("receipt");
  const items = lines
    .map((line) => ({
      order_item_id: line.id,
      quantity: (Number(line.quantity) - Number(line.received_quantity)).toFixed(3),
    }))
    .filter((line) => Number(line.quantity) > 0);
  if (!items.length) fail("receipt");

  const { error } = await supabase.rpc("receive_purchase_order", {
    p_purchase_order_id: orderId,
    p_items: items,
    p_notes: "Réception du reliquat de commande",
  });
  if (error) fail("receipt");
  revalidatePath("/app/purchasing");
  revalidatePath("/app/stock");
  redirect("/app/purchasing?received=1");
}
