import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const allowedRoles=["admin","manager","cashier","stock","accountant","viewer"];
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return json(405,{error:"Méthode non autorisée"});
  try{
    const url=Deno.env.get("SUPABASE_URL")!;
    const anon=Deno.env.get("SUPABASE_ANON_KEY")!;
    const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader=req.headers.get("Authorization");
    if(!authHeader?.startsWith("Bearer ")) return json(401,{error:"Connexion requise"});
    const callerClient=createClient(url,anon,{global:{headers:{Authorization:authHeader}}});
    const {data:{user},error:authError}=await callerClient.auth.getUser();
    if(authError||!user) return json(401,{error:"Session invalide"});
    const admin=createClient(url,service,{auth:{autoRefreshToken:false,persistSession:false}});
    const body=await req.json();
    const tenantId=String(body.tenant_id??"");
    const email=String(body.email??"").trim().toLowerCase();
    const name=String(body.full_name??"").trim().slice(0,120);
    const role=String(body.role??"cashier");
    if(!/^[0-9a-f-]{36}$/i.test(tenantId)||!/^\S+@\S+\.\S+$/.test(email)||!allowedRoles.includes(role)) return json(400,{error:"Informations invalides"});
    const {data:membership,error:memberError}=await admin.from("tenant_memberships").select("role").eq("tenant_id",tenantId).eq("user_id",user.id).maybeSingle();
    if(memberError||!membership||!["owner","admin"].includes(membership.role)) return json(403,{error:"Seul l’administrateur de l’entreprise peut inviter des utilisateurs"});
    const {count,error:countError}=await admin.from("tenant_memberships").select("user_id",{count:"exact",head:true}).eq("tenant_id",tenantId);
    if(countError) return json(500,{error:"Impossible de vérifier le quota"});
    const {data:tenant,error:tenantError}=await admin.from("tenants").select("name").eq("id",tenantId).maybeSingle();
    if(tenantError||!tenant) return json(404,{error:"Entreprise introuvable"});
    const {data:sub,error:subError}=await admin.from("tenant_subscriptions").select("status,trial_ends_at,current_period_ends_at,grace_ends_at,plan_id").eq("tenant_id",tenantId).in("status",["active","trialing","past_due"]).maybeSingle();
    if(subError||!sub) return json(403,{error:"Aucun abonnement valide pour cette entreprise"});
    const now=new Date();
    if(sub.status==="trialing"&&(!sub.trial_ends_at||new Date(sub.trial_ends_at)<=now)) return json(403,{error:"La période d’essai est terminée"});
    if(sub.status==="active"&&sub.current_period_ends_at&&new Date(sub.current_period_ends_at)<=now) return json(403,{error:"Abonnement arrivé à échéance"});
    if(sub.status==="past_due"&&(!sub.grace_ends_at||new Date(sub.grace_ends_at)<=now)) return json(403,{error:"Le délai de paiement est dépassé"});
    const {data:plan,error:planError}=await admin.from("subscription_plans").select("max_users").eq("id",sub.plan_id).eq("is_active",true).maybeSingle();
    if(planError||!plan) return json(403,{error:"Formule d’abonnement indisponible"});
    const maxUsers=plan.max_users as number|null;
    if(maxUsers!==null&&(count??0)>=maxUsers) return json(403,{error:"Limite d’utilisateurs atteinte pour votre abonnement"});
    // Never let a local development URL leak into production invitation emails.
    // Supabase Auth must allow this exact URL in Authentication > URL Configuration.
    const redirectTo="https://idiaba.onrender.com/auth/accept-invite";
    const {data:invited,error:inviteError}=await admin.auth.admin.inviteUserByEmail(email,{redirectTo,data:{full_name:name,company_name:tenant.name,tenant_role:role}});
    if(inviteError){
      const duplicate=/already|registered|exists/i.test(inviteError.message);
      return json(duplicate?409:400,{error:duplicate?"Cette adresse a déjà un compte iDIABA. Utilisez « Ajouter un compte existant » dans la page Équipe.":inviteError.message});
    }
    if(!invited.user) return json(500,{error:"Invitation envoyée sans retour de compte; contactez l’administrateur"});
    const {error:insertError}=await admin.from("tenant_memberships").insert({tenant_id:tenantId,user_id:invited.user.id,role});
    if(insertError){
      await admin.auth.admin.deleteUser(invited.user.id);
      return json(409,{error:"L’invitation a été annulée car l’ajout à l’entreprise a échoué. Vérifiez l’abonnement et le quota."});
    }
    if(name) await admin.from("profiles").update({full_name:name,updated_at:new Date().toISOString()}).eq("id",invited.user.id);
    return json(200,{message:"Invitation envoyée. L’employé recevra un e-mail pour activer son compte.",user_id:invited.user.id});
  }catch(e){
    return json(500,{error:e instanceof Error?e.message:"Erreur inattendue"});
  }
});
