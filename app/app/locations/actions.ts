"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function validUuid(value: FormDataEntryValue | null) {
  const id = String(value ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    redirect("/app/locations?status=validation");
  }
  return id;
}

async function managerContext(tenantId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase.from("tenant_memberships")
    .select("role").eq("tenant_id", tenantId).eq("user_id", user.id).maybeSingle();
  if (!membership || !["owner","admin","manager"].includes(membership.role)) {
    redirect("/app/locations?status=denied");
  }
  return { supabase, user };
}

export async function updateStockLocation(formData: FormData) {
  const tenant_id = validUuid(formData.get("tenant_id"));
  const location_id = validUuid(formData.get("location_id"));
  const { supabase } = await managerContext(tenant_id);
  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const location_type = String(formData.get("location_type") ?? "");
  const address = String(formData.get("address") ?? "").trim().slice(0,250);
  const phone = String(formData.get("phone") ?? "").trim().slice(0,40);
  const description = String(formData.get("description") ?? "").trim().slice(0,500);
  const is_active = formData.get("is_active") === "on";
  if (name.length < 2 || name.length > 100 || !/^[A-Z0-9_-]{2,32}$/.test(code)
    || !["store","warehouse"].includes(location_type)) {
    redirect("/app/locations?status=validation");
  }
  const { error } = await supabase.from("stock_locations").update({
    name,code,location_type,address,phone,description,is_active,
  }).eq("id",location_id).eq("tenant_id",tenant_id);
  if (error) redirect("/app/locations?status=error");
  revalidatePath("/app/locations");
  revalidatePath("/app/stock");
  revalidatePath("/app/pos");
  redirect("/app/locations?status=updated");
}

export async function assignLocationMember(formData: FormData) {
  const tenant_id = validUuid(formData.get("tenant_id"));
  const location_id = validUuid(formData.get("location_id"));
  const user_id = validUuid(formData.get("user_id"));
  const { supabase, user } = await managerContext(tenant_id);
  const { error } = await supabase.from("stock_location_memberships").insert({
    tenant_id,location_id,user_id,assigned_by:user.id,
  });
  if (error) redirect("/app/locations?status=assignment_error");
  revalidatePath("/app/locations");
  revalidatePath("/app/stock");
  revalidatePath("/app/pos");
  revalidatePath("/app/transfers");
  redirect("/app/locations?status=assigned");
}

export async function removeLocationMember(formData: FormData) {
  const tenant_id = validUuid(formData.get("tenant_id"));
  const assignment_id = validUuid(formData.get("assignment_id"));
  const { supabase } = await managerContext(tenant_id);
  const { error } = await supabase.from("stock_location_memberships").delete()
    .eq("id",assignment_id).eq("tenant_id",tenant_id);
  if (error) redirect("/app/locations?status=assignment_error");
  revalidatePath("/app/locations");
  revalidatePath("/app/stock");
  revalidatePath("/app/pos");
  revalidatePath("/app/transfers");
  redirect("/app/locations?status=removed");
}
