"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const allowedBusinessTypes = new Set([
  "general", "grocery", "hardware", "fashion", "pharmacy", "restaurant",
  "auto_parts", "electronics", "beauty", "wholesale", "services", "other",
]);
const coreModules = ["catalog", "sales", "stock", "purchases", "customers", "cash", "reports"];
const optionalModules = new Set([
  "inventory", "locations", "transfers", "supplier_invoices",
  "accounting", "audit",
]);

export async function updateCompanySettings(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenant_id = String(formData.get("tenant_id") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenant_id)) {
    redirect("/app/company-settings?status=invalid");
  }

  const business_type = String(formData.get("business_type") ?? "general");
  if (!allowedBusinessTypes.has(business_type)) redirect("/app/company-settings?status=invalid");
  const selectedModules = formData.getAll("enabled_modules").map(String).filter((module) => optionalModules.has(module));
  const enabled_modules = [...coreModules, ...new Set(selectedModules)];

  const name = String(formData.get("name") ?? "").trim();
  const rccm = String(formData.get("rccm") ?? "").trim().slice(0, 80);
  const ninea = String(formData.get("ninea") ?? "").trim().slice(0, 80);
  const address = String(formData.get("address") ?? "").trim().slice(0, 250);
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 40);
  const currency_code = String(formData.get("currency_code") ?? "XOF").trim().toUpperCase();
  const taxRaw = String(formData.get("default_tax_rate") ?? "18").trim().replace(",", ".");
  const default_tax_rate = Number(taxRaw);
  const logoRaw = String(formData.get("logo_url") ?? "").trim();
  if (name.length < 2 || name.length > 120 || !/^[A-Z]{3}$/.test(currency_code)
    || !Number.isFinite(default_tax_rate) || default_tax_rate < 0 || default_tax_rate > 100) {
    redirect("/app/company-settings?status=invalid");
  }

  let logo_url: string | null = null;
  if (logoRaw) {
    try {
      const parsed = new URL(logoRaw);
      if (parsed.protocol !== "https:") throw new Error("Invalid logo URL");
      logo_url = parsed.toString();
    } catch {
      redirect("/app/company-settings?status=invalid");
    }
  }

  const { data, error } = await supabase.from("tenants").update({
    name, rccm, ninea, address, phone, currency_code, default_tax_rate, logo_url, updated_at: new Date().toISOString(),
  }).eq("id", tenant_id).select("id").maybeSingle();
  if (error || !data) redirect("/app/company-settings?status=denied");

  const { error: profileError } = await supabase.from("tenant_business_profiles").upsert({
    tenant_id, business_type, enabled_modules, updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id" });
  if (profileError) redirect("/app/company-settings?status=denied");

  revalidatePath("/app");
  revalidatePath("/app/company-settings");
  redirect("/app/company-settings?status=saved");
}
