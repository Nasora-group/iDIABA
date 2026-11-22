"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function receiveStockLot(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenantId = String(formData.get("tenant_id") ?? "");
  const productId = String(formData.get("product_id") ?? "");
  const locationId = String(formData.get("location_id") ?? "");
  const lotCode = String(formData.get("lot_code") ?? "").trim();
  const expiryDate = String(formData.get("expiry_date") ?? "").trim();
  const rawQuantity = String(formData.get("quantity") ?? "").trim().replace(",", ".");
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);

  if (![tenantId, productId, locationId].every((value) => uuid.test(value))
      || !lotCode || lotCode.length > 80
      || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)
      || !/^(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/.test(rawQuantity)
      || Number(rawQuantity) <= 0) {
    redirect("/app/lots?error=validation");
  }

  const { error } = await supabase.rpc("receive_stock_lot", {
    p_tenant_id: tenantId,
    p_product_id: productId,
    p_location_id: locationId,
    p_lot_code: lotCode,
    p_expiry_date: expiryDate,
    p_quantity: rawQuantity,
    p_note: note,
  });
  if (error) redirect("/app/lots?error=" + encodeURIComponent(error.message.slice(0, 100)));
  revalidatePath("/app/lots");
  revalidatePath("/app/stock");
  revalidatePath("/app/pos");
  redirect("/app/lots?received=1");
}
