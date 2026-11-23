"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function decimal(value: string, max: number) {
  const raw = value.trim().replace(",", ".");
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,3})?$/.test(raw)) return null;
  const amount = Number(raw);
  return Number.isFinite(amount) && amount >= 0 && amount <= max ? raw : null;
}
function fail(code: string): never {
  redirect("/app/pos?error=" + encodeURIComponent(code));
}

export async function openCashSession(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const tenantId = String(formData.get("tenant_id") ?? "");
  const locationId = String(formData.get("location_id") ?? "");
  const openingCash = decimal(String(formData.get("opening_cash") ?? "0"), 999999999999);
  if (!validUuid(tenantId) || !validUuid(locationId) || openingCash === null) fail("session");
  const { error } = await supabase.rpc("open_cash_session", {
    p_tenant_id: tenantId, p_location_id: locationId, p_opening_cash: openingCash,
  });
  if (error) {
    // Translate expected database failures into actionable messages without exposing SQL details.
    const message = error.message.toLowerCase();
    if (error.code === "23505" || message.includes("one_open_cash_session_per_cashier_location")) {
      fail("session_already_open");
    }
    if (message.includes("permission denied")) fail("session_permission");
    if (message.includes("invalid or inactive stock location")) fail("session_location");
    fail("session_failed");
  }
  revalidatePath("/app/pos");
  redirect("/app/pos?opened=1");
}

export async function closeCashSession(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const sessionId = String(formData.get("session_id") ?? "");
  const closingCash = decimal(String(formData.get("closing_cash") ?? ""), 999999999999);
  if (!validUuid(sessionId) || closingCash === null) fail("closing");
  const { error } = await supabase.rpc("close_cash_session", {
    p_session_id: sessionId, p_closing_cash: closingCash,
  });
  if (error) fail("closing");
  revalidatePath("/app/pos");
  redirect("/app/pos?closed=1");
}

export async function recordCashMovement(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const sessionId = String(formData.get("session_id") ?? "");
  const movementType = String(formData.get("movement_type") ?? "");
  const amount = decimal(String(formData.get("amount") ?? ""), 999999999999);
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 250);
  if (!validUuid(sessionId) || !["cash_in", "cash_out"].includes(movementType)
      || amount === null || Number(amount) <= 0 || reason.length < 2) fail("movement");
  const { error } = await supabase.rpc("create_cash_movement", {
    p_session_id: sessionId,
    p_movement_type: movementType,
    p_amount: amount,
    p_reason: reason,
  });
  if (error) fail("movement");
  revalidatePath("/app/pos");
  redirect("/app/pos?movement=1");
}

export async function checkoutSale(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenantId = String(formData.get("tenant_id") ?? "");
  const locationId = String(formData.get("location_id") ?? "");
  const sessionId = String(formData.get("session_id") ?? "");
  const clientSaleId = String(formData.get("client_sale_id") ?? "");
  const itemsRaw = String(formData.get("items_json") ?? "");
  const paymentsRaw = String(formData.get("payments_json") ?? "");
  if (![tenantId, locationId, sessionId, clientSaleId].every(validUuid)) fail("validation");
  if (itemsRaw.length > 12000 || paymentsRaw.length > 4000) fail("cart");

  let items: unknown;
  let payments: unknown;
  try {
    items = JSON.parse(itemsRaw);
    payments = JSON.parse(paymentsRaw);
  } catch { fail("cart"); }
  if (!Array.isArray(items) || items.length < 1 || items.length > 40) fail("cart");
  if (!Array.isArray(payments) || payments.length < 1 || payments.length > 4) fail("payment");

  const normalizedItems = items.map((item: unknown) => {
    if (!item || typeof item !== "object") return null;
    const row = item as { product_id?: unknown; quantity?: unknown };
    const productId = String(row.product_id ?? "");
    const quantity = decimal(String(row.quantity ?? ""), 1000000);
    if (!validUuid(productId) || quantity === null || Number(quantity) <= 0) return null;
    return { product_id: productId, quantity };
  });
  if (normalizedItems.some((item) => item === null)) fail("cart");

  const normalizedPayments = payments.map((payment: unknown) => {
    if (!payment || typeof payment !== "object") return null;
    const row = payment as { method?: unknown; amount?: unknown; reference?: unknown };
    const method = String(row.method ?? "");
    const amount = decimal(String(row.amount ?? ""), 999999999999);
    const reference = String(row.reference ?? "").trim().slice(0, 160);
    if (!["cash", "mobile_money", "card", "bank_transfer", "wave", "orange_money"].includes(method)
        || amount === null || Number(amount) <= 0
        || (["wave", "orange_money"].includes(method) && reference.length < 4)) return null;
    return { method, amount, reference: reference || null };
  });
  if (normalizedPayments.some((payment) => payment === null)) fail("payment");

  const { data: saleId, error } = await supabase.rpc("finalize_sale", {
    p_tenant_id: tenantId,
    p_location_id: locationId,
    p_cash_session_id: sessionId,
    p_client_sale_id: clientSaleId,
    p_items: normalizedItems,
    p_payments: normalizedPayments,
  });
  if (error || !validUuid(String(saleId ?? ""))) fail("checkout");
  revalidatePath("/app/pos");
  revalidatePath("/app/stock");
  redirect(`/app/pos/receipt/${saleId}`);
}
