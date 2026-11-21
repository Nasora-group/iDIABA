"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function updateCompanySettings(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenant_id = String(formData.get("tenant_id") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenant_id)) {
    redirect("/app/company-settings?status=invalid");
  }
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
  revalidatePath("/app");
  revalidatePath("/app/company-settings");
  redirect("/app/company-settings?status=saved");
}
