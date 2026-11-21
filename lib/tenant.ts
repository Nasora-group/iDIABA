import { cookies } from "next/headers";

/**
 * Active company ("tenant") selection.
 *
 * The cookie is only a UI preference. It never grants access: every query still
 * goes through Supabase RLS, and the cookie value is ignored unless it matches
 * one of the companies the signed-in user actually belongs to.
 */
export const ACTIVE_TENANT_COOKIE = "idiaba_tenant";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Only allow in-app relative paths as redirect targets. */
export function safeAppPath(value: string | null | undefined, fallback = "/app"): string {
  if (!value) return fallback;
  if (!value.startsWith("/app") || value.startsWith("//") || value.includes("\\") || value.length > 300) return fallback;
  if (value !== "/app" && !value.startsWith("/app/") && !value.startsWith("/app?")) return fallback;
  return value;
}

/**
 * Resolves the active company among the ones the user belongs to.
 * Falls back to a deterministic choice so layout and pages always agree.
 */
export async function getActiveTenantId(tenantIds: string[]): Promise<string | null> {
  if (!tenantIds.length) return null;
  const stored = (await cookies()).get(ACTIVE_TENANT_COOKIE)?.value;
  if (stored && tenantIds.includes(stored)) return stored;
  return [...tenantIds].sort()[0];
}

/** Keeps only the membership of the active company. Pass the user's full membership list. */
export async function scopeToActiveTenant<T extends { tenant_id: string }>(memberships: T[]): Promise<T[]> {
  const activeId = await getActiveTenantId(memberships.map((item) => item.tenant_id));
  return memberships.filter((item) => item.tenant_id === activeId);
}
