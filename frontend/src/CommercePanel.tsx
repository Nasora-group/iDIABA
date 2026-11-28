import {useEffect,useState} from "react";
import {FileText,ClipboardList,Truck,Plus,RefreshCw,CheckCircle2} from "lucide-react";

const field:React.CSSProperties={padding:10,border:"1px solid #d1d5db",borderRadius:8,minWidth:110,maxWidth:"100%"};
const button:React.CSSProperties={padding:"9px 12px",border:0,borderRadius:8,background:"#166534",color:"#fff",cursor:"pointer",fontWeight:600};
const secondary:React.CSSProperties={...button,background:"#e5e7eb",color:"#1f2937"};
const card:React.CSSProperties={border:"1px solid #e5e7eb",borderRadius:10,padding:12,marginTop:10};
const api=async(path:string,body?:any,method?:string)=>{
 const token=localStorage.getItem("idiaba_token");
 const response=await fetch(path,{method:method||(body!==undefined?"POST":"GET"),headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 if(!response.ok){let message="Erreur API";try{message=(await response.json()).detail||message}catch{}throw new Error(message);}
 return response.status===204?null:response.json();
};
const money=(value:number)=>Number(value||0).toLocaleString("fr-FR",{maximumFractionDigits:2})+" FCFA";

export default function CommercePanel({canWrite=true}:{canWrite?:boolean}){
 const [customers,setCustomers]=useState<any[]>([]);
 const [products,setProducts]=useState<any[]>([]);
 const [warehouses,setWarehouses]=useState<any[]>([]);
 const [quotes,setQuotes]=useState<any[]>([]);
 const [orders,setOrders]=useState<any[]>([]);
 const [form,setForm]=useState<any>({customer_id:"",reference:"",valid_until:"",note:""});
 const [lines,setLines]=useState<any[]>([{product_id:"",quantity:"1",unit_price:"",tax_rate:"18"}]);
 const [warehouseId,setWarehouseId]=useState("");
 const [orderReference,setOrderReference]=useState("");
 const [deliveryOrder,setDeliveryOrder]=useState<any>(null);
 const [deliveryReference,setDeliveryReference]=useState("");
 const [deliveryQtys,setDeliveryQtys]=useState<Record<number,string>>({});
 const [message,setMessage]=useState("");
 const [busy,setBusy]=useState(false);

 const load=async()=>{
  const [c,p,w,q,o]=await Promise.all([
   api("/api/customers"),api("/api/products"),api("/api/warehouses"),
   api("/api/quotes"),api("/api/customer-orders")
  ]);
  setCustomers(c);setProducts(p);setWarehouses(w);setQuotes(q);setOrders(o);
  if(!warehouseId&&w.length)setWarehouseId(String(w[0].id));
 };
 useEffect(()=>{load().catch((e:any)=>setMessage(e.message));},[]);
 const updateLine=(index:number,key:string,value:string)=>setLines(rows=>rows.map((row,i)=>i===index?{...row,[key]:value}:row));
 const selectedProduct=(id:string)=>products.find(p=>p.id===Number(id));
 const act=async(fn:()=>Promise<any>,success:string)=>{
  setBusy(true);setMessage("");
  try{await fn();await load();setMessage(success);}
  catch(e:any){setMessage(e.message||"Opération impossible");}
  finally{setBusy(false);}
 };
 const createQuote=async(e:any)=>{
  e.preventDefault();
  const clean=lines.filter(l=>l.product_id&&Number(l.quantity)>0).map(l=>({product_id:Number(l.product_id),quantity:Number(l.quantity),unit_price:Number(l.unit_price),tax_rate:Number(l.tax_rate)}));
  if(!clean.length){setMessage("Ajoutez au moins un article au devis.");return;}
  await act(async()=>{
   await api("/api/quotes",{...form,customer_id:Number(form.customer_id),valid_until:form.valid_until||null,lines:clean});
   setForm({customer_id:"",reference:"",valid_until:"",note:""});
   setLines([{product_id:"",quantity:"1",unit_price:"",tax_rate:"18"}]);
  },"Devis créé");
 };
 const updateQuote=async(id:number,status:string)=>act(()=>api("/api/quotes/"+id+"/status?status="+status,undefined,"POST"),"Statut du devis mis à jour");
 const convertQuote=async(quote:any)=>{
  if(!warehouseId){setMessage("Choisissez le dépôt de préparation.");return;}
  const reference=orderReference.trim();
  if(!reference){setMessage("Saisissez la référence de la commande à créer.");return;}
  await act(()=>api("/api/quotes/"+quote.id+"/convert?reference="+encodeURIComponent(reference)+"&warehouse_id="+warehouseId,undefined,"POST"),"Devis converti en commande");
  setOrderReference("");
 };
 const confirmOrder=(order:any)=>act(()=>api("/api/customer-orders/"+order.id+"/confirm",undefined,"POST"),"Commande confirmée et stock réservé");
 const openDelivery=(order:any)=>{
  setDeliveryOrder(order);
  setDeliveryReference("BL-"+order.reference+"-"+(order.deliveries_count||Date.now().toString().slice(-4)));
  setDeliveryQtys(Object.fromEntries(order.lines.map((line:any)=>[line.id,String(Math.max(0,line.reserved-line.delivered))])));
 };
 const submitDelivery=async()=>{
  if(!deliveryOrder)return;
  const deliveryLines=deliveryOrder.lines.map((line:any)=>({order_line_id:line.id,quantity:Number(deliveryQtys[line.id]||0)})).filter((line:any)=>line.quantity>0);
  if(!deliveryLines.length){setMessage("Saisissez au moins une quantité à livrer.");return;}
  await act(async()=>{
   await api("/api/customer-orders/"+deliveryOrder.id+"/deliveries",{reference:deliveryReference,lines:deliveryLines});
   setDeliveryOrder(null);
  },"Bon de livraison validé. Stock mis à jour.");
 };
 const statusLabel:Record<string,string>={BROUILLON:"Brouillon",ENVOYE:"Envoyé",ACCEPTE:"Accepté",REFUSE:"Refusé",EXPIRE:"Expiré",CONVERTI:"Converti",CONFIRMEE:"Confirmée",PARTIELLE:"Partiellement livrée",LIVREE:"Livrée"};
 return <section style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:12,padding:16,marginBottom:14}}>
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap"}}>
   <h3 style={{margin:"0 0 8px",display:"flex",gap:8,alignItems:"center"}}><FileText size={19}/> Devis et commandes clients</h3>
   <button style={secondary} onClick={()=>load().catch((e:any)=>setMessage(e.message))}><RefreshCw size={15}/> Actualiser</button>
  </div>
  {message&&<p style={{padding:10,background:"#f0fdf4",borderRadius:8}}>{message}</p>}
  {canWrite&&<form onSubmit={createQuote} style={{display:"grid",gap:10,borderBottom:"1px solid #e5e7eb",paddingBottom:16}}>
   <h4 style={{margin:"4px 0"}}>Créer un devis</h4>
   <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
    <select required value={form.customer_id} onChange={e=>setForm((v:any)=>({...v,customer_id:e.target.value}))} style={{...field,flex:"1 1 180px"}}><option value="">Sélectionner un client</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
    <input required placeholder="Référence devis" value={form.reference} onChange={e=>setForm((v:any)=>({...v,reference:e.target.value}))} style={{...field,flex:"1 1 150px"}}/>
    <input type="date" value={form.valid_until} onChange={e=>setForm((v:any)=>({...v,valid_until:e.target.value}))} style={field} title="Valable jusqu'au"/>
   </div>
   {lines.map((line,index)=><div key={index} style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
    <select required value={line.product_id} onChange={e=>{const p=selectedProduct(e.target.value);updateLine(index,"product_id",e.target.value);if(p)updateLine(index,"unit_price",String(p.sale_price));}} style={{...field,flex:"2 1 190px"}}><option value="">Article</option>{products.map(p=><option key={p.id} value={p.id}>{p.name} · {p.unit}</option>)}</select>
    <input required type="number" min="0.001" step="0.001" placeholder="Qté" value={line.quantity} onChange={e=>updateLine(index,"quantity",e.target.value)} style={{...field,width:85,minWidth:75}}/>
    <input required type="number" min="0" step="0.01" placeholder="Prix unitaire" value={line.unit_price} onChange={e=>updateLine(index,"unit_price",e.target.value)} style={{...field,width:130,minWidth:105}}/>
    <input required type="number" min="0" max="100" step="0.01" placeholder="TVA %" value={line.tax_rate} onChange={e=>updateLine(index,"tax_rate",e.target.value)} style={{...field,width:85,minWidth:75}}/>
    {lines.length>1&&<button type="button" style={secondary} onClick={()=>setLines(v=>v.filter((_,i)=>i!==index))}>Retirer</button>}
   </div>)}
   <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
    <button type="button" style={secondary} onClick={()=>setLines(v=>[...v,{product_id:"",quantity:"1",unit_price:"",tax_rate:"18"}])}><Plus size={15}/> Ajouter un article</button>
    <input placeholder="Note / conditions" value={form.note} onChange={e=>setForm((v:any)=>({...v,note:e.target.value}))} style={{...field,flex:"1 1 180px"}}/>
    <button disabled={busy} style={button}>Créer le devis</button>
   </div>
  </form>}
  <h4 style={{marginBottom:6}}>Devis ({quotes.length})</h4>
  {quotes.length===0?<p>Aucun devis enregistré.</p>:quotes.map(q=><div key={q.id} style={card}>
   <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
    <div><b>{q.reference}</b> · {q.customer_name}<div style={{fontSize:13,color:"#64748b"}}>{q.lines.map((l:any)=>l.label+" × "+l.quantity).join(" · ")}</div></div>
    <div style={{textAlign:"right"}}><b>{money(q.total)}</b><div style={{fontSize:12,color:"#64748b"}}>{statusLabel[q.status]||q.status}</div></div>
   </div>
   {canWrite&&<div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:10}}>
    {q.status==="BROUILLON"&&<button style={secondary} disabled={busy} onClick={()=>updateQuote(q.id,"ENVOYE")}>Marquer envoyé</button>}
    {["BROUILLON","ENVOYE"].includes(q.status)&&<button style={button} disabled={busy} onClick={()=>updateQuote(q.id,"ACCEPTE")}><CheckCircle2 size={14}/> Accepter</button>}
    {["BROUILLON","ENVOYE"].includes(q.status)&&<button style={secondary} disabled={busy} onClick={()=>updateQuote(q.id,"REFUSE")}>Refuser</button>}
    {q.status==="ACCEPTE"&&<><select value={warehouseId} onChange={e=>setWarehouseId(e.target.value)} style={field}><option value="">Dépôt de préparation</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select><input placeholder="Réf. commande" value={orderReference} onChange={e=>setOrderReference(e.target.value)} style={field}/><button style={button} disabled={busy} onClick={()=>convertQuote(q)}>Convertir en commande</button></>}
   </div>}
  </div>)}
  <h4 style={{marginBottom:6,marginTop:22}}><ClipboardList size={16}/> Commandes clients ({orders.length})</h4>
  {orders.length===0?<p>Aucune commande client.</p>:orders.map(order=><div key={order.id} style={card}>
   <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
    <div><b>{order.reference}</b> · {order.customer_name}<div style={{fontSize:13,color:"#64748b"}}>{order.lines.map((l:any)=>l.label+" · "+l.delivered+"/"+l.quantity).join(" | ")}</div></div>
    <div style={{textAlign:"right"}}><b>{money(order.total)}</b><div style={{fontSize:12,color:"#64748b"}}>{statusLabel[order.status]||order.status}</div></div>
   </div>
   {canWrite&&<div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:10}}>
    {order.status==="BROUILLON"&&<button style={button} disabled={busy} onClick={()=>confirmOrder(order)}>Confirmer et réserver le stock</button>}
    {["CONFIRMEE","PARTIELLE"].includes(order.status)&&<button style={button} disabled={busy} onClick={()=>openDelivery(order)}><Truck size={14}/> Préparer une livraison</button>}
    {["CONFIRMEE","PARTIELLE"].includes(order.status)&&<small style={{alignSelf:"center",color:"#64748b"}}>Réservé : {order.lines.reduce((n:number,l:any)=>n+l.reserved-l.delivered,0)}</small>}
   </div>}
  </div>)}
  {deliveryOrder&&<div style={{...card,border:"2px solid #166534",marginTop:16}}>
   <h4 style={{marginTop:0}}>Bon de livraison · {deliveryOrder.reference}</h4>
   <input required placeholder="Référence du bon" value={deliveryReference} onChange={e=>setDeliveryReference(e.target.value)} style={{...field,width:"100%",boxSizing:"border-box"}}/>
   {deliveryOrder.lines.map((line:any)=><div key={line.id} style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center",padding:"8px 0",borderBottom:"1px solid #e5e7eb"}}>
    <span>{line.label}<small style={{display:"block",color:"#64748b"}}>À livrer : {Math.max(0,line.reserved-line.delivered)}</small></span>
    <input type="number" min="0" max={Math.max(0,line.reserved-line.delivered)} step="0.001" value={deliveryQtys[line.id]||"0"} onChange={e=>setDeliveryQtys(v=>({...v,[line.id]:e.target.value}))} style={{...field,width:105,minWidth:90}}/>
   </div>)}
   <div style={{display:"flex",gap:8,marginTop:12}}><button style={button} disabled={busy} onClick={submitDelivery}>Valider le bon et déduire le stock</button><button style={secondary} onClick={()=>setDeliveryOrder(null)}>Annuler</button></div>
  </div>}
  <p style={{fontSize:12,color:"#64748b",marginBottom:0}}>Le stock est réservé à la confirmation de la commande et n'est déduit qu'à la validation d'un bon de livraison.</p>
 </section>;
}
