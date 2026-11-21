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
    const {data:sub}=await admin.from("tenant_subscriptions").select("status,plan:subscription_plans(max_users)").eq("tenant_id",tenantId).in("status",["active","trialing"]).maybeSingle();
    const planData=sub?.plan as {max_users:number|null}|null;
    const maxUsers=planData?.max_users??2;
    if(maxUsers!==null&&(count??0)>=maxUsers) return json(403,{error:"Limite d’utilisateurs atteinte pour votre abonnement"});
    const redirectTo=(Deno.env.get("APP_URL")??"https://idiaba.onrender.com")+"/login";
    const {data:invited,error:inviteError}=await admin.auth.admin.inviteUserByEmail(email,{redirectTo,data:{full_name:name}});
    if(inviteError){
      const duplicate=/already|registered|exists/i.test(inviteError.message);
      return json(duplicate?409:400,{error:duplicate?"Cette adresse a déjà un compte iDIABA. Utilisez « Ajouter un compte existant » dans la page Équipe.":inviteError.message});
    }
    if(!invited.user) return json(500,{error:"Invitation envoyée sans retour de compte; contactez l’administrateur"});
    const {error:insertError}=await admin.from("tenant_memberships").insert({tenant_id:tenantId,user_id:invited.user.id,role});
    if(insertError){
      return json(500,{error:"Invitation envoyée, mais association à l’entreprise impossible. Recherchez ce compte dans Équipe puis ajoutez-le manuellement."});
    }
    if(name) await admin.from("profiles").update({full_name:name,updated_at:new Date().toISOString()}).eq("id",invited.user.id);
    return json(200,{message:"Invitation envoyée. L’employé recevra un e-mail pour activer son compte.",user_id:invited.user.id});
  }catch(e){
    return json(500,{error:e instanceof Error?e.message:"Erreur inattendue"});
  }
});
