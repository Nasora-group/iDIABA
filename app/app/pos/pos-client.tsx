"use client";

import { useEffect, useMemo, useState } from "react";
import { checkoutSale } from "./actions";

type Product = { id: string; name: string; sku: string; unit: string; sale_price: string | number; tax_rate: string | number };
type CartLine = { product_id: string; quantity: string };
type PaymentLine = { method: string; amount: string };
type Props = { tenantId: string; locationId: string; sessionId: string; clientSaleId: string; products: Product[] };

function toCents(value: string | number) {
  const [whole, fraction = ""] = String(value).split(".");
  return Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
}
function formatCents(cents: number) {
  return (cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function POSCheckout({ tenantId, locationId, sessionId, clientSaleId, products }: Props) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [payments, setPayments] = useState<PaymentLine[]>([{ method: "cash", amount: "" }]);

  const totals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    for (const line of cart) {
      const product = products.find((item) => item.id === line.product_id);
      if (!product) continue;
      const qtyMilli = Math.round(Number(line.quantity) * 1000);
      const lineSubtotal = Math.round(qtyMilli * toCents(product.sale_price) / 1000);
      const lineTax = Math.round(lineSubtotal * Number(product.tax_rate) / 100);
      subtotal += lineSubtotal;
      tax += lineTax;
    }
    return { subtotal, tax, total: subtotal + tax };
  }, [cart, products]);

  useEffect(() => {
    if (payments.length === 1) {
      const amount = (totals.total / 100).toFixed(2);
      setPayments((current) => current.length === 1 && current[0].amount !== amount
        ? [{ ...current[0], amount }] : current);
    }
  }, [payments.length, totals.total]);

  const paidTotal = payments.reduce((sum, payment) => {
    const amount = Number(payment.amount.replace(",", "."));
    return sum + (Number.isFinite(amount) && amount > 0 ? toCents(payment.amount.replace(",", ".")) : 0);
  }, 0);
  const paymentsValid = payments.length > 0 && payments.every((payment) => {
    const amount = Number(payment.amount.replace(",", "."));
    return ["cash", "mobile_money", "card", "bank_transfer"].includes(payment.method)
      && Number.isFinite(amount) && amount > 0;
  }) && paidTotal === totals.total;

  function addLine() {
    const qty = Number(quantity);
    if (!productId || !Number.isFinite(qty) || qty <= 0 || qty > 1000000) return;
    setCart((current) => {
      const existing = current.find((line) => line.product_id === productId);
      if (existing) return current.map((line) => line.product_id === productId
        ? { ...line, quantity: String(Number(line.quantity) + qty) } : line);
      return [...current, { product_id: productId, quantity }];
    });
    setQuantity("1");
  }

  return (
    <form action={checkoutSale} className="pos-checkout">
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="location_id" value={locationId} />
      <input type="hidden" name="session_id" value={sessionId} />
      <input type="hidden" name="client_sale_id" value={clientSaleId} />
      <input type="hidden" name="items_json" value={JSON.stringify(cart)} />
      <input type="hidden" name="payments_json" value={JSON.stringify(payments)} />
      <h3>Nouvelle vente</h3>
      <div className="pos-add-row">
        <label>Produit
          <select value={productId} onChange={(event) => setProductId(event.target.value)} required>
            {products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku} · {Number(product.sale_price).toLocaleString("fr-FR")} F</option>)}
          </select>
        </label>
        <label>Quantité
          <input type="number" min="0.001" max="1000000" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} required />
        </label>
        <button type="button" className="secondary" onClick={addLine}>Ajouter</button>
      </div>
      <div className="pos-cart">
        {cart.length ? cart.map((line) => {
          const product = products.find((item) => item.id === line.product_id);
          if (!product) return null;
          return <div className="pos-cart-line" key={line.product_id}>
            <div><strong>{product.name}</strong><small>{line.quantity} {product.unit} × {Number(product.sale_price).toLocaleString("fr-FR")} F</small></div>
            <strong>{(Math.round(Number(line.quantity) * 1000) * toCents(product.sale_price) / 100000).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} F</strong>
            <button type="button" className="archive-button" onClick={() => setCart((current) => current.filter((item) => item.product_id !== line.product_id))}>Retirer</button>
          </div>;
        }) : <p className="catalog-empty">Ajoutez les produits à vendre.</p>}
      </div>
      <div className="pos-totals">
        <div><span>Sous-total HT</span><strong>{formatCents(totals.subtotal)} F</strong></div>
        <div><span>Taxes</span><strong>{formatCents(totals.tax)} F</strong></div>
        <div className="pos-grand-total"><span>Total à payer</span><strong>{formatCents(totals.total)} F</strong></div>
      </div>
      <div className="pos-payment-section">
        <div className="pos-payment-heading"><strong>Règlement</strong><button type="button" className="secondary" onClick={() => setPayments((current) => current.length < 4 ? [...current, { method: "mobile_money", amount: "" }] : current)} disabled={payments.length >= 4}>Ajouter un moyen de paiement</button></div>
        {payments.map((payment, index) => (
          <div className="pos-payment-row" key={index}>
            <label>Moyen de paiement
              <select value={payment.method} onChange={(event) => setPayments((current) => current.map((item, i) => i === index ? { ...item, method: event.target.value } : item))}>
                <option value="cash">Espèces</option><option value="mobile_money">Mobile Money</option><option value="card">Carte bancaire</option><option value="bank_transfer">Virement</option>
              </select>
            </label>
            <label>Montant (FCFA)
              <input type="number" min="0.01" step="0.01" value={payment.amount} onChange={(event) => setPayments((current) => current.map((item, i) => i === index ? { ...item, amount: event.target.value } : item))} required />
            </label>
            {payments.length > 1 && <button type="button" className="archive-button" onClick={() => setPayments((current) => current.filter((_, i) => i !== index))}>Retirer</button>}
          </div>
        ))}
        <div className="pos-payment-total"><span>Montant réglé</span><strong>{formatCents(paidTotal)} F / {formatCents(totals.total)} F</strong></div>
        {!paymentsValid && cart.length > 0 && <p className="catalog-help">Répartissez le montant exact entre les moyens de paiement.</p>}
      </div>
      <button className="primary" type="submit" disabled={!cart.length || totals.total <= 0 || !paymentsValid}>Valider et encaisser</button>
      <p className="catalog-help">La validation vérifie le stock et enregistre la vente, les différents paiements et les sorties de stock dans une seule transaction.</p>
    </form>
  );
}
