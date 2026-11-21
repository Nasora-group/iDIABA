"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function tenantIdFrom(formData: FormData) {
  const value = String(formData.get("tenant_id") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("Espace entreprise invalide.");
  }
  return value;
}

function required(value: FormDataEntryValue | null, label: string, max: number) {
  const result = String(value ?? "").trim();
  if (!result || result.length > max) throw new Error(label + " obligatoire.");
  return result;
}

export async function createStockLocation(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenant_id = tenantIdFrom(formData);
  const name = required(formData.get("name"), "Le nom du dépôt", 100);
  const code = required(formData.get("code"), "Le code du dépôt", 32).toUpperCase();
  const description = String(formData.get("description") ?? "").trim().slice(0, 500);

  const { error } = await supabase.from("stock_locations").insert({ tenant_id, name, code, description });
  if (error) redirect("/app/stock?error=location");
  revalidatePath("/app/stock");
  redirect("/app/stock?created=location");
}

export async function recordStockMovement(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenant_id = tenantIdFrom(formData);
  const product_id = required(formData.get("product_id"), "Le produit", 36);
  const location_id = required(formData.get("location_id"), "Le dépôt", 36);
  const movement_type = String(formData.get("movement_type") ?? "adjustment");
  if (!["opening", "adjustment"].includes(movement_type)) redirect("/app/stock?error=validation");

  const raw = String(formData.get("quantity") ?? "").trim().replace(",", ".");
  if (!/^(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/.test(raw) || Number(raw) <= 0) {
    redirect("/app/stock?error=quantity");
  }
  const direction = String(formData.get("direction") ?? "in");
  if (!["in", "out"].includes(direction)) redirect("/app/stock?error=validation");
  const quantity_delta = direction === "in" ? raw : "-" + raw;
  const reference = String(formData.get("reference") ?? "").trim().slice(0, 80);
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);

  const { error } = await supabase.from("stock_movements").insert({
    tenant_id, product_id, location_id, movement_type, quantity_delta, reference, note, created_by: user.id,
  });
  if (error) redirect("/app/stock?error=movement");
  revalidatePath("/app/stock");
  redirect("/app/stock?created=movement");
}
