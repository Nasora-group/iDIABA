"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function isPlatformAdmin(user: { app_metadata?: Record<string, unknown> } | null) {
  return user?.app_metadata?.role === "platform_admin";
}

export async function updateSubscriptionPlan(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isPlatformAdmin(user)) redirect("/app");

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  const description = String(formData.get("description") ?? "").trim().slice(0, 240);
  const priceMonthly = String(formData.get("price_monthly_fcfa") ?? "").trim();
  const priceYearly = String(formData.get("price_yearly_fcfa") ?? "").trim();
  const maxUsers = String(formData.get("max_users") ?? "").trim();
  const maxLocations = String(formData.get("max_locations") ?? "").trim();
  const maxProducts = String(formData.get("max_products") ?? "").trim();
  const maxSales = String(formData.get("max_monthly_sales") ?? "").trim();

  const numeric = (value: string, nullable = true) => {
    if (!value && nullable) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN;
  };
  const monthly = numeric(priceMonthly);
  const yearly = numeric(priceYearly);
  const quota = (value: string) => {
    if (!value) return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : Number.NaN;
  };
  const users = quota(maxUsers);
  const locations = quota(maxLocations);
  const products = quota(maxProducts);
  const sales = quota(maxSales);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !name || [monthly,yearly,users,locations,products,sales].some(Number.isNaN)) {
    redirect("/app/platform-admin?error=validation");
  }

  const { error } = await supabase.from("subscription_plans").update({
    name, description,
    price_monthly_fcfa: monthly,
    price_yearly_fcfa: yearly,
    max_users: users,
    max_locations: locations,
    max_products: products,
    max_monthly_sales: sales,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) redirect("/app/platform-admin?error=save");
  revalidatePath("/app/platform-admin");
  revalidatePath("/app/subscription");
  redirect("/app/platform-admin?saved=1");
}

export async function reviewSubscriptionRequest(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isPlatformAdmin(user)) redirect("/app");

  const requestId = String(formData.get("request_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("admin_note") ?? "").trim().slice(0, 500);
  if (!/^[0-9a-f-]{36}$/i.test(requestId) || !["approve", "reject"].includes(decision)) {
    redirect("/app/platform-admin?error=validation");
  }

  const { error } = await supabase.rpc("review_subscription_request", {
    p_request_id: requestId,
    p_decision: decision,
    p_admin_note: note,
  });
  if (error) redirect("/app/platform-admin?error=review");
  revalidatePath("/app/platform-admin");
  revalidatePath("/app/subscription");
  redirect("/app/platform-admin?reviewed=1");
}
