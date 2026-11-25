"use client";

import { useMemo, useState } from "react";
import { createCommercialDocument } from "./actions";

type Customer = { id: string; name: string };
type Product = { id: string; name: string; sku: string; sale_price: number | string; tax_rate: number | string };
type Line = { product_id: string; quantity: string; unit_price: string; tax_rate: string };

export default function DocumentsForm({ tenantId, customers, products, currency }: {
  tenantId: string; customers: Customer[]; products: Product[]; currency: string;
}) {
  const [documentType, setDocumentType] = useState("quote");
  const [customerId, setCustomerId] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ product_id: "", quantity: "1", unit_price: "0", tax_rate: "0" }]);
  const total = useMemo(() => lines.reduce((sum, line) => {
    const subtotal = Number(line.quantity || 0) * Number(line.unit_price || 0);
    return sum + subtotal + subtotal * Number(line.tax_rate || 0) / 100;
  }, 0), [lines]);
  const updateLine = (index: number, patch: Partial<Line>) => setLines(current => current.map((line, i) => i === index ? { ...line, ...patch } : line));
  const addLine = () => setLines(current => current.length < 100 ? [...current, { product_id: "", quantity: "1", unit_price: "0", tax_rate: "0" }] : current);
  const removeLine = (index: number) => setLines(current => current.length > 1 ? current.filter((_, i) => i !== index) : current);

  return (
    <form action={createCommercialDocument} className="catalog-form commercial-document-form">
      <h3>Nouveau document commercial</h3>
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="document_type" value={documentType} />
      <input type="hidden" name="customer_id" value={customerId} />
      <input type="hidden" name="valid_until" value={validUntil} />
      <input type="hidden" name="due_date" value={dueDate} />
      <input type="hidden" name="notes" value={notes} />
      <input type="hidden" name="items_json" value={JSON.stringify(lines)} />
      <div className="catalog-fields">
        <label>Type de document
          <select value={documentType} onChange={event => setDocumentType(event.target.value)}>
            <option value="quote">Devis</option><option value="sales_order">Commande client</option>
          </select>
        </label>
        <label>Client
          <select value={customerId} onChange={event => setCustomerId(event.target.value)}>
            <option value="">Client comptoir / non renseigné</option>
            {customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
          </select>
        </label>
      </div>
      <div className="catalog-fields">
        {documentType === "quote" && <label>Validité du devis<input type="date" value={validUntil} onChange={event => setValidUntil(event.target.value)} /></label>}
        <label>Échéance souhaitée<input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} /></label>
      </div>
      <div className="commercial-lines">
        <div className="catalog-heading"><h4>Articles ou prestations</h4><button className="secondary" type="button" onClick={addLine}>Ajouter une ligne</button></div>
        {lines.map((line, index) => (
          <div className="commercial-line" key={index}>
            <label>Article / service
              <select required value={line.product_id} onChange={event => {
                const product = products.find(item => item.id === event.target.value);
                updateLine(index, { product_id: event.target.value, unit_price: String(product?.sale_price ?? 0), tax_rate: String(product?.tax_rate ?? 0) });
              }}>
                <option value="">Choisir un article</option>
                {products.map(product => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}
              </select>
            </label>
            <label>Quantité<input required type="number" min="0.001" step="0.001" value={line.quantity} onChange={event => updateLine(index, { quantity: event.target.value })} /></label>
            <label>Prix unitaire ({currency})<input required type="number" min="0" step="0.01" value={line.unit_price} onChange={event => updateLine(index, { unit_price: event.target.value })} /></label>
            <label>TVA %<input required type="number" min="0" max="100" step="0.01" value={line.tax_rate} onChange={event => updateLine(index, { tax_rate: event.target.value })} /></label>
            <button className="archive-button" type="button" onClick={() => removeLine(index)} disabled={lines.length === 1}>Retirer</button>
          </div>
        ))}
      </div>
      <label>Notes<textarea rows={2} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
      <div className="commercial-document-total"><span>Total estimé TTC</span><strong>{total.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} {currency}</strong></div>
      <button className="primary" type="submit" disabled={!products.length || lines.some(line => !line.product_id || Number(line.quantity) <= 0 || Number(line.unit_price) < 0)}>Enregistrer le document</button>
    </form>
  );
}
