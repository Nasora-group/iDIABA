"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function uuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function fail(code: string): never {
  redirect("/app/customers?error=" + encodeURIComponent(code));
}

export async function createCustomer(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenantId = String(formData.get("tenant_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  if (!uuid(tenantId) || name.length < 2 || name.length > 160
      || phone.length > 40 || email.length > 254 || address.length > 500 || notes.length > 1000) fail("customer");

  const { error } = await supabase.rpc("create_customer", {
    p_tenant_id: tenantId,
    p_name: name,
    p_phone: phone,
    p_email: email,
    p_address: address,
    p_notes: notes,
  });
  if (error) fail("customer");
  revalidatePath("/app/customers");
  redirect("/app/customers?created=customer");
}

export async function attachCustomerToSale(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenantId = String(formData.get("tenant_id") ?? "");
  const saleId = String(formData.get("sale_id") ?? "");
  const customerId = String(formData.get("customer_id") ?? "");
  if (![tenantId, saleId, customerId].every(uuid)) fail("assignment");

  const { error } = await supabase.rpc("set_sale_customer", {
    p_tenant_id: tenantId,
    p_sale_id: saleId,
    p_customer_id: customerId,
  });
  if (error) fail("assignment");
  revalidatePath("/app/customers");
  revalidatePath("/app/pos");
  redirect("/app/customers?created=assignment");
}

export async function registerSaleReturn(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenantId = String(formData.get("tenant_id") ?? "");
  const saleItemId = String(formData.get("sale_item_id") ?? "");
  const clientReturnId = String(formData.get("client_return_id") ?? "");
  const rawQuantity = String(formData.get("quantity") ?? "").trim().replace(",", ".");
  const refundMethod = String(formData.get("refund_method") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (![tenantId, saleItemId, clientReturnId].every(uuid)
      || !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,3})?$/.test(rawQuantity)
      || Number(rawQuantity) <= 0
      || !["cash", "mobile_money", "card", "bank_transfer", "credit_note"].includes(refundMethod)
      || reason.length < 2 || reason.length > 250) fail("return");

  const { error } = await supabase.rpc("register_sale_return", {
    p_tenant_id: tenantId,
    p_sale_item_id: saleItemId,
    p_quantity: rawQuantity,
    p_refund_method: refundMethod,
    p_reason: reason,
    p_client_return_id: clientReturnId,
  });
  if (error) fail("return");
  revalidatePath("/app/customers");
  revalidatePath("/app/stock");
  revalidatePath("/app/pos");
  redirect("/app/customers?created=return");
}

export async function updateCustomer(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const tenantId = String(formData.get("tenant_id") ?? "");
  const customerId = String(formData.get("customer_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  if (![tenantId, customerId].every(uuid) || name.length < 2 || name.length > 160 || phone.length > 40 || email.length > 254 || address.length > 500 || notes.length > 1000) fail("customer");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("customer");
  const { error } = await supabase.rpc("update_customer", { p_tenant_id: tenantId, p_customer_id: customerId, p_name: name, p_phone: phone, p_email: email, p_address: address, p_notes: notes });
  if (error) fail("customer_update");
  revalidatePath("/app/customers");
  revalidatePath("/app/pos");
  redirect("/app/customers?updated=customer");
}

export async function setCustomerActive(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const tenantId = String(formData.get("tenant_id") ?? "");
  const customerId = String(formData.get("customer_id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (![tenantId, customerId].every(uuid)) fail("customer_status");
  const { error } = await supabase.rpc("set_customer_active", { p_tenant_id: tenantId, p_customer_id: customerId, p_active: active });
  if (error) fail("customer_status");
  revalidatePath("/app/customers");
  revalidatePath("/app/pos");
  redirect(active ? "/app/customers?restored=customer" : "/app/customers?archived=customer");
}
