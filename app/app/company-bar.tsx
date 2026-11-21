"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Plus, Users } from "lucide-react";
import { ROLE_LABELS } from "@/lib/tenant-labels";
import { switchCompany } from "./company/actions";

type Company = { id: string; name: string; role: string };

export default function CompanyBar({ companies, activeId }: { companies: Company[]; activeId: string | null }) {
  const pathname = usePathname();
  const active = companies.find((company) => company.id === activeId) ?? null;

  return (
    <div className="company-bar">
      <div className="company-bar-inner">
        <div className="company-bar-current">
          <Building2 size={16} aria-hidden="true" />
          {companies.length > 1 ? (
            <form action={switchCompany}>
              <input type="hidden" name="return_to" value={pathname} />
              <label className="company-bar-label">
                <span>Entreprise active</span>
                <select
                  name="tenant_id"
                  defaultValue={activeId ?? ""}
                  onChange={(event) => event.currentTarget.form?.requestSubmit()}
                  aria-label="Changer d'entreprise"
                >
                  {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
                </select>
              </label>
              <noscript><button className="secondary" type="submit">Changer</button></noscript>
            </form>
          ) : (
            <strong className="company-bar-name">{active?.name ?? "Aucune entreprise"}</strong>
          )}
          {active && <span className="role">{ROLE_LABELS[active.role] ?? active.role}</span>}
        </div>
        <nav className="company-bar-links" aria-label="Gestion des entreprises">
          {active && <Link href="/app/company"><Users size={14} aria-hidden="true" /> Entreprise &amp; équipe</Link>}
          <Link href="/app/company/new"><Plus size={14} aria-hidden="true" /> Nouvelle entreprise</Link>
        </nav>
      </div>
    </div>
  );
}
