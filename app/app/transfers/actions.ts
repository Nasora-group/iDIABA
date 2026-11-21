"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function validTenant(value: FormDataEntryValue | null) {
  const id = String(value ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    redirect("/app/transfers?error=validation");
  }
  return id;
}

export async function createStockTransfer(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const tenant_id = validTenant(formData.get("tenant_id"));
  const client_transfer_id = String(formData.get("client_transfer_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(client_transfer_id)) redirect("/app/transfers?error=validation");
  const source_location_id = String(formData.get("source_location_id") ?? "");
  const destination_location_id = String(formData.get("destination_location_id") ?? "");
  const items: { product_id: string; quantity: number }[] = [];
  for (let i = 1; i <= 3; i++) {
    const product_id = String(formData.get("product_id_" + i) ?? "").trim();
    const raw = String(formData.get("quantity_" + i) ?? "").trim().replace(",", ".");
    if (!product_id && !raw) continue;
    const quantity = Number(raw);
    if (!product_id || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000000) {
      redirect("/app/transfers?error=validation");
    }
    items.push({ product_id, quantity });
  }
  if (!items.length) redirect("/app/transfers?error=validation");
  const mergedItems = [...items.reduce((map, item) => {
    map.set(item.product_id, (map.get(item.product_id) ?? 0) + item.quantity);
    return map;
  }, new Map<string, number>())].map(([product_id, quantity]) => ({ product_id, quantity }));
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 1000);
  const { error } = await supabase.rpc("create_stock_transfer", {
    p_tenant_id: tenant_id,
    p_source_location_id: source_location_id,
    p_destination_location_id: destination_location_id,
    p_items: mergedItems,
    p_client_transfer_id: client_transfer_id,
    p_notes: notes,
  });
  if (error) redirect("/app/transfers?error=create");
  revalidatePath("/app/transfers");
  revalidatePath("/app/stock");
  redirect("/app/transfers?status=created");
}

export async function shipStockTransfer(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const transfer_id = String(formData.get("transfer_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(transfer_id)) redirect("/app/transfers?error=validation");
  const { error } = await supabase.rpc("ship_stock_transfer", { p_transfer_id: transfer_id });
  if (error) redirect("/app/transfers?error=ship");
  revalidatePath("/app/transfers");
  revalidatePath("/app/stock");
  redirect("/app/transfers?status=shipped");
}

export async function receiveStockTransfer(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const transfer_id = String(formData.get("transfer_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(transfer_id)) redirect("/app/transfers?error=validation");
  const client_receipt_id = String(formData.get("client_receipt_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(client_receipt_id)) redirect("/app/transfers?error=validation");
  const items: { transfer_item_id: string; quantity: number }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("received_")) continue;
    const transfer_item_id = key.slice("received_".length);
    if (!/^[0-9a-f-]{36}$/i.test(transfer_item_id)) redirect("/app/transfers?error=validation");
    const raw = String(value ?? "").trim().replace(",", ".");
    if (!raw) continue;
    const quantity = Number(raw);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000000) {
      redirect("/app/transfers?error=validation");
    }
    items.push({ transfer_item_id, quantity });
  }
  if (!items.length) redirect("/app/transfers?error=validation");
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 1000);
  const { error } = await supabase.rpc("receive_stock_transfer", {
    p_transfer_id: transfer_id,
    p_client_receipt_id: client_receipt_id,
    p_items: items,
    p_notes: notes,
  });
  if (error) redirect("/app/transfers?error=receive");
  revalidatePath("/app/transfers");
  revalidatePath("/app/stock");
  redirect("/app/transfers?status=received");
}
