"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_TENANT_COOKIE, isUuid, safeAppPath } from "@/lib/tenant";
import { ASSIGNABLE_ROLES } from "@/lib/tenant-labels";

const INVITE_TOKEN = /^[0-9a-f]{64}$/;

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

async function rememberCompany(tenantId: string) {
  (await cookies()).set(ACTIVE_TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

function failTo(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message.slice(0, 240))}`);
}

function readTenantId(value: FormDataEntryValue | null, path: string) {
  const tenantId = String(value ?? "");
  if (!isUuid(tenantId)) failTo(path, "Entreprise invalide.");
  return tenantId;
}

function readRole(value: FormDataEntryValue | null, path: string) {
  const role = String(value ?? "");
  if (!(ASSIGNABLE_ROLES as readonly string[]).includes(role)) failTo(path, "Rôle invalide.");
  return role;
}

function slugify(name: string) {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return slug || "entreprise";
}

export async function switchCompany(formData: FormData) {
  const { supabase, user } = await requireUser();
  const tenantId = String(formData.get("tenant_id") ?? "");
  const destination = safeAppPath(String(formData.get("return_to") ?? ""));
  if (isUuid(tenantId)) {
    // Only remember companies the user truly belongs to.
    const { data } = await supabase.from("tenant_memberships")
      .select("tenant_id").eq("tenant_id", tenantId).eq("user_id", user.id).maybeSingle();
    if (data) await rememberCompany(tenantId);
  }
  revalidatePath("/app", "layout");
  redirect(destination);
}

export async function createCompany(formData: FormData) {
  const { supabase } = await requireUser();
  const path = "/app/company/new";
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 120) failTo(path, "Le nom de l'entreprise doit contenir entre 2 et 120 caractères.");

  const base = slugify(name);
  let lastMessage = "Création impossible. Réessayez dans quelques instants.";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${crypto.randomUUID().slice(0, 6)}`;
    const { data, error } = await supabase.rpc("create_tenant", { workspace_name: name, workspace_slug: slug });
    if (!error && typeof data === "string") {
      await rememberCompany(data);
      revalidatePath("/app", "layout");
      redirect("/app?company=created");
    }
    if (error?.code === "23505") continue; // slug already taken, retry with a suffix
    lastMessage = error?.message ?? lastMessage;
    break;
  }
  failTo(path, lastMessage);
}

export async function renameCompany(formData: FormData) {
  const { supabase } = await requireUser();
  const path = "/app/company";
  const tenantId = readTenantId(formData.get("tenant_id"), path);
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 120) failTo(path, "Le nom de l'entreprise doit contenir entre 2 et 120 caractères.");
  const { data, error } = await supabase.from("tenants")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", tenantId).select("id");
  if (error || !data?.length) failTo(path, "Modification impossible. Seuls les propriétaires et administrateurs peuvent renommer l'entreprise.");
  revalidatePath("/app", "layout");
  redirect(`${path}?saved=1`);
}

export async function inviteMember(formData: FormData) {
  const { supabase } = await requireUser();
  const path = "/app/company";
  const tenantId = readTenantId(formData.get("tenant_id"), path);
  const role = readRole(formData.get("role"), path);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const { error } = await supabase.rpc("create_invitation", { target_tenant: tenantId, invitee_email: email, invitee_role: role });
  if (error) failTo(path, error.message);
  revalidatePath(path);
  redirect(`${path}?invited=1`);
}

export async function revokeInvitation(formData: FormData) {
  const { supabase } = await requireUser();
  const path = "/app/company";
  const invitationId = String(formData.get("invitation_id") ?? "");
  if (!isUuid(invitationId)) failTo(path, "Invitation invalide.");
  const { error } = await supabase.rpc("revoke_invitation", { target_invitation: invitationId });
  if (error) failTo(path, error.message);
  revalidatePath(path);
  redirect(`${path}?revoked=1`);
}

export async function changeMemberRole(formData: FormData) {
  const { supabase } = await requireUser();
  const path = "/app/company";
  const tenantId = readTenantId(formData.get("tenant_id"), path);
  const userId = String(formData.get("user_id") ?? "");
  if (!isUuid(userId)) failTo(path, "Membre invalide.");
  const role = readRole(formData.get("role"), path);
  const { error } = await supabase.rpc("set_member_role", { target_tenant: tenantId, target_user: userId, new_role: role });
  if (error) failTo(path, error.message);
  revalidatePath("/app", "layout");
  redirect(`${path}?updated=1`);
}

export async function removeMember(formData: FormData) {
  const { supabase } = await requireUser();
  const path = "/app/company";
  const tenantId = readTenantId(formData.get("tenant_id"), path);
  const userId = String(formData.get("user_id") ?? "");
  if (!isUuid(userId)) failTo(path, "Membre invalide.");
  const { error } = await supabase.rpc("remove_member", { target_tenant: tenantId, target_user: userId });
  if (error) failTo(path, error.message);
  revalidatePath("/app", "layout");
  redirect(`${path}?removed=1`);
}

export async function leaveCompany(formData: FormData) {
  const { supabase, user } = await requireUser();
  const path = "/app/company";
  const tenantId = readTenantId(formData.get("tenant_id"), path);
  const { error } = await supabase.rpc("remove_member", { target_tenant: tenantId, target_user: user.id });
  if (error) failTo(path, error.message);
  (await cookies()).delete(ACTIVE_TENANT_COOKIE);
  revalidatePath("/app", "layout");
  redirect("/app?left=1");
}

export async function acceptInvitation(formData: FormData) {
  const { supabase } = await requireUser();
  const token = String(formData.get("token") ?? "");
  if (!INVITE_TOKEN.test(token)) failTo("/app", "Invitation invalide.");
  const path = `/app/invite/${token}`;
  const { data, error } = await supabase.rpc("accept_invitation", { invite_token: token });
  if (error || typeof data !== "string") failTo(path, error?.message ?? "Impossible d'accepter l'invitation.");
  await rememberCompany(data);
  revalidatePath("/app", "layout");
  redirect("/app?joined=1");
}
