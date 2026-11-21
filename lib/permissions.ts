/**
 * Module access per role. Client-safe (no server imports).
 *
 * This matrix mirrors the WRITE policies in supabase/migrations (RLS stays the
 * source of truth for what can be changed). Reading is open to every member of
 * a company at database level, so hiding modules here is a usability and
 * privacy layer on top: each role only sees the tools it actually works with.
 */
export type ModuleKey =
  | "products" | "stock" | "inventory" | "pos" | "purchasing" | "customers"
  | "accounting" | "subscription" | "reports" | "audit" | "company" | "overview";

const ADMINS = ["owner", "admin"];

export const MODULE_ROLES: Record<ModuleKey, readonly string[]> = {
  products: [...ADMINS, "manager", "stock", "viewer"],
  stock: [...ADMINS, "manager", "stock", "viewer"],
  inventory: [...ADMINS, "manager", "stock", "viewer"],
  purchasing: [...ADMINS, "manager", "stock", "viewer"],
  pos: [...ADMINS, "manager", "cashier"],
  customers: [...ADMINS, "manager", "cashier", "viewer"],
  accounting: [...ADMINS, "manager", "accountant", "viewer"],
  subscription: ADMINS,
  reports: ADMINS,
  audit: ADMINS,
  overview: ADMINS,
  company: ["owner", "admin", "manager", "cashier", "stock", "accountant", "viewer"],
};

export const MODULE_TITLES: Record<ModuleKey, string> = {
  products: "Catalogue produits",
  stock: "Stocks & dépôts",
  inventory: "Inventaires physiques",
  purchasing: "Achats & fournisseurs",
  pos: "Caisse & ventes",
  customers: "Clients & retours",
  accounting: "Comptabilité",
  subscription: "Abonnements & limites",
  reports: "Rapports de gestion",
  audit: "Journal d'audit",
  overview: "Vue consolidée",
  company: "Entreprise & équipe",
};

export function canAccess(role: string | null | undefined, module: ModuleKey): boolean {
  return !!role && MODULE_ROLES[module].includes(role);
}
