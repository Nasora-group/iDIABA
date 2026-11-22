import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ReceiptPrint from "./receipt-print";

type Sale = {
  id: string; tenant_id: string; location_id: string; cashier_id: string | null;
  created_at: string; subtotal: number | string; tax_total: number | string; total: number | string;
};
type Item = {
  id: string; product_name: string; sku: string | null; quantity: number | string;
  unit_price: number | string; line_subtotal: number | string; line_tax: number | string; line_total: number | string;
};
type Payment = { id: string; payment_method: string; amount: number | string; payment_reference: string | null };

const money = (value: number | string) => Number(value).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " F";

const paymentLabel: Record<string, string> = {
  cash: "Espèces", mobile_money: "Mobile Money", wave: "Wave", orange_money: "Orange Money",
  card: "Carte bancaire", bank_transfer: "Virement",
};

export default async function SaleReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: saleData, error: saleError } = await supabase.from("sales")
    .select("id,tenant_id,location_id,cashier_id,created_at,subtotal,tax_total,total")
    .eq("id", id).eq("status", "completed").maybeSingle();
  if (saleError || !saleData) notFound();
  const sale = saleData as Sale;

  const [tenantResult, locationResult, cashierResult, itemsResult, paymentsResult] = await Promise.all([
    supabase.from("tenants").select("name").eq("id", sale.tenant_id).maybeSingle(),
    supabase.from("stock_locations").select("name,code").eq("id", sale.location_id).eq("tenant_id", sale.tenant_id).maybeSingle(),
    sale.cashier_id ? supabase.from("profiles").select("full_name").eq("id", sale.cashier_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabase.from("sale_items").select("id,product_name,sku,quantity,unit_price,line_subtotal,line_tax,line_total").eq("tenant_id", sale.tenant_id).eq("sale_id", sale.id).order("created_at"),
    supabase.from("sale_payments").select("id,payment_method,amount,payment_reference").eq("tenant_id", sale.tenant_id).eq("sale_id", sale.id).order("created_at"),
  ]);
  const items = (itemsResult.data ?? []) as unknown as Item[];
  const payments = (paymentsResult.data ?? []) as unknown as Payment[];
  if (itemsResult.error || paymentsResult.error || !items.length) notFound();

  return (
    <main className="shell receipt-page">
      <header className="topbar receipt-actions"><div className="brand"><span className="mark">i</span><span>iDIABA</span></div><Link href="/app/pos">Retour à la caisse</Link></header>
      <section className="receipt-card">
        <div className="receipt-header">
          <h1>{tenantResult.data?.name ?? "Entreprise"}</h1>
          <p>{locationResult.data?.name ?? "Point de vente"}{locationResult.data?.code ? ` · ${locationResult.data.code}` : ""}</p>
          <h2>Ticket de caisse</h2>
        </div>
        <div className="receipt-meta">
          <div><span>Ticket</span><strong>{sale.id.slice(0, 8).toUpperCase()}</strong></div>
          <div><span>Date</span><strong>{new Date(sale.created_at).toLocaleString("fr-FR")}</strong></div>
          <div><span>Caissier</span><strong>{cashierResult.data?.full_name ?? "—"}</strong></div>
        </div>
        <div className="receipt-lines">
          {items.map((item) => <article key={item.id}>
            <div className="receipt-item-name"><strong>{item.product_name}</strong>{item.sku && <small>Réf. {item.sku}</small>}</div>
            <div className="receipt-item-calculation"><span>{item.quantity} × {money(item.unit_price)}</span><strong>{money(item.line_total)}</strong></div>
            <small>HT {money(item.line_subtotal)} · Taxes {money(item.line_tax)}</small>
          </article>)}
        </div>
        <div className="receipt-totals">
          <div><span>Sous-total HT</span><strong>{money(sale.subtotal)}</strong></div>
          <div><span>Taxes</span><strong>{money(sale.tax_total)}</strong></div>
          <div className="receipt-grand-total"><span>TOTAL TTC</span><strong>{money(sale.total)}</strong></div>
        </div>
        <div className="receipt-payments"><h3>Paiements</h3>{payments.map((payment) => <div key={payment.id}><span>{paymentLabel[payment.payment_method] ?? payment.payment_method}{payment.payment_reference && <small>Réf. {payment.payment_reference}</small>}</span><strong>{money(payment.amount)}</strong></div>)}</div>
        <footer className="receipt-footer"><p>Merci pour votre achat !</p><small>Ticket généré par iDIABA</small></footer>
      </section>
      <ReceiptPrint />
    </main>
  );
}
