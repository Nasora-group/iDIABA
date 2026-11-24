"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const validPermissions=[
 "cash_register","cash_manage","sales_read","sales_manage",
 "products_read","products_manage","stock_read","stock_manage",
 "purchasing_read","purchasing_manage","reports_read",
 "accounting_read","accounting_manage","audit_read"
] as const;
function done(status:string):never{redirect("/app/team/roles?status="+encodeURIComponent(status));}
export async function saveRoleProfile(formData:FormData){
 const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user)redirect("/login");
 const tenantId=String(formData.get("tenant_id")??"");const profileId=String(formData.get("profile_id")??"");
 const name=String(formData.get("name")??"").trim().slice(0,60);
 const permissions=[...new Set(formData.getAll("permissions").map(String).filter((p)=>validPermissions.includes(p as typeof validPermissions[number])))];
 if(!/^[0-9a-f-]{36}$/i.test(tenantId)||name.length<2||!permissions.length)done("validation");
 // The legacy role column remains for compatibility; all module access is now evaluated from permissions.
 const payload={tenant_id:tenantId,name,allowed_roles:["cashier"],permissions,created_by:user.id,updated_at:new Date().toISOString()};
 const query=profileId
  ?supabase.from("tenant_role_profiles").update({name,allowed_roles:["cashier"],permissions,updated_at:payload.updated_at}).eq("id",profileId).eq("tenant_id",tenantId)
  :supabase.from("tenant_role_profiles").insert(payload);
 const {error}=await query;if(error)done(error.message.includes("duplicate")?"duplicate":"error");
 revalidatePath("/app/team/roles");revalidatePath("/app/team");revalidatePath("/app");done("saved");
}
export async function deleteRoleProfile(formData:FormData){
 const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user)redirect("/login");
 const tenantId=String(formData.get("tenant_id")??"");const profileId=String(formData.get("profile_id")??"");
 if(!/^[0-9a-f-]{36}$/i.test(tenantId)||!/^[0-9a-f-]{36}$/i.test(profileId))done("validation");
 const {count}=await supabase.from("tenant_memberships").select("id",{count:"exact",head:true}).eq("custom_role_profile_id",profileId).eq("tenant_id",tenantId);
 if((count??0)>0)done("inuse");
 const {error}=await supabase.from("tenant_role_profiles").delete().eq("tenant_id",tenantId).eq("id",profileId);
 if(error)done("error");revalidatePath("/app/team/roles");revalidatePath("/app");done("deleted");
}
