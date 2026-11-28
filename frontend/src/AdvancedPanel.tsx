import {useEffect,useState} from "react";
import type {CSSProperties} from "react";
import {Layers,ShieldCheck,Truck,ClipboardList,RotateCcw,Utensils,Printer,Building2,RefreshCw} from "lucide-react";
import CommercePanel from "./CommercePanel";

const api=async(path:string,body?:any,method?:string)=>{
 const token=localStorage.getItem("idiaba_token");
 const r=await fetch(path,{method:method||(body?"POST":"GET"),headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 if(!r.ok){let d="Erreur API";try{d=(await r.json()).detail||d}catch{}throw new Error(d);}
 return r.status===204?null:r.json();
};
const box:CSSProperties={background:"#fff",border:"1px solid #e5e7eb",borderRadius:12,padding:16,marginBottom:14};
const field:React.CSSProperties={padding:10,border:"1px solid #d1d5db",borderRadius:8,minWidth:120};
const btn:React.CSSProperties={padding:"10px 14px",border:0,borderRadius:8,background:"#166534",color:"#fff",cursor:"pointer",fontWeight:600};
export default function AdvancedPanel({role,permissions=[]}:{role:string;permissions?:string[]}){
 const [section,setSection]=useState(role==="SUPER_ADMIN"?"Super Admin":"Profils"),[msg,setMsg]=useState(""),[busy,setBusy]=useState(false);
 const [profiles,setProfiles]=useState<any[]>([]),[selectedPermissions,setSelectedPermissions]=useState<string[]>([]),[catalog,setCatalog]=useState<string[]>([]);
 const [suppliers,setSuppliers]=useState<any[]>([]),[warehouses,setWarehouses]=useState<any[]>([]),[products,setProducts]=useState<any[]>([]),[sales,setSales]=useState<any[]>([]);
 const [purchases,setPurchases]=useState<any[]>([]),[tables,setTables]=useState<any[]>([]),[orders,setOrders]=useState<any[]>([]),[overview,setOverview]=useState<any>(null),[platformPaymentSettings,setPlatformPaymentSettings]=useState<any>({wave_enabled:false,wave_name:"",wave_phone:"",wave_link:"",orange_enabled:false,orange_name:"",orange_phone:"",orange_link:"",instructions:""}),[companies,setCompanies]=useState<any[]>([]),[registrations,setRegistrations]=useState<any[]>([]),[transfers,setTransfers]=useState<any[]>([]),[valuation,setValuation]=useState<any>(null),[movements,setMovements]=useState<any[]>([]);
 const [form,setForm]=useState<any>({});
 const [purchaseLines,setPurchaseLines]=useState<any[]>([{product_id:"",quantity:"",unit_cost:""}]);
 const [receivingOrder,setReceivingOrder]=useState<any>(null);
 const [receiptQuantities,setReceiptQuantities]=useState<Record<number,string>>({});
 const [receiptCosts,setReceiptCosts]=useState<Record<number,string>>({});
 const update=(k:string,v:any)=>setForm((x:any)=>({...x,[k]:v}));
 const updatePurchaseLine=(index:number,key:string,value:string)=>setPurchaseLines(lines=>lines.map((line,i)=>i===index?{...line,[key]:value}:line));
 const openReceipt=(order:any)=>{
  setReceivingOrder(order);
  setReceiptQuantities(Object.fromEntries(order.lines.map((line:any)=>[line.product_id,String(line.remaining)])));
  setReceiptCosts(Object.fromEntries(order.lines.map((line:any)=>[line.product_id,String(line.unit_cost)])));
 };
 const submitReceipt=(order:any)=>{
  const lines=order.lines.map((line:any)=>({product_id:line.product_id,quantity:Number(receiptQuantities[line.product_id]||0),unit_cost:Number(receiptCosts[line.product_id]??line.unit_cost)})).filter((line:any)=>line.quantity>0);
  if(!lines.length){setMsg("Saisissez au moins une quantité reçue.");return;}
  run(async()=>{await api("/api/purchases/"+order.id+"/receive",{lines});setReceivingOrder(null);},"Réception enregistrée");
 };
 const load=async()=>{
  if(role==="SUPER_ADMIN"){
   const [platformOverview,platformCompanies,platformRegistrations,paymentSettings]=await Promise.all([api("/api/platform/overview"),api("/api/platform/companies"),api("/api/platform/registrations"),api("/api/platform/payment-settings")]);
   setOverview(platformOverview);setCompanies(platformCompanies);setRegistrations(platformRegistrations);setPlatformPaymentSettings(paymentSettings);return;
  }
  const [pr,pc,su,wh,pro,sa,po,tb,od,tr,va,mv]=await Promise.all([
   api("/api/profiles").catch(()=>[]),api("/api/permissions").catch(()=>[]),api("/api/suppliers").catch(()=>[]),
   api("/api/warehouses").catch(()=>[]),api("/api/products").catch(()=>[]),api("/api/sales").catch(()=>[]),
   api("/api/purchases").catch(()=>[]),api("/api/restaurant/tables").catch(()=>[]),api("/api/restaurant/orders").catch(()=>[]),api("/api/stock/transfers").catch(()=>[]),api("/api/stock/valuation").catch(()=>null),api("/api/stock/movements").catch(()=>[])
  ]);
  setProfiles(pr);setCatalog(pc);setSuppliers(su);setWarehouses(wh);setProducts(pro);setSales(sa);setPurchases(po);setTables(tb);setOrders(od);setTransfers(tr);setValuation(va);setMovements(mv);
 };
 useEffect(()=>{load().catch((e:any)=>setMsg(e.message));},[]);
 async function downloadCsv(){try{const token=localStorage.getItem("idiaba_token");const r=await fetch("/api/sales/export.csv",{headers:token?{Authorization:"Bearer "+token}:{}});if(!r.ok)throw new Error("Export impossible");const url=URL.createObjectURL(await r.blob());const a=document.createElement("a");a.href=url;a.download="idiaba-ventes.csv";a.click();URL.revokeObjectURL(url);}catch(e:any){setMsg(e.message)}}
 async function openInvoice(id:number){try{const token=localStorage.getItem("idiaba_token");const r=await fetch("/api/sales/"+id+"/invoice",{headers:token?{Authorization:"Bearer "+token}:{}});if(!r.ok)throw new Error("Impossible d’ouvrir la facture");const url=URL.createObjectURL(await r.blob());window.open(url,"_blank","noopener");}catch(e:any){setMsg(e.message)}}
 async function run(fn:()=>Promise<any>,done:string){setBusy(true);setMsg("");try{await fn();await load();setForm({});setMsg(done);}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}
 const has=(...keys:string[])=>role==="ADMIN"||keys.some(k=>permissions.includes(k));
 const sections=role==="SUPER_ADMIN"?["Super Admin"]:[
  ...(has("users.read","users.write")?["Profils"]:[]),
  ...(has("purchases.read","purchases.write")?["Achats"]:[]),
  ...(has("inventory.read","inventory.write")?["Inventaires"]:[]),
  ...(has("stock.read","stock.write")?["Transferts & valeur"]:[]),
  ...(has("sales.refund")?["Retours"]:[]),
  ...(has("restaurant.read","restaurant.write")?["Restaurant"]:[]),
  ...(has("sales.read")?["Factures"]:[]),
   ...(has("sales.read","sales.write")?["Devis & commandes"]:[]),
  ...(has("finance.read","finance.write","payables.read","payables.write","receivables.read","receivables.write")?["Finance"]:[])
 ];
 useEffect(()=>{if(sections.length&&!sections.includes(section))setSection(sections[0]);},[sections.join("|"),section]);
 return <div style={{padding:16,maxWidth:1100,margin:"auto"}}>
  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>{sections.map(s=><button key={s} onClick={()=>setSection(s)} style={{...field,background:section===s?"#dcfce7":"#fff",fontWeight:600}}>{s}</button>)}</div>
  {msg&&<p style={{padding:10,background:"#f0fdf4",borderRadius:8}} onClick={()=>setMsg("")}>{msg}　×</p>}
  {section==="Profils"&&<section style={box}><h3><ShieldCheck size={18}/> Profils et droits</h3>{has("users.write")&&<form onSubmit={e=>{e.preventDefault();run(()=>api("/api/profiles",{role_key:form.role_key,name:form.name,permissions:selectedPermissions}),"Profil créé");}} style={{display:"flex",gap:8,flexWrap:"wrap"}}><input required placeholder="CODE_PROFIL" value={form.role_key||""} onChange={e=>update("role_key",e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g,"_"))} style={field}/><input required placeholder="Nom du profil" value={form.name||""} onChange={e=>update("name",e.target.value)} style={field}/><button style={btn} disabled={busy}>Créer le profil</button><div style={{width:"100%",display:"flex",gap:12,flexWrap:"wrap"}}>{catalog.map(p=><label key={p} style={{fontSize:13}}><input type="checkbox" checked={selectedPermissions.includes(p)} onChange={e=>setSelectedPermissions(v=>e.target.checked?[...v,p]:v.filter(x=>x!==p))}/> {p}</label>)}</div></form>}{profiles.map(p=><p key={p.id}><b>{p.name}</b> ({p.role_key}) · {p.permissions.join(", ")}</p>)}</section>}
  {section==="Achats"&&<section style={box}>
   <h3><Truck size={18}/> Commandes fournisseurs et réceptions</h3>
   {has("purchases.write")&&<form onSubmit={e=>{e.preventDefault();const lines=purchaseLines.filter(l=>l.product_id&&Number(l.quantity)>0&&Number(l.unit_cost)>=0).map(l=>({product_id:Number(l.product_id),quantity:Number(l.quantity),unit_cost:Number(l.unit_cost)}));if(!lines.length){setMsg("Ajoutez au moins un article à la commande.");return;}run(async()=>{await api("/api/purchases",{supplier_id:Number(form.supplier_id),warehouse_id:Number(form.warehouse_id),reference:form.reference,lines});setPurchaseLines([{product_id:"",quantity:"",unit_cost:""}]);},"Commande créée");}} style={{display:"grid",gap:10}}>
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
     <input required placeholder="Référence commande" value={form.reference||""} onChange={e=>update("reference",e.target.value)} style={field}/>
     <select required value={form.supplier_id||""} onChange={e=>update("supplier_id",e.target.value)} style={field}><option value="">Fournisseur</option>{suppliers.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
     <select required value={form.warehouse_id||""} onChange={e=>update("warehouse_id",e.target.value)} style={field}><option value="">Dépôt de réception</option>{warehouses.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
    </div>
    <div style={{overflowX:"auto"}}>
     <table style={{width:"100%",borderCollapse:"collapse",minWidth:560}}>
      <thead><tr><th align="left">Article</th><th>Quantité commandée</th><th>Coût unitaire (FCFA)</th><th></th></tr></thead>
      <tbody>{purchaseLines.map((line,index)=><tr key={index}>
       <td><select required value={line.product_id} onChange={e=>updatePurchaseLine(index,"product_id",e.target.value)} style={{...field,width:"100%"}}><option value="">Choisir un article</option>{products.map(x=><option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}</select></td>
       <td><input required type="number" min="0.001" step="0.001" value={line.quantity} onChange={e=>updatePurchaseLine(index,"quantity",e.target.value)} style={{...field,width:140}}/></td>
       <td><input required type="number" min="0" step="0.01" value={line.unit_cost} onChange={e=>updatePurchaseLine(index,"unit_cost",e.target.value)} style={{...field,width:160}}/></td>
       <td><button type="button" disabled={purchaseLines.length===1} onClick={()=>setPurchaseLines(lines=>lines.filter((_,i)=>i!==index))} style={{...field,minWidth:0}}>Retirer</button></td>
      </tr>)}</tbody>
     </table>
    </div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
     <button type="button" style={{...field,border:"1px solid #166534",color:"#166534"}} onClick={()=>setPurchaseLines(lines=>[...lines,{product_id:"",quantity:"",unit_cost:""}])}>+ Ajouter un article</button>
     <button style={btn} disabled={busy}>Créer la commande fournisseur</button>
    </div>
   </form>}
   <h4 style={{marginTop:22}}>Historique des commandes</h4>
   {purchases.length===0?<p>Aucune commande fournisseur.</p>:purchases.map(p=><div key={p.id} style={{padding:12,border:"1px solid #e5e7eb",borderRadius:10,marginBottom:10}}>
    <div style={{display:"flex",gap:8,justifyContent:"space-between",flexWrap:"wrap"}}><div><b>{p.reference}</b> · {p.supplier_name} · dépôt {p.warehouse_name}<div style={{fontSize:13,color:"#64748b"}}>{p.status==="RECU"?"Reçue":p.status==="PARTIEL"?"Réception partielle":p.status==="ANNULE"?"Annulée":"À recevoir"} · {new Date(p.created_at).toLocaleDateString("fr-FR")}</div></div><b>{Number(p.total).toLocaleString("fr-FR")} FCFA</b></div>
    <div style={{overflowX:"auto",marginTop:8}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}><thead><tr><th align="left">Article</th><th>Commandé</th><th>Reçu</th><th>Reste</th><th>Coût unitaire</th></tr></thead><tbody>{(p.lines||[]).map((line:any)=><tr key={line.product_id}><td>{line.product_name}</td><td align="center">{line.quantity}</td><td align="center">{line.received}</td><td align="center">{line.remaining}</td><td align="right">{Number(line.unit_cost).toLocaleString("fr-FR")}</td></tr>)}</tbody></table></div>
    {has("purchases.write")&&p.status!=="RECU"&&p.status!=="ANNULE"&&<button style={{...btn,marginTop:10}} onClick={()=>openReceipt(p)}>Enregistrer une réception</button>}
    {receivingOrder?.id===p.id&&<form onSubmit={e=>{e.preventDefault();submitReceipt(p);}} style={{marginTop:12,padding:12,background:"#f8fafc",borderRadius:8}}>
     <b>Réception de la commande {p.reference}</b>
     {(p.lines||[]).filter((line:any)=>line.remaining>0).map((line:any)=><div key={line.product_id} style={{display:"grid",gridTemplateColumns:"minmax(130px,1fr) repeat(2,minmax(100px,150px))",gap:8,alignItems:"center",marginTop:8}}>
      <span>{line.product_name}<small style={{display:"block",color:"#64748b"}}>Reste à recevoir : {line.remaining}</small></span>
      <label style={{fontSize:12}}>Quantité reçue<input aria-label={"Quantité reçue "+line.product_name} type="number" min="0" max={line.remaining} step="0.001" value={receiptQuantities[line.product_id]??"0"} onChange={e=>setReceiptQuantities(v=>({...v,[line.product_id]:e.target.value}))} style={{...field,width:"100%",boxSizing:"border-box"}}/></label>
      <label style={{fontSize:12}}>Coût unitaire<input aria-label={"Coût unitaire "+line.product_name} type="number" min="0" step="0.01" value={receiptCosts[line.product_id]??String(line.unit_cost)} onChange={e=>setReceiptCosts(v=>({...v,[line.product_id]:e.target.value}))} style={{...field,width:"100%",boxSizing:"border-box"}}/></label>
     </div>)}
     <div style={{display:"flex",gap:8,marginTop:12}}><button style={btn} disabled={busy}>Confirmer la réception</button><button type="button" style={field} onClick={()=>setReceivingOrder(null)}>Fermer</button></div>
    </form>}
   </div>)}
  </section>}
  {section==="Inventaires"&&<InventorySection warehouses={warehouses} run={run} busy={busy} canWrite={has("inventory.write")}/>}
  {section==="Transferts & valeur"&&<section style={box}><h3><Layers size={18}/> Transferts entre dépôts et valorisation</h3>{has("stock.write")&&<form onSubmit={e=>{e.preventDefault();run(()=>api("/api/stock/transfers",{source_warehouse_id:Number(form.source_warehouse_id),destination_warehouse_id:Number(form.destination_warehouse_id),reference:form.transfer_reference,lines:[{product_id:Number(form.transfer_product),quantity:Number(form.transfer_quantity)}]}),"Transfert de stock effectué");}} style={{display:"flex",gap:8,flexWrap:"wrap"}}><input required placeholder="Référence transfert" value={form.transfer_reference||""} onChange={e=>update("transfer_reference",e.target.value)} style={field}/><select required value={form.source_warehouse_id||""} onChange={e=>update("source_warehouse_id",e.target.value)} style={field}><option value="">Dépôt source</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select><select required value={form.destination_warehouse_id||""} onChange={e=>update("destination_warehouse_id",e.target.value)} style={field}><option value="">Dépôt destination</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select><select required value={form.transfer_product||""} onChange={e=>update("transfer_product",e.target.value)} style={field}><option value="">Article</option>{products.map(p=><option key={p.id} value={p.id}>{p.name} · stock global {p.stock}</option>)}</select><input required type="number" min="0.01" step="0.01" placeholder="Quantité" value={form.transfer_quantity||""} onChange={e=>update("transfer_quantity",e.target.value)} style={field}/><button style={btn} disabled={busy}>Valider le transfert</button></form>}<h4>Historique des transferts</h4>{transfers.map(t=><p key={t.id}>{t.reference} · dépôt {warehouses.find(w=>w.id===t.source_warehouse_id)?.name||t.source_warehouse_id} → {warehouses.find(w=>w.id===t.destination_warehouse_id)?.name||t.destination_warehouse_id} · {t.status}</p>)}<h4>Journal des mouvements de stock</h4>{movements.length===0?<p>Aucun mouvement récent.</p>:movements.slice(0,30).map(m=><div key={m.id} style={{display:"flex",gap:10,justifyContent:"space-between",flexWrap:"wrap",padding:"6px 0",borderBottom:"1px solid #e5e7eb",fontSize:13}}><span>{new Date(m.created_at).toLocaleString("fr-FR")} · {products.find(p=>p.id===m.product_id)?.name||("Article #"+m.product_id)}</span><span>{warehouses.find(w=>w.id===m.warehouse_id)?.name||("Dépôt #"+m.warehouse_id)} · {m.kind}</span><b>{Number(m.quantity)>0?"+":""}{m.quantity}</b></div>)}<h4>Valeur du stock au coût d'achat</h4><p><b>{Number(valuation?.total_value||0).toLocaleString("fr-FR")} FCFA</b></p><div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr><th>Article</th><th>Quantité</th><th>Coût unitaire</th><th>Valeur</th></tr></thead><tbody>{(valuation?.items||[]).map((v:any)=><tr key={v.product_id}><td>{v.name}</td><td>{v.quantity}</td><td>{Number(v.unit_cost).toLocaleString("fr-FR")}</td><td>{Number(v.value).toLocaleString("fr-FR")}</td></tr>)}</tbody></table></div></section>}
  {section==="Retours"&&<section style={box}><h3><RotateCcw size={18}/> Retours et remboursements</h3><form onSubmit={e=>{e.preventDefault();run(()=>api("/api/sales/"+Number(form.sale_id)+"/refund",{reason:form.reason,refund_method:form.refund_method,reference:form.refund_reference||"",lines:[{product_id:Number(form.product_id),counted:Number(form.quantity)}]}),"Remboursement enregistré");}} style={{display:"flex",gap:8,flexWrap:"wrap"}}><select required value={form.sale_id||""} onChange={e=>update("sale_id",e.target.value)} style={field}><option value="">Vente</option>{sales.map(s=><option key={s.id} value={s.id}>Vente #{s.id} · {s.total} FCFA</option>)}</select><select required value={form.product_id||""} onChange={e=>update("product_id",e.target.value)} style={field}><option value="">Article retourné</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><input required type="number" min="0.01" step="0.01" placeholder="Quantité" value={form.quantity||""} onChange={e=>update("quantity",e.target.value)} style={field}/><input required placeholder="Motif du retour" value={form.reason||""} onChange={e=>update("reason",e.target.value)} style={field}/><select required value={form.refund_method||""} onChange={e=>update("refund_method",e.target.value)} style={field}><option value="">Mode de remboursement</option><option value="ESPECES">Espèces (caisse ouverte)</option><option value="WAVE">Wave</option><option value="ORANGE_MONEY">Orange Money</option><option value="CARTE">Carte</option><option value="VIREMENT">Virement</option></select><input placeholder="Référence de paiement" value={form.refund_reference||""} onChange={e=>update("refund_reference",e.target.value)} style={field}/><button style={btn} disabled={busy}>Enregistrer retour et remboursement</button></form><small>Chaque retour est journalisé et remet l'article en stock. Le mode et la référence du remboursement sont journalisés. En espèces, la sortie est déduite de la caisse ouverte.</small></section>}
  {section==="Restaurant"&&<section style={box}><h3><Utensils size={18}/> Tables et commandes internes</h3>{has("restaurant.write")&&<form onSubmit={e=>{e.preventDefault();run(()=>api("/api/restaurant/tables",{name:form.table_name,seats:Number(form.seats||4)}),"Table créée");}} style={{display:"flex",gap:8,flexWrap:"wrap"}}><input required placeholder="Nom / numéro de table" value={form.table_name||""} onChange={e=>update("table_name",e.target.value)} style={field}/><input type="number" min="1" placeholder="Places" value={form.seats||4} onChange={e=>update("seats",e.target.value)} style={field}/><button style={btn}>Ajouter table</button></form>}<p>{tables.map(t=><span key={t.id} style={{marginRight:12}}>{t.name} ({t.seats} places)</span>)}</p>{has("restaurant.write")&&<form onSubmit={e=>{e.preventDefault();run(()=>api("/api/restaurant/orders",{table_id:form.table_id?Number(form.table_id):null,warehouse_id:form.order_warehouse?Number(form.order_warehouse):undefined,note:form.note||"",lines:[{product_id:Number(form.order_product),counted:Number(form.order_quantity)}]}),"Commande cuisine envoyée");}} style={{display:"flex",gap:8,flexWrap:"wrap"}}><select value={form.table_id||""} onChange={e=>update("table_id",e.target.value)} style={field}><option value="">À emporter / sans table</option>{tables.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select><select value={form.order_warehouse||""} onChange={e=>update("order_warehouse",e.target.value)} style={field}><option value="">Dépôt principal</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select><select required value={form.order_product||""} onChange={e=>update("order_product",e.target.value)} style={field}><option value="">Plat / article</option>{products.filter(p=>p.kind==="COMPOSE"||p.category==="Restaurant").map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><input required type="number" min="1" value={form.order_quantity||1} onChange={e=>update("order_quantity",e.target.value)} style={field}/><input placeholder="Note cuisine" value={form.note||""} onChange={e=>update("note",e.target.value)} style={field}/><button style={btn}>Envoyer en cuisine</button></form>}{orders.map(o=><p key={o.id}>Commande #{o.id} · {o.status} · Dépôt : {warehouses.find(w=>w.id===o.warehouse_id)?.name||"Principal"} {has("restaurant.write")&&o.status!=="SERVIE"&&o.status!=="ANNULEE"&&<select value={o.status} onChange={e=>run(()=>api("/api/restaurant/orders/"+o.id+"/status?status="+e.target.value,undefined,"POST"),"Statut mis à jour")}><option>A_PREPARER</option><option>EN_PREPARATION</option><option>PRETE</option><option>SERVIE</option><option>ANNULEE</option></select>}</p>)}</section>}
  {section==="Factures"&&<section style={box}><h3><Printer size={18}/> Tickets, factures et exports</h3><button style={btn} onClick={downloadCsv}>Exporter les ventes CSV</button>{sales.map(s=><p key={s.id}>Vente #{s.id} · {Number(s.total).toLocaleString("fr-FR")} FCFA · <button style={btn} onClick={()=>openInvoice(s.id)}>Ouvrir / Imprimer</button></p>)}</section>}
  {section==="Finance"&&<FinanceSection permissions={permissions}/>}
  {section==="Super Admin"&&<section style={box}><h3><Building2 size={18}/> Super Admin SaaS</h3>{overview?<><p>Entreprises : <b>{overview.companies}</b> · Utilisateurs : <b>{overview.users}</b></p><form onSubmit={e=>{e.preventDefault();run(()=>api("/api/platform/companies",{name:form.company_name,mode:form.mode||"HYBRIDE",address:form.address||"",phone:form.phone||"",currency:"FCFA",tax_rate:18,admin_name:form.admin_name,admin_email:form.admin_email,admin_password:form.admin_password}),"Entreprise créée");}} style={{display:"flex",gap:8,flexWrap:"wrap"}}><input required placeholder="Nom entreprise" value={form.company_name||""} onChange={e=>update("company_name",e.target.value)} style={field}/><input required placeholder="Nom administrateur" value={form.admin_name||""} onChange={e=>update("admin_name",e.target.value)} style={field}/><input required type="email" placeholder="E-mail admin" value={form.admin_email||""} onChange={e=>update("admin_email",e.target.value)} style={field}/><input required minLength={8} type="password" placeholder="Mot de passe admin" value={form.admin_password||""} onChange={e=>update("admin_password",e.target.value)} style={field}/><button style={btn}>Créer entreprise</button></form><h4 style={{marginTop:24}}>Demandes d'inscription ({registrations.filter((r:any)=>r.status==="EN_ATTENTE").length} en attente)</h4>
  {registrations.length===0?<p>Aucune demande reçue.</p>:registrations.map((r:any)=><div key={r.id} style={{padding:10,borderBottom:"1px solid #eee"}}>
   <b>{r.company_name}</b> · {r.mode} · <span style={{fontSize:13}}>{r.status}</span>
   <p style={{margin:"5px 0",fontSize:13,color:"#475569"}}>{r.admin_name} · {r.admin_email} · {r.phone} · {r.address||"Adresse non renseignée"}</p>
   <small>Reçue le {new Date(r.created_at).toLocaleString("fr-FR")}</small>
   {r.review_note&&<p>{r.review_note}</p>}
   {r.status==="EN_ATTENTE"&&<div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
    <button style={btn} disabled={busy} onClick={()=>run(()=>api("/api/platform/registrations/"+r.id+"/review",{decision:"APPROUVER",note:"Demande validée"}),"Entreprise créée. Abonnement suspendu jusqu'à sa configuration.")}>Approuver la demande</button>
    <button style={{...btn,background:"#991b1b"}} disabled={busy} onClick={()=>{const note=window.prompt("Motif du refus (facultatif)","Informations à compléter");if(note!==null)run(()=>api("/api/platform/registrations/"+r.id+"/review",{decision:"REFUSER",note}),"Demande refusée");}}>Refuser</button>
   </div>}
  </div>)}
  <section style={{...box,marginTop:20}}>
   <h4 style={{marginTop:0}}>Coordonnées de paiement iDIABA</h4>
   <p style={{fontSize:13,color:"#475569"}}>Ces informations sont facultatives. Laissez les moyens désactivés tant que vous ne disposez pas de vos coordonnées ou liens marchands. Aucun numéro n'est prérempli.</p>
   <form onSubmit={e=>{e.preventDefault();run(()=>api("/api/platform/payment-settings",platformPaymentSettings,"PUT"),"Coordonnées de paiement enregistrées");}} style={{display:"grid",gap:12}}>
    <div style={{border:"1px solid #e5e7eb",borderRadius:10,padding:12}}>
     <label style={{display:"flex",alignItems:"center",gap:8,fontWeight:600}}><input type="checkbox" checked={!!platformPaymentSettings.wave_enabled} onChange={e=>setPlatformPaymentSettings((v:any)=>({...v,wave_enabled:e.target.checked}))}/> Activer Wave</label>
     <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
      <input placeholder="Nom du bénéficiaire Wave" value={platformPaymentSettings.wave_name||""} onChange={e=>setPlatformPaymentSettings((v:any)=>({...v,wave_name:e.target.value}))} style={field}/>
      <input placeholder="Numéro Wave marchand" value={platformPaymentSettings.wave_phone||""} onChange={e=>setPlatformPaymentSettings((v:any)=>({...v,wave_phone:e.target.value}))} style={field}/>
      <input type="url" placeholder="Lien de paiement Wave (facultatif)" value={platformPaymentSettings.wave_link||""} onChange={e=>setPlatformPaymentSettings((v:any)=>({...v,wave_link:e.target.value}))} style={{...field,flex:1}}/>
     </div>
    </div>
    <div style={{border:"1px solid #e5e7eb",borderRadius:10,padding:12}}>
     <label style={{display:"flex",alignItems:"center",gap:8,fontWeight:600}}><input type="checkbox" checked={!!platformPaymentSettings.orange_enabled} onChange={e=>setPlatformPaymentSettings((v:any)=>({...v,orange_enabled:e.target.checked}))}/> Activer Orange Money</label>
     <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
      <input placeholder="Nom du bénéficiaire Orange Money" value={platformPaymentSettings.orange_name||""} onChange={e=>setPlatformPaymentSettings((v:any)=>({...v,orange_name:e.target.value}))} style={field}/>
      <input placeholder="Numéro Orange Money marchand" value={platformPaymentSettings.orange_phone||""} onChange={e=>setPlatformPaymentSettings((v:any)=>({...v,orange_phone:e.target.value}))} style={field}/>
      <input type="url" placeholder="Lien de paiement Orange Money (facultatif)" value={platformPaymentSettings.orange_link||""} onChange={e=>setPlatformPaymentSettings((v:any)=>({...v,orange_link:e.target.value}))} style={{...field,flex:1}}/>
     </div>
    </div>
    <label style={{display:"grid",gap:6}}>Instructions à communiquer aux entreprises<textarea maxLength={500} rows={3} placeholder="Ex. Indiquez le nom de votre entreprise dans le motif du transfert." value={platformPaymentSettings.instructions||""} onChange={e=>setPlatformPaymentSettings((v:any)=>({...v,instructions:e.target.value}))} style={{...field,resize:"vertical"}}/></label>
    <div><button style={btn} disabled={busy}>Enregistrer les coordonnées</button></div>
   </form>
  </section>
  <h4 style={{marginTop:24}}>Entreprises enregistrées</h4>
  {companies.map((co:any)=><div key={co.id} style={{padding:8,borderBottom:"1px solid #eee"}}><b>{co.name}</b> · {co.mode} · {co.currency} · ID {co.id}<p style={{margin:"6px 0",fontSize:13,color:"#475569"}}>Abonnement actuel : <b>{co.subscription?.plan||"Non défini"}</b> · {co.subscription?.status||"À initialiser"} · {Number(co.subscription?.monthly_price||0).toLocaleString("fr-FR")} FCFA/mois · Échéance : {co.subscription?.ends_at?new Date(co.subscription.ends_at).toLocaleDateString("fr-FR"):"Sans échéance"}</p><form onSubmit={e=>{e.preventDefault();const expiry=form["ends_at_"+co.id]||"";run(()=>api("/api/platform/companies/"+co.id+"/subscription",{plan:form["plan_"+co.id]||co.subscription?.plan||"ESSENTIEL",status:form["status_"+co.id]||co.subscription?.status||"ESSAI",monthly_price:Number(form["price_"+co.id]??co.subscription?.monthly_price??0),ends_at:expiry?new Date(expiry+"T23:59:59Z").toISOString():null},"PUT"),"Abonnement mis à jour");}} style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:6}}><select value={form["plan_"+co.id]||co.subscription?.plan||"ESSENTIEL"} onChange={e=>update("plan_"+co.id,e.target.value)} style={field}><option>ESSENTIEL</option><option>PRO</option><option>RESTAURANT</option><option>ENTREPRISE</option></select><select value={form["status_"+co.id]||co.subscription?.status||"ESSAI"} onChange={e=>update("status_"+co.id,e.target.value)} style={field}><option>ESSAI</option><option>ACTIF</option><option>SUSPENDU</option><option>RESILIE</option></select><input type="number" min="0" placeholder="Prix mensuel" value={form["price_"+co.id]??co.subscription?.monthly_price??0} onChange={e=>update("price_"+co.id,e.target.value)} style={field}/><label style={{display:"flex",alignItems:"center",gap:6,fontSize:13}}>Date d'échéance <input type="date" value={form["ends_at_"+co.id]??(co.subscription?.ends_at?new Date(co.subscription.ends_at).toISOString().slice(0,10):"")} onChange={e=>update("ends_at_"+co.id,e.target.value)} style={field}/></label><button style={btn}>Enregistrer abonnement</button></form>
 <h5 style={{margin:"12px 0 6px"}}>Paiement reçu par Wave ou Orange Money</h5><small>Le client paie directement. Après vérification du reçu dans le compte marchand, saisissez la référence et confirmez le paiement.</small>
 <form onSubmit={e=>{e.preventDefault();run(()=>api("/api/platform/companies/"+co.id+"/payments",{provider:form["payment_provider_"+co.id]||"WAVE",amount:Number(form["payment_amount_"+co.id]??Number(co.subscription?.monthly_price||0)*Number(form["payment_months_"+co.id]||1)),reference:form["payment_reference_"+co.id],period_months:Number(form["payment_months_"+co.id]||1),note:form["payment_note_"+co.id]||"",confirm_receipt:!!form["payment_confirm_"+co.id]}),"Paiement vérifié et abonnement activé.");}} style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:6}}>
 <select required value={form["payment_provider_"+co.id]||"WAVE"} onChange={e=>update("payment_provider_"+co.id,e.target.value)} style={field}><option value="WAVE">Wave</option><option value="ORANGE_MONEY">Orange Money</option></select>
 <select value={form["payment_months_"+co.id]||1} onChange={e=>update("payment_months_"+co.id,e.target.value)} style={field}><option value="1">1 mois</option><option value="3">3 mois</option><option value="6">6 mois</option><option value="12">12 mois</option></select>
 <input required type="number" min="1" step="1" placeholder="Montant FCFA" value={form["payment_amount_"+co.id]??Number(co.subscription?.monthly_price||0)*Number(form["payment_months_"+co.id]||1)} onChange={e=>update("payment_amount_"+co.id,e.target.value)} style={field}/>
 <input required minLength={3} maxLength={120} placeholder="Référence de transaction" value={form["payment_reference_"+co.id]||""} onChange={e=>update("payment_reference_"+co.id,e.target.value)} style={field}/>
 <input placeholder="Note (facultatif)" value={form["payment_note_"+co.id]||""} onChange={e=>update("payment_note_"+co.id,e.target.value)} style={field}/>
 <label style={{display:"flex",alignItems:"center",gap:6,fontSize:13}}><input type="checkbox" required checked={!!form["payment_confirm_"+co.id]} onChange={e=>update("payment_confirm_"+co.id,e.target.checked)}/> Reçu vérifié dans le compte marchand</label>
 <button style={btn} disabled={busy}>Confirmer le paiement et activer</button></form>
 {co.payments?.length>0&&<div style={{marginTop:8}}><b style={{fontSize:13}}>Historique des paiements vérifiés</b>{co.payments.map((p:any)=><p key={p.id} style={{fontSize:12,margin:"4px 0",color:"#475569"}}>{p.provider==="WAVE"?"Wave":"Orange Money"} · {Number(p.amount).toLocaleString("fr-FR")} FCFA · {p.period_months} mois · Réf. {p.reference} · {new Date(p.verified_at).toLocaleDateString("fr-FR")}</p>)}</div>}
 </div>)}</>:<p>Accès Super Admin requis. Configurez PLATFORM_BOOTSTRAP_KEY puis provisionnez le compte plateforme une seule fois.</p>}</section>}
 </div>;
}
function InventorySection({warehouses,run,busy,canWrite}:{warehouses:any[];run:any;busy:boolean;canWrite:boolean}){
 const [inventories,setInventories]=useState<any[]>([]);
 const [active,setActive]=useState<any>(null);
 const [counts,setCounts]=useState<Record<number,string>>({});
 const [warehouseId,setWarehouseId]=useState("");
 const [localMsg,setLocalMsg]=useState("");
 const refresh=async()=>setInventories(await api("/api/inventories"));
 useEffect(()=>{refresh().catch((e:any)=>setLocalMsg(e.message));},[]);
 const open=async(id:number)=>{
  try{const detail=await api("/api/inventories/"+id);setActive(detail);setCounts(Object.fromEntries(detail.lines.map((line:any)=>[line.product_id,String(line.counted)])));setLocalMsg("");}
  catch(e:any){setLocalMsg(e.message);}
 };
 const create=()=>{
  if(!warehouseId){setLocalMsg("Choisissez un dépôt.");return;}
  run(async()=>{const created=await api("/api/inventories",{warehouse_id:Number(warehouseId)});const detail=await api("/api/inventories/"+created.id);setActive(detail);setCounts(Object.fromEntries(detail.lines.map((line:any)=>[line.product_id,String(line.counted)])));await refresh();},"Inventaire ouvert");
 };
 const validate=()=>{
  if(!active)return;
  run(async()=>{await api("/api/inventories/"+active.id+"/validate",{lines:active.lines.map((line:any)=>({product_id:line.product_id,counted:Number(counts[line.product_id]??line.counted)}))});setActive(null);await refresh();},"Inventaire validé");
 };
 return <section style={box}>
  <h3><ClipboardList size={18}/> Inventaire physique</h3>
  {canWrite&&<div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
   <select value={warehouseId} onChange={e=>setWarehouseId(e.target.value)} style={field}><option value="">Choisir un dépôt</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select>
   <button style={btn} disabled={busy} onClick={create}>Ouvrir un nouvel inventaire</button>
  </div>}
  {localMsg&&<p style={{color:"#b91c1c"}}>{localMsg}</p>}
  <h4 style={{marginTop:20}}>Historique et inventaires en cours</h4>
  {inventories.length===0?<p>Aucun inventaire enregistré.</p>:inventories.map(inv=><div key={inv.id} style={{display:"flex",gap:10,justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",padding:"10px 0",borderBottom:"1px solid #e5e7eb"}}>
   <div><b>Inventaire #{inv.id}</b> · {inv.warehouse_name}<div style={{fontSize:13,color:"#64748b"}}>{new Date(inv.created_at).toLocaleString("fr-FR")} · {inv.line_count} articles · Écart cumulé : {Number(inv.adjustment_units).toLocaleString("fr-FR")}</div></div>
   <div style={{display:"flex",gap:8,alignItems:"center"}}><span style={{fontSize:12,fontWeight:600,color:inv.status==="VALIDE"?"#166534":"#92400e"}}>{inv.status==="VALIDE"?"Validé":"Brouillon"}</span><button style={field} onClick={()=>open(inv.id)}>{inv.status==="VALIDE"||!canWrite?"Consulter":"Reprendre"}</button></div>
  </div>)}
  {active&&<div style={{marginTop:18}}>
   <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}><div><h4>Inventaire #{active.id} · {active.warehouse_name}</h4><small>{active.status==="VALIDE"?"Inventaire validé, consultation uniquement":"Saisissez les quantités réellement comptées"}</small></div><button type="button" style={field} onClick={()=>setActive(null)}>Fermer</button></div>
   <div style={{overflowX:"auto",marginTop:10}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:520}}><thead><tr><th align="left">Article</th><th>Stock théorique</th><th>Stock compté</th><th>Écart</th></tr></thead><tbody>{active.lines.map((line:any)=><tr key={line.product_id}><td>{line.product_name}<small style={{display:"block",color:"#64748b"}}>{line.sku} · {line.unit}</small></td><td align="center">{line.theoretical}</td><td align="center">{active.status==="BROUILLON"&&canWrite?<input aria-label={"Stock compté "+line.product_name} type="number" min="0" step="0.001" value={counts[line.product_id]??String(line.counted)} onChange={e=>setCounts(v=>({...v,[line.product_id]:e.target.value}))} style={{...field,width:110}}/>:line.counted}</td><td align="center">{active.status==="BROUILLON"&&canWrite?Number(counts[line.product_id]??line.counted)-Number(line.theoretical):line.difference}</td></tr>)}</tbody></table></div>
   {active.status==="BROUILLON"&&canWrite&&<button style={{...btn,marginTop:12}} disabled={busy} onClick={validate}>Valider l'inventaire et ajuster le stock</button>}
  </div>}
 </section>
}


function FinanceSection({permissions}:{permissions:string[]}){
 const [summary,setSummary]=useState<any>(null),[invoices,setInvoices]=useState<any[]>([]),[receipts,setReceipts]=useState<any[]>([]),[expenses,setExpenses]=useState<any[]>([]),[sessions,setSessions]=useState<any[]>([]),[suppliers,setSuppliers]=useState<any[]>([]),[customers,setCustomers]=useState<any[]>([]);
 const [start,setStart]=useState(()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth(),1).toISOString().slice(0,10);});
 const [end,setEnd]=useState(()=>new Date().toISOString().slice(0,10));
 const [invoice,setInvoice]=useState<any>({reference:"",issue_date:new Date().toISOString().slice(0,10),due_date:"",total:""});
 const [payment,setPayment]=useState<any>({amount:"",method:"VIREMENT",reference:""});
 const [receipt,setReceipt]=useState<any>({customer_id:"",amount:"",method:"ESPECES",reference:""});
 const [expense,setExpense]=useState<any>({category:"Frais généraux",label:"",amount:"",method:"ESPECES",reference:""});
 const [msg,setMsg]=useState(""),[busy,setBusy]=useState(false);
 const has=(...keys:string[])=>keys.some(k=>permissions.includes(k));
 const load=async()=>{
  const tasks:any[]=[
   has("finance.read","reports.read")?api("/api/finance/summary?start="+start+"&end="+end).catch(()=>null):Promise.resolve(null),
   has("payables.read")?api("/api/finance/supplier-invoices").catch(()=>[]):Promise.resolve([]),
   has("receivables.read")?api("/api/finance/customer-receipts").catch(()=>[]):Promise.resolve([]),
   has("finance.read")?api("/api/finance/expenses").catch(()=>[]):Promise.resolve([]),
   has("cash.read")?api("/api/finance/cash-sessions").catch(()=>[]):Promise.resolve([]),
   has("payables.write")?api("/api/suppliers").catch(()=>[]):Promise.resolve([]),
   has("receivables.write")?api("/api/customers").catch(()=>[]):Promise.resolve([])
  ];
  const [s,i,r,e,c,su,cu]=await Promise.all(tasks);
  setSummary(s);setInvoices(i);setReceipts(r);setExpenses(e);setSessions(c);setSuppliers(su);setCustomers(cu);
 };
 useEffect(()=>{load().catch((e:any)=>setMsg(e.message));},[permissions.join("|")]);
 const act=async(fn:()=>Promise<any>,done:string)=>{
  setBusy(true);setMsg("");
  try{await fn();await load();setMsg(done);}
  catch(e:any){setMsg(e.message);}
  finally{setBusy(false);}
 };
 const money=(v:number)=>Number(v||0).toLocaleString("fr-FR",{maximumFractionDigits:0})+" FCFA";
 return <section style={box}>
  <h3><Building2 size={18}/> Finance et trésorerie</h3>
  {msg&&<p role="status" style={{padding:9,background:"#fef2f2",borderRadius:8}}>{msg}</p>}
  {has("finance.read","reports.read")&&<>
   <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"end"}}>
    <label>Période début<input type="date" value={start} onChange={e=>setStart(e.target.value)} style={field}/></label>
    <label>Période fin<input type="date" value={end} onChange={e=>setEnd(e.target.value)} style={field}/></label>
    <button type="button" style={btn} onClick={()=>act(load,"Rapport actualisé")} disabled={busy}>Actualiser</button>
   </div>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:8,marginTop:14}}>
    {[[ "Chiffre d'affaires",summary?.sales_total ],["Dépenses",summary?.expenses_total],["Créances clients",summary?.receivables],["Dettes fournisseurs",summary?.payables],["Caisse ouverte",summary?.open_cash_expected],["Encaissements clients",summary?.customer_collections],["Règlements fournisseurs",summary?.supplier_payments]].map(([label,value]:any)=><div key={label} style={{padding:12,border:"1px solid #e5e7eb",borderRadius:9}}><small>{label}</small><b style={{display:"block",marginTop:4}}>{money(value||0)}</b></div>)}
   </div>
   <h4>Ventes par jour</h4>
   {(summary?.daily_sales||[]).length===0?<p>Aucune vente sur cette période.</p>:(summary.daily_sales||[]).map((d:any)=><div key={d.date} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid #e5e7eb"}}><span>{new Date(d.date+"T00:00:00").toLocaleDateString("fr-FR")} · {d.count} ventes</span><b>{money(d.total)}</b></div>)}
   <h4>Meilleures ventes produits</h4>
   {(summary?.top_products||[]).map((p:any)=><div key={p.product_id} style={{display:"flex",justifyContent:"space-between",padding:"5px 0"}}><span>{p.name} · {p.quantity}</span><b>{money(p.total)}</b></div>)}
   <h4>Répartition des paiements des ventes</h4>
   {(summary?.payments_by_method||[]).map((p:any)=><div key={p.method} style={{display:"flex",justifyContent:"space-between",padding:"5px 0"}}><span>{p.method}</span><b>{money(p.amount)}</b></div>)}
  </>}
  {has("payables.write")&&<><h4>Enregistrer une facture fournisseur</h4>
   <form onSubmit={e=>{e.preventDefault();act(async()=>{await api("/api/finance/supplier-invoices",{...invoice,supplier_id:Number(invoice.supplier_id),total:Number(invoice.total),due_date:invoice.due_date||null});setInvoice({reference:"",issue_date:new Date().toISOString().slice(0,10),due_date:"",total:""});},"Facture fournisseur enregistrée");}} style={{display:"flex",gap:8,flexWrap:"wrap"}}>
    <select required value={invoice.supplier_id||""} onChange={e=>setInvoice((v:any)=>({...v,supplier_id:e.target.value}))} style={field}><option value="">Fournisseur</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
    <input required placeholder="Référence facture" value={invoice.reference} onChange={e=>setInvoice((v:any)=>({...v,reference:e.target.value}))} style={field}/>
    <input required type="date" value={invoice.issue_date} onChange={e=>setInvoice((v:any)=>({...v,issue_date:e.target.value}))} style={field}/>
    <input type="date" value={invoice.due_date} onChange={e=>setInvoice((v:any)=>({...v,due_date:e.target.value}))} style={field}/>
    <input required type="number" min="0.01" step="0.01" placeholder="Montant FCFA" value={invoice.total} onChange={e=>setInvoice((v:any)=>({...v,total:e.target.value}))} style={field}/>
    <button style={btn} disabled={busy}>Enregistrer la dette</button>
   </form>
  </>}
  {has("payables.read")&&<><h4>Dettes fournisseurs et règlements</h4>
   {invoices.map(i=><div key={i.id} style={{padding:10,borderBottom:"1px solid #e5e7eb"}}>
    <div style={{display:"flex",gap:8,justifyContent:"space-between",flexWrap:"wrap"}}><span><b>{i.supplier_name}</b> · {i.reference} · {i.status}</span><b>Reste : {money(i.remaining)}</b></div>
    {i.remaining>0&&has("payables.write")&&<form onSubmit={e=>{e.preventDefault();act(async()=>{await api("/api/finance/supplier-invoices/"+i.id+"/payments",{amount:Number(payment.amount),method:payment.method,reference:payment.reference});setPayment({amount:"",method:"VIREMENT",reference:""});},"Règlement fournisseur enregistré");}} style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
     <input required type="number" min="0.01" max={i.remaining} step="0.01" placeholder={"Montant (reste "+i.remaining+")"} value={payment.amount} onChange={e=>setPayment((v:any)=>({...v,amount:e.target.value}))} style={field}/>
     <select value={payment.method} onChange={e=>setPayment((v:any)=>({...v,method:e.target.value}))} style={field}><option value="ESPECES">Espèces</option><option value="WAVE">Wave</option><option value="ORANGE_MONEY">Orange Money</option><option value="VIREMENT">Virement</option><option value="CARTE_BANCAIRE">Carte</option></select>
     <input placeholder="Référence paiement" value={payment.reference} onChange={e=>setPayment((v:any)=>({...v,reference:e.target.value}))} style={field}/>
     <button style={btn} disabled={busy}>Régler</button>
    </form>}
   </div>)}
  </>}
  {has("receivables.write")&&<><h4>Encaisser une créance client</h4>
   <form onSubmit={e=>{e.preventDefault();act(async()=>{await api("/api/finance/customer-receipts",{customer_id:Number(receipt.customer_id),amount:Number(receipt.amount),method:receipt.method,reference:receipt.reference});setReceipt({customer_id:"",amount:"",method:"ESPECES",reference:""});},"Encaissement client enregistré");}} style={{display:"flex",gap:8,flexWrap:"wrap"}}>
    <select required value={receipt.customer_id} onChange={e=>setReceipt((v:any)=>({...v,customer_id:e.target.value}))} style={field}><option value="">Client</option>{customers.filter(c=>Number(c.balance_due)>0).map(c=><option key={c.id} value={c.id}>{c.name} · reste {money(c.balance_due)}</option>)}</select>
    <input required type="number" min="0.01" step="0.01" placeholder="Montant encaissé" value={receipt.amount} onChange={e=>setReceipt((v:any)=>({...v,amount:e.target.value}))} style={field}/>
    <select value={receipt.method} onChange={e=>setReceipt((v:any)=>({...v,method:e.target.value}))} style={field}><option value="ESPECES">Espèces</option><option value="WAVE">Wave</option><option value="ORANGE_MONEY">Orange Money</option><option value="FREE_MONEY">Free Money</option><option value="VIREMENT">Virement</option></select>
    <input placeholder="Référence paiement" value={receipt.reference} onChange={e=>setReceipt((v:any)=>({...v,reference:e.target.value}))} style={field}/>
    <button style={btn} disabled={busy}>Enregistrer l'encaissement</button>
   </form>
  </>}
  {has("receivables.read")&&<><h4>Historique des encaissements clients</h4>{receipts.slice(0,30).map(r=><p key={r.id}>{r.customer_name} · {new Date(r.created_at).toLocaleDateString("fr-FR")} · {r.method} · <b>{money(r.amount)}</b> {r.reference}</p>)}</>}
  {has("finance.write")&&<><h4>Enregistrer une dépense</h4>
   <form onSubmit={e=>{e.preventDefault();act(async()=>{await api("/api/finance/expenses",{...expense,amount:Number(expense.amount)});setExpense({category:"Frais généraux",label:"",amount:"",method:"ESPECES",reference:""});},"Dépense enregistrée");}} style={{display:"flex",gap:8,flexWrap:"wrap"}}>
    <input required placeholder="Catégorie" value={expense.category} onChange={e=>setExpense((v:any)=>({...v,category:e.target.value}))} style={field}/>
    <input required placeholder="Libellé de la dépense" value={expense.label} onChange={e=>setExpense((v:any)=>({...v,label:e.target.value}))} style={field}/>
    <input required type="number" min="0.01" step="0.01" placeholder="Montant FCFA" value={expense.amount} onChange={e=>setExpense((v:any)=>({...v,amount:e.target.value}))} style={field}/>
    <select value={expense.method} onChange={e=>setExpense((v:any)=>({...v,method:e.target.value}))} style={field}><option value="ESPECES">Espèces</option><option value="WAVE">Wave</option><option value="ORANGE_MONEY">Orange Money</option><option value="VIREMENT">Virement</option><option value="CARTE_BANCAIRE">Carte</option></select>
    <input placeholder="Référence" value={expense.reference} onChange={e=>setExpense((v:any)=>({...v,reference:e.target.value}))} style={field}/>
    <button style={btn} disabled={busy}>Enregistrer la dépense</button>
   </form>
  </>}
  {has("finance.read")&&<><h4>Dernières dépenses</h4>{expenses.slice(0,30).map(e=><p key={e.id}>{new Date(e.created_at).toLocaleDateString("fr-FR")} · {e.category} · {e.label} · {e.method} · <b>{money(e.amount)}</b></p>)}</>}
  {has("cash.read")&&<><h4>Historique des sessions de caisse</h4>{sessions.slice(0,30).map(s=><p key={s.id}>{s.user_name} · {new Date(s.opened_at).toLocaleString("fr-FR")} · {s.status} · Fond {money(s.opening)} · Attendu {money(s.expected)} · Compté {money(s.counted)} · Écart {money(s.variance)}<small style={{display:"block",color:"#64748b"}}>Dépenses {money(s.expenses)} · Paiements fournisseurs {money(s.supplier_payments)} · Encaissements clients {money(s.customer_receipts)}</small></p>)}</>}
 </section>;
}

