"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function fail(code: string): never {
  redirect("/app/inventory?error=" + encodeURIComponent(code));
}

function quantity(value: string) {
  const raw = value.trim().replace(",", ".");
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,3})?$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1000000000 ? raw : null;
}

export async function startInventoryCount(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenantId = String(formData.get("tenant_id") ?? "");
  const locationId = String(formData.get("location_id") ?? "");
  const reference = String(formData.get("reference") ?? "").trim().slice(0, 80);
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 500);
  if (!validUuid(tenantId) || !validUuid(locationId)) fail("validation");

  const { data, error } = await supabase.rpc("create_inventory_count", {
    p_tenant_id: tenantId,
    p_location_id: locationId,
    p_reference: reference,
    p_notes: notes,
  });
  if (error || !data) fail("create");
  revalidatePath("/app/inventory");
  redirect("/app/inventory?created=1");
}

export async function setInventoryCountLine(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const countId = String(formData.get("inventory_count_id") ?? "");
  const productId = String(formData.get("product_id") ?? "");
  const countedQuantity = quantity(String(formData.get("counted_quantity") ?? ""));
  if (!validUuid(countId) || !validUuid(productId) || countedQuantity === null) fail("line");

  const { error } = await supabase.rpc("set_inventory_count_line", {
    p_inventory_count_id: countId,
    p_product_id: productId,
    p_counted_quantity: countedQuantity,
  });
  if (error) fail("line");
  revalidatePath("/app/inventory");
  redirect("/app/inventory?line=1");
}

export async function postInventoryCount(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const countId = String(formData.get("inventory_count_id") ?? "");
  if (!validUuid(countId)) fail("post");

  const { error } = await supabase.rpc("post_inventory_count", {
    p_inventory_count_id: countId,
  });
  if (error) {
    const code = error.message?.toLowerCase().includes("stock changed") ? "stale" : "post";
    fail(code);
  }
  revalidatePath("/app/inventory");
  revalidatePath("/app/stock");
  revalidatePath("/app");
  redirect("/app/inventory?posted=1");
}
