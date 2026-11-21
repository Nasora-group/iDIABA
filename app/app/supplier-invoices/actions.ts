"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function fail(code: string): never {
  redirect("/app/supplier-invoices?error=" + encodeURIComponent(code));
}
function uuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function amount(value: string) {
  const raw = value.trim().replace(",", ".");
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 999999999999 ? raw : null;
}
function nonNegativeAmount(value: string) {
  const raw = value.trim().replace(",", ".");
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 999999999999 ? raw : null;
}

export async function createSupplierInvoice(fd: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenantId = String(fd.get("tenant_id") ?? "");
  const supplierId = String(fd.get("supplier_id") ?? "");
  const orderId = String(fd.get("purchase_order_id") ?? "");
  const invoiceNumber = String(fd.get("invoice_number") ?? "").trim();
  const invoiceDate = String(fd.get("invoice_date") ?? "");
  const dueDateRaw = String(fd.get("due_date") ?? "").trim();
  const dueDate = dueDateRaw || null;
  const invoiceAmount = amount(String(fd.get("amount") ?? ""));
  const taxAmount = nonNegativeAmount(String(fd.get("tax_amount") ?? "0"));
  const description = String(fd.get("description") ?? "").trim().slice(0, 250);

  if (!uuid(tenantId) || !uuid(supplierId) || !uuid(orderId)
    || invoiceNumber.length < 1 || invoiceNumber.length > 100
    || !validDate(invoiceDate) || (dueDate !== null && !validDate(dueDate))
    || (dueDate !== null && dueDate < invoiceDate) || !invoiceAmount || taxAmount === null
    || Number(taxAmount) > Number(invoiceAmount)) fail("invoice");

  const { error } = await supabase.rpc("create_supplier_invoice", {
    p_tenant_id: tenantId,
    p_supplier_id: supplierId,
    p_purchase_order_id: orderId,
    p_invoice_number: invoiceNumber,
    p_invoice_date: invoiceDate,
    p_due_date: dueDate,
    p_amount: invoiceAmount,
    p_description: description,
    p_tax_amount: taxAmount,
  });
  if (error) fail(error.code === "23505" ? "duplicate" : "invoice");
  revalidatePath("/app/supplier-invoices");
  revalidatePath("/app/accounting");
  revalidatePath("/app/reports");
  redirect("/app/supplier-invoices?created=1");
}

export async function recordSupplierPayment(fd: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const invoiceId = String(fd.get("invoice_id") ?? "");
  const accountId = String(fd.get("payment_account_id") ?? "");
  const paidAt = String(fd.get("paid_at") ?? "");
  const paymentAmount = amount(String(fd.get("amount") ?? ""));
  const reference = String(fd.get("reference") ?? "").trim().slice(0, 100);
  const cashSessionId = String(fd.get("cash_session_id") ?? "").trim() || null;

  if (!uuid(invoiceId) || !uuid(accountId) || !validDate(paidAt) || !paymentAmount) fail("payment");

  const { error } = await supabase.rpc("record_supplier_invoice_payment", {
    p_invoice_id: invoiceId,
    p_payment_account_id: accountId,
    p_amount: paymentAmount,
    p_paid_at: paidAt,
    p_reference: reference,
    p_cash_session_id: cashSessionId,
  });
  if (error) fail("payment");
  revalidatePath("/app/supplier-invoices");
  revalidatePath("/app/accounting");
  revalidatePath("/app/reports");
  redirect("/app/supplier-invoices?paid=1");
}
