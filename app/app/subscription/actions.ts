"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://idiaba.onrender.com").replace(/\/$/, "");

export async function startSubscriptionPayment(formData: FormData) {
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
      || !["wave", "orange_money"].includes(paymentMethod)) {
    redirect("/app/subscription?error=validation");
  }

  const { data: plan, error: planError } = await supabase.from("subscription_plans")
    .select("id").eq("code", planCode).eq("is_active", true).maybeSingle();
  if (planError || !plan) redirect("/app/subscription?error=validation");

  if (paymentMethod === "orange_money") {
    const { error } = await supabase.from("subscription_requests").insert({
      tenant_id: tenantId,
      requested_plan_id: plan.id,
      billing_interval: billingInterval,
      payment_method: "orange_money",
      payment_reference: paymentReference,
      created_by: user.id,
    });
    if (error) redirect("/app/subscription?error=request");
    revalidatePath("/app/subscription");
    redirect("/app/subscription?requested=1&method=orange_money");
  }

  const apiKey = process.env.WAVE_API_KEY;
  if (!apiKey) redirect("/app/subscription?error=wave_unconfigured");

  const { data: paymentRows, error: paymentError } = await supabase.rpc("create_subscription_payment", {
    p_tenant_id: tenantId,
    p_plan_code: planCode,
    p_billing_interval: billingInterval,
    p_provider: "wave",
    p_idempotency_key: randomUUID(),
  });
  if (paymentError) redirect("/app/subscription?error=payment_request");

  const payment = Array.isArray(paymentRows) ? paymentRows[0] : paymentRows;
  const paymentId = String(payment?.payment_id ?? "");
  const amount = Number(payment?.amount_fcfa);
  if (!/^[0-9a-f-]{36}$/i.test(paymentId) || !Number.isSafeInteger(amount) || amount <= 0) {
    redirect("/app/subscription?error=payment_request");
  }

  const { data: existingPayment } = await supabase.from("subscription_payments")
    .select("checkout_url,status").eq("id", paymentId).maybeSingle();
  if (existingPayment?.status === "processing" && existingPayment.checkout_url) {
    redirect(existingPayment.checkout_url);
  }

  let response: Response;
  try {
    response = await fetch("https://api.wave.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: String(amount),
        currency: "XOF",
        client_reference: paymentId,
        success_url: `${APP_URL}/app/subscription?payment=processing`,
        error_url: `${APP_URL}/app/subscription?payment=failed`,
      }),
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
  } catch {
    redirect("/app/subscription?error=wave_unavailable");
  }

  if (!response.ok) redirect("/app/subscription?error=wave_unavailable");
  const checkout = await response.json() as { id?: string; wave_launch_url?: string };
  if (!checkout.id || !checkout.wave_launch_url) redirect("/app/subscription?error=wave_unavailable");

  const checkoutUrl = new URL(checkout.wave_launch_url);
  if (checkoutUrl.protocol !== "https:" || checkoutUrl.hostname !== "pay.wave.com") {
    redirect("/app/subscription?error=wave_unavailable");
  }

  const { error: attachError } = await supabase.rpc("attach_subscription_payment_checkout", {
    p_payment_id: paymentId,
    p_provider_reference: checkout.id,
    p_checkout_url: checkoutUrl.toString(),
  });
  if (attachError) redirect("/app/subscription?error=wave_unavailable");

  redirect(checkoutUrl.toString());
}

export async function requestSubscriptionChange(formData: FormData) {
  return startSubscriptionPayment(formData);
}
