"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requestSubscriptionChange(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenantId = String(formData.get("tenant_id") ?? "");
  const planCode = String(formData.get("plan_code") ?? "");
  const billingInterval = String(formData.get("billing_interval") ?? "monthly");
  const paymentMethod = String(formData.get("payment_method") ?? "wave");
  const paymentReference = String(formData.get("payment_reference") ?? "").trim().slice(0, 160);

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId)
      || !["starter", "pro", "business", "enterprise"].includes(planCode)
      || !["monthly", "yearly"].includes(billingInterval)
      || !["wave", "orange_money", "bank_transfer", "cash", "other"].includes(paymentMethod)) {
    redirect("/app/subscription?error=validation");
  }

  const { data: plan, error: planError } = await supabase.from("subscription_plans")
    .select("id").eq("code", planCode).eq("is_active", true).maybeSingle();
  if (planError || !plan) redirect("/app/subscription?error=validation");

  const { error } = await supabase.from("subscription_requests").insert({
    tenant_id: tenantId,
    requested_plan_id: plan.id,
    billing_interval: billingInterval,
    payment_method: paymentMethod,
    payment_reference: paymentReference,
    created_by: user.id,
  });
  if (error) redirect("/app/subscription?error=request");
  revalidatePath("/app/subscription");
  redirect("/app/subscription?requested=1");
}
