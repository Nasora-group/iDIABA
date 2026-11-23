"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const allowed=["admin","manager","cashier","stock","accountant","viewer"];
function go(code:string):never{redirect("/app/team?status="+encodeURIComponent(code));}
export async function manageMember(formData:FormData){
 const supabase=await createClient();
 const {data:{user}}=await supabase.auth.getUser();
 if(!user) redirect("/login");
 const tenantId=String(formData.get("tenant_id")??"");
 const action=String(formData.get("action")??"add");
 const email=String(formData.get("email")??"").trim().toLowerCase();
 const fullName=String(formData.get("full_name")??"").trim().slice(0,120);
 const role=String(formData.get("role")??"cashier");
 const validAccount=/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||/^[0-9a-f-]{36}$/i.test(email);
 if(!/^[0-9a-f-]{36}$/i.test(tenantId)||!["add","update","remove"].includes(action)||!validAccount||(action!=="remove"&&!allowed.includes(role))) go("validation");
 const {data:targetId,error}=await supabase.rpc("manage_tenant_member",{p_tenant_id:tenantId,p_email:email,p_full_name:fullName,p_role:action==="remove"?"cashier":role,p_action:action});
 if(error) go(error.message.includes("quota")?"quota":error.message.includes("No account")?"noaccount":"error");
 if(action!=="remove"){
  const profileId=String(formData.get("custom_role_profile_id")??"").trim()||null;
  if(targetId){
   const {error:profileError}=await supabase.rpc("set_tenant_member_custom_role_profile",{p_tenant_id:tenantId,p_user_id:targetId,p_profile_id:profileId});
   if(profileError) go("profileerror");
  }
 }
 revalidatePath("/app/team");revalidatePath("/app");
 go(action==="add"?"added":action==="update"?"updated":"removed");
}
export async function inviteMember(formData:FormData){
 const supabase=await createClient();
 const {data:{user}}=await supabase.auth.getUser();
 if(!user) redirect("/login");
 const tenantId=String(formData.get("tenant_id")??"");
 const email=String(formData.get("email")??"").trim().toLowerCase();
 const fullName=String(formData.get("full_name")??"").trim().slice(0,120);
 const role=String(formData.get("role")??"cashier");
 if(!/^[0-9a-f-]{36}$/i.test(tenantId)||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||!allowed.includes(role)) go("validation");
 const {data,error}=await supabase.functions.invoke("invite-tenant-member",{body:{tenant_id:tenantId,email,full_name:fullName,role}});
 if(error){
  let detail="";
  const response=(error as {context?:Response}).context;
  if(response&&typeof response.clone==="function"){
   const payload=await response.clone().json().catch(()=>null) as {error?:string}|null;
   detail=payload?.error??"";
  }
  if(/quota|limite d’utilisateurs/i.test(detail)) go("quota");
  if(/abonnement|formule|essai|paiement/i.test(detail)) go("subscription");
  go("inviteerror");
 }
 if(data?.error){
  if(/quota|limite d’utilisateurs/i.test(String(data.error))) go("quota");
  if(/abonnement|formule|essai|paiement/i.test(String(data.error))) go("subscription");
  go("inviteerror");
 }
 revalidatePath("/app/team");revalidatePath("/app");
 go("invited");
}
