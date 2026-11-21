import { describe, expect, it, vi } from "vitest";
import { MODULE_ROLES, canAccess, type ModuleKey } from "@/lib/permissions";
import { cleanLine, escapeHtml, invitationEmail } from "@/lib/email";

const cookieStore = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "idiaba_tenant" && cookieStore.value ? { value: cookieStore.value } : undefined) }),
}));

import { getActiveTenantId, isUuid, safeAppPath, scopeToActiveTenant } from "@/lib/tenant";

describe("safeAppPath (redirect safety)", () => {
  it("accepts in-app paths", () => {
    expect(safeAppPath("/app")).toBe("/app");
    expect(safeAppPath("/app/products")).toBe("/app/products");
    expect(safeAppPath("/app/invite/abc")).toBe("/app/invite/abc");
  });
  it.each(["//evil.com", "https://evil.com", "/appx", "/app\\evil", "/login", "", null, undefined, "/app/" + "a".repeat(400)])(
    "rejects %s",
    (value) => expect(safeAppPath(value as string | null | undefined)).toBe("/app"),
  );
});

describe("isUuid", () => {
  it("validates identifiers", () => {
    expect(isUuid("8f14e45f-ceea-467a-9575-4b8f3d7a8c2e")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("' or 1=1 --")).toBe(false);
  });
});

describe("active company resolution", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";

  it("uses the cookie when it belongs to the user", async () => {
    cookieStore.value = B;
    expect(await getActiveTenantId([A, B])).toBe(B);
  });
  it("ignores a cookie for a company the user is not a member of", async () => {
    cookieStore.value = "33333333-3333-4333-8333-333333333333";
    expect(await getActiveTenantId([B, A])).toBe(A); // deterministic fallback: smallest id
  });
  it("returns null without memberships", async () => {
    cookieStore.value = A;
    expect(await getActiveTenantId([])).toBeNull();
  });
  it("scopes memberships to the active company only", async () => {
    cookieStore.value = B;
    const scoped = await scopeToActiveTenant([{ tenant_id: A, role: "owner" }, { tenant_id: B, role: "cashier" }]);
    expect(scoped).toEqual([{ tenant_id: B, role: "cashier" }]);
  });
});

describe("module permissions", () => {
  const allModules = Object.keys(MODULE_ROLES) as ModuleKey[];
  it("gives owners and admins every module", () => {
    for (const key of allModules) {
      expect(canAccess("owner", key)).toBe(true);
      expect(canAccess("admin", key)).toBe(true);
    }
  });
  it("keeps billing, reports, audit and consolidated view to owners/admins", () => {
    for (const key of ["subscription", "reports", "audit", "overview"] as const) {
      for (const role of ["manager", "cashier", "stock", "accountant", "viewer"]) expect(canAccess(role, key)).toBe(false);
    }
  });
  it("matches each working role to its tools", () => {
    expect(canAccess("cashier", "pos")).toBe(true);
    expect(canAccess("cashier", "accounting")).toBe(false);
    expect(canAccess("cashier", "stock")).toBe(false);
    expect(canAccess("stock", "purchasing")).toBe(true);
    expect(canAccess("stock", "pos")).toBe(false);
    expect(canAccess("accountant", "accounting")).toBe(true);
    expect(canAccess("accountant", "pos")).toBe(false);
  });
  it("denies unknown or missing roles", () => {
    expect(canAccess(undefined, "products")).toBe(false);
    expect(canAccess("hacker", "company")).toBe(false);
  });
});

describe("invitation e-mail", () => {
  it("escapes HTML and strips control characters", () => {
    expect(escapeHtml(`<script>"x"&'y'</script>`)).toBe("&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;");
    expect(cleanLine("Shop\r\nBcc: evil@x.com")).not.toMatch(/[\r\n]/);
  });
  it("never injects raw markup from company or inviter names", () => {
    const mail = invitationEmail({ companyName: `<img src=x onerror=alert(1)>`, inviterName: "A\nB", roleLabel: "Caissier", link: "https://app.test/app/invite/abc" });
    expect(mail.html).not.toContain("<img");
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.text).toContain("https://app.test/app/invite/abc");
  });
});
