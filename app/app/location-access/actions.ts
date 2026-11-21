"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function go(status: string): never {
  redirect("/app/location-access?status=" + encodeURIComponent(status));
}
async function authorize(tenantId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase.from("tenant_memberships")
    .select("role").eq("tenant_id", tenantId).eq("user_id", user.id).maybeSingle();
  if (!membership || !["owner", "admin", "manager"].includes(membership.role)) go("forbidden");
  return { supabase, user };
}
export async function assignLocationMember(formData: FormData) {
  const tenantId = String(formData.get("tenant_id") ?? "");
  const locationId = String(formData.get("location_id") ?? "");
  const userId = String(formData.get("user_id") ?? "");
  if (![tenantId, locationId, userId].every(value => uuid.test(value))) go("validation");
  const { supabase, user } = await authorize(tenantId);
  const { error } = await supabase.from("stock_location_memberships").insert({
    tenant_id: tenantId, location_id: locationId, user_id: userId, assigned_by: user.id,
  });
  if (error) go(error.code === "23505" ? "exists" : "error");
  revalidatePath("/app/location-access");
  revalidatePath("/app/stock");
  go("assigned");
}
export async function removeLocationMember(formData: FormData) {
  const tenantId = String(formData.get("tenant_id") ?? "");
  const locationId = String(formData.get("location_id") ?? "");
  const userId = String(formData.get("user_id") ?? "");
  if (![tenantId, locationId, userId].every(value => uuid.test(value))) go("validation");
  const { supabase } = await authorize(tenantId);
  const { error } = await supabase.from("stock_location_memberships").delete()
    .eq("tenant_id", tenantId).eq("location_id", locationId).eq("user_id", userId);
  if (error) go("error");
  revalidatePath("/app/location-access");
  revalidatePath("/app/stock");
  go("removed");
}
