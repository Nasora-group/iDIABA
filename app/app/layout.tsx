import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { getActiveTenantId } from "@/lib/tenant";
import CompanyBar from "./company-bar";

type Relation<T> = T | T[] | null;
type Row = { tenant_id: string; role: string; tenant: Relation<{ name: string }> };

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <>{children}</>;

  const { data } = await supabase.from("tenant_memberships")
    .select("tenant_id,role,tenant:tenants(name)")
    .eq("user_id", user.id);

  const companies = ((data ?? []) as unknown as Row[])
    .map((row) => {
      const tenant = Array.isArray(row.tenant) ? row.tenant[0] : row.tenant;
      return { id: row.tenant_id, name: tenant?.name ?? "Entreprise", role: row.role };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const activeId = await getActiveTenantId(companies.map((company) => company.id));

  return (
    <>
      <CompanyBar companies={companies} activeId={activeId} />
      {children}
    </>
  );
}
