"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { enqueueOfflineSale, loadOfflineSales, removeOfflineSale } from "./offline-store";
import { checkoutSale } from "./actions";

type Product = { id: string; name: string; sku: string; barcode?: string | null; unit: string; sale_price: string | number; tax_rate: string | number };
type CartLine = { product_id: string; quantity: string };
type PaymentLine = { method: string; amount: string; reference?: string };
type Props = { userId: string; tenantId: string; locationId: string; sessionId: string; clientSaleId: string; products: Product[] };

function toCents(value: string | number) {
  const [whole, fraction = ""] = String(value).split(".");
  return Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
}
function formatCents(cents: number) {
  return (cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function POSCheckout({ userId, tenantId, locationId, sessionId, clientSaleId, products }: Props) {
  const [activeSaleId, setActiveSaleId] = useState(clientSaleId);
  const [offlineMessage, setOfflineMessage] = useState("");
  const syncLock = useRef(false);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [barcodeQuery, setBarcodeQuery] = useState("");
  const [barcodeMessage, setBarcodeMessage] = useState("");
  const barcodeInput = useRef<HTMLInputElement>(null);
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

  const effectivePayments = payments.length === 1
    ? [{ ...payments[0], amount: (totals.total / 100).toFixed(2) }]
    : payments;

  const paidTotal = effectivePayments.reduce((sum, payment) => {
    const amount = Number(payment.amount.replace(",", "."));
    return sum + (Number.isFinite(amount) && amount > 0 ? toCents(payment.amount.replace(",", ".")) : 0);
  }, 0);
  const paymentsValid = effectivePayments.length > 0 && effectivePayments.every((payment) => {
    const amount = Number(payment.amount.replace(",", "."));
    return ["cash", "mobile_money", "card", "bank_transfer", "wave", "orange_money"].includes(payment.method)
      && Number.isFinite(amount) && amount > 0
      && (!["wave", "orange_money"].includes(payment.method) || (payment.reference ?? "").trim().length >= 4);
  }) && paidTotal === totals.total;

  useEffect(() => {
    const syncPending = async () => {
      if (!navigator.onLine || syncLock.current) return;
      syncLock.current = true;
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || user.id !== userId) return;
        const pending = await loadOfflineSales(userId);
        for (const sale of pending) {
          const { error } = await supabase.rpc("finalize_sale", {
            p_tenant_id: sale.tenantId, p_location_id: sale.locationId,
            p_cash_session_id: sale.sessionId, p_client_sale_id: sale.id,
            p_items: sale.items, p_payments: sale.payments,
          });
          if (error) { setOfflineMessage("Une vente hors connexion reste en attente : " + error.message); break; }
          await removeOfflineSale(sale.id);
        }
        if (pending.length > 0 && (await loadOfflineSales(userId)).length === 0) setOfflineMessage("Les ventes hors connexion sont synchronisées.");
      } catch { setOfflineMessage("Synchronisation impossible pour le moment. Les ventes restent conservées sur cet appareil."); }
      finally { syncLock.current = false; }
    };
    window.addEventListener("online", syncPending);
    void syncPending();
    return () => window.removeEventListener("online", syncPending);
  }, [userId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (navigator.onLine) return;
    event.preventDefault();
    if (!cart.length || totals.total <= 0 || !paymentsValid) return;
    try {
      await enqueueOfflineSale({
        id: activeSaleId, userId, tenantId, locationId, sessionId,
        items: cart, payments: effectivePayments, createdAt: Date.now(),
      });
      setCart([]);
      setPayments([{ method: "cash", amount: "" }]);
      setActiveSaleId(crypto.randomUUID());
      setOfflineMessage("Vente enregistrée sur cet appareil. Elle sera synchronisée au retour du réseau.");
    } catch {
      setOfflineMessage("Impossible d’enregistrer la vente localement. Vérifiez l’espace de stockage du navigateur.");
    }
  }

  function addLineForProduct(selectedProductId: string, qtyValue = quantity) {
    const qty = Number(qtyValue);
    if (!selectedProductId || !Number.isFinite(qty) || qty <= 0 || qty > 1000000) return false;
    setCart((current) => {
      const existing = current.find((line) => line.product_id === selectedProductId);
      if (existing) return current.map((line) => line.product_id === selectedProductId
        ? { ...line, quantity: String(Number(line.quantity) + qty) } : line);
      return [...current, { product_id: selectedProductId, quantity: String(qty) }];
    });
    setQuantity("1");
    return true;
  }

  function addLine() {
    addLineForProduct(productId);
  }

  function handleBarcodeKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const query = barcodeQuery.trim().toLocaleLowerCase();
    if (!query) return;
    const match = products.find((product) =>
      (product.barcode ?? "").trim().toLocaleLowerCase() === query
      || product.sku.trim().toLocaleLowerCase() === query
    );
    if (!match) {
      setBarcodeMessage("Code non reconnu. Vérifiez le produit ou ajoutez-le au catalogue.");
      return;
    }
    addLineForProduct(match.id, quantity);
    setProductId(match.id);
    setBarcodeQuery("");
    setBarcodeMessage(`Ajouté : ${match.name}`);
    barcodeInput.current?.focus();
  }

  return (
    <form action={checkoutSale} onSubmit={handleSubmit} className="pos-checkout">
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="location_id" value={locationId} />
      <input type="hidden" name="session_id" value={sessionId} />
      <input type="hidden" name="client_sale_id" value={activeSaleId} />
      <input type="hidden" name="items_json" value={JSON.stringify(cart)} />
      <input type="hidden" name="payments_json" value={JSON.stringify(effectivePayments)} />
      <h3>Nouvelle vente</h3>
      <label className="pos-barcode-row">Scanner un code-barres ou saisir le SKU
        <input ref={barcodeInput} value={barcodeQuery} onChange={(event) => { setBarcodeQuery(event.target.value); setBarcodeMessage(""); }} onKeyDown={handleBarcodeKeyDown} type="text" inputMode="search" placeholder="Scannez puis appuyez sur Entrée" />
      </label>
      {barcodeMessage && <p className={barcodeMessage.startsWith("Ajouté") ? "form-success" : "form-error"} role="status">{barcodeMessage}</p>}
      <div className="pos-add-row">
        <label>Produit
          <select value={productId} onChange={(event) => setProductId(event.target.value)} required>
            {products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}{product.barcode ? ` · ${product.barcode}` : ""} · {Number(product.sale_price).toLocaleString("fr-FR")} F</option>)}
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
        <div className="pos-payment-heading"><strong>Règlement</strong><button type="button" className="secondary" onClick={() => setPayments((current) => current.length < 4 ? [...(current.length === 1 ? [{ ...current[0], amount: (totals.total / 100).toFixed(2) }] : current), { method: "mobile_money", amount: "" }] : current)} disabled={payments.length >= 4}>Ajouter un moyen de paiement</button></div>
        {effectivePayments.map((payment, index) => (
          <div className="pos-payment-row" key={index}>
            <label>Moyen de paiement
              <select value={payment.method} onChange={(event) => setPayments((current) => current.map((item, i) => i === index ? { ...item, method: event.target.value } : item))}>
                <option value="cash">Espèces</option><option value="wave">Wave</option><option value="orange_money">Orange Money</option><option value="mobile_money">Autre Mobile Money</option><option value="card">Carte bancaire</option><option value="bank_transfer">Virement</option>
              </select>
            </label>
            <label>Montant (FCFA)
              <input type="number" min="0.01" step="0.01" value={payment.amount} onChange={(event) => setPayments((current) => current.map((item, i) => i === index ? { ...item, amount: event.target.value } : item))} required />
            </label>
            {["wave", "orange_money"].includes(payment.method) && <label>Référence de transaction
              <input value={payment.reference ?? ""} minLength={4} maxLength={160} onChange={(event) => setPayments((current) => current.map((item, i) => i === index ? { ...item, reference: event.target.value } : item))} placeholder="Référence affichée dans l'application" required />
            </label>}
            {payments.length > 1 && <button type="button" className="archive-button" onClick={() => setPayments((current) => current.filter((_, i) => i !== index))}>Retirer</button>}
          </div>
        ))}
        <div className="pos-payment-total"><span>Montant réglé</span><strong>{formatCents(paidTotal)} F / {formatCents(totals.total)} F</strong></div>
        {!paymentsValid && cart.length > 0 && <p className="catalog-help">Répartissez le montant exact entre les moyens de paiement.</p>}
      </div>
      <button className="primary" type="submit" disabled={!cart.length || totals.total <= 0 || !paymentsValid}>Valider et encaisser</button>
      {offlineMessage && <p className="form-success" role="status">{offlineMessage}</p>}
      <p className="catalog-help">La validation vérifie le stock et enregistre la vente, les différents paiements et les sorties de stock dans une seule transaction.</p>
    </form>
  );
}
