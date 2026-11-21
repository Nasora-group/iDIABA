"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
export async function inviteMember(formData:FormData){
 const supabase=await createClient();
 const {data:{user}}=await supabase.auth.getUser();
 if(!user) redirect("/login");
 const tenantId=String(formData.get("tenant_id")??"");
 const email=String(formData.get("email")??"").trim().toLowerCase();
 const fullName=String(formData.get("full_name")??"").trim().slice(0,120);
 const role=String(formData.get("role")??"cashier");
 if(!/^[0-9a-f-]{36}$/i.test(tenantId)||!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)||!["admin","manager","cashier","stock","accountant","viewer"].includes(role)) redirect("/app/team?status=validation");
 const {data,error}=await supabase.functions.invoke("invite-tenant-member",{body:{tenant_id:tenantId,email,full_name:fullName,role}});
 if(error) redirect("/app/team?status=inviteerror");
 if(data?.error) redirect("/app/team?status="+encodeURIComponent(data.error));
 revalidatePath("/app/team");revalidatePath("/app");
 redirect("/app/team?status=invited");
}
