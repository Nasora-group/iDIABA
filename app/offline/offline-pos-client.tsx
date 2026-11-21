"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  enqueueOfflineSale,
  loadOfflineSales,
  loadOfflineSnapshots,
  removeOfflineSale,
  type OfflineSale,
  type OfflineSnapshot,
} from "@/app/app/pos/offline-store";

function cents(value: string | number) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}
function money(value: number) {
  return (value / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function OfflinePOSClient() {
  const [snapshots, setSnapshots] = useState<OfflineSnapshot[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [queue, setQueue] = useState<OfflineSale[]>([]);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [cart, setCart] = useState<{ product_id: string; quantity: string }[]>([]);
  const [payments, setPayments] = useState<{ method: string; amount: string }[]>([{ method: "cash", amount: "" }]);
  const [userId, setUserId] = useState("");
  const [online, setOnline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const syncLock = useRef(false);

  const snapshot = snapshots.find((item) => item.key === selectedKey) ?? snapshots[0] ?? null;
  const totals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    for (const line of cart) {
      const product = snapshot?.products.find((item) => item.id === line.product_id);
      if (!product) continue;
      const lineSubtotal = Math.round(Number(line.quantity) * cents(product.sale_price));
      subtotal += lineSubtotal;
      tax += Math.round(lineSubtotal * Number(product.tax_rate) / 100);
    }
    return { subtotal, tax, total: subtotal + tax };
  }, [cart, snapshot]);
  const effectivePayments = payments.length === 1
    ? [{ ...payments[0], amount: (totals.total / 100).toFixed(2) }]
    : payments;
  const paidTotal = effectivePayments.reduce((sum, item) => sum + cents(item.amount), 0);
  const validPayments = effectivePayments.length > 0
    && effectivePayments.every((item) => ["cash", "mobile_money", "card", "bank_transfer"].includes(item.method) && cents(item.amount) > 0)
    && paidTotal === totals.total;

  const refreshQueue = useCallback(async (id: string) => {
    const rows = await loadOfflineSales(id);
    setQueue(rows);
  }, []);

  const syncQueue = useCallback(async () => {
    if (syncLock.current || !navigator.onLine || !userId) return;
    syncLock.current = true;
    setSyncing(true);
    setMessage("");
    try {
      const supabase = createClient();
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user || user.id !== userId) {
        setMessage("Reconnectez-vous avec le même compte utilisé lors de la saisie hors connexion.");
        return;
      }
      const pending = await loadOfflineSales(userId);
      for (const sale of pending) {
        const { error } = await supabase.rpc("finalize_sale", {
          p_tenant_id: sale.tenantId,
          p_location_id: sale.locationId,
          p_cash_session_id: sale.sessionId,
          p_client_sale_id: sale.id,
          p_items: sale.items,
          p_payments: sale.payments,
        });
        if (error) {
          setMessage("Synchronisation interrompue : " + error.message + ". La vente reste conservée sur cet appareil.");
          break;
        }
        await removeOfflineSale(sale.id);
      }
      await refreshQueue(userId);
      if ((await loadOfflineSales(userId)).length === 0) setMessage("Toutes les ventes en attente ont été synchronisées.");
    } catch {
      setMessage("Connexion interrompue. Les ventes restent enregistrées sur cet appareil.");
    } finally {
      setSyncing(false);
      syncLock.current = false;
    }
  }, [refreshQueue, userId]);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          if (active) setMessage("Aucune session locale trouvée. Connectez-vous en ligne une première fois sur cet appareil.");
          return;
        }
        const id = session.user.id;
        const [saved, pending] = await Promise.all([loadOfflineSnapshots(id), loadOfflineSales(id)]);
        if (!active) return;
        setUserId(id);
        setSnapshots(saved.sort((a, b) => b.savedAt - a.savedAt));
        setQueue(pending);
        if (saved.length) {
          setSelectedKey(saved[0].key);
          setProductId(saved[0].products[0]?.id ?? "");
        }
      } catch {
        if (active) setMessage("Le stockage local est indisponible. Autorisez les données du site dans votre navigateur.");
      }
    };
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    void initialize();
    return () => {
      active = false;
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  useEffect(() => {
    if (online && userId) void syncQueue();
  }, [online, userId, syncQueue]);

  useEffect(() => {
    if (snapshot && !snapshot.products.some((item) => item.id === productId)) setProductId(snapshot.products[0]?.id ?? "");
  }, [snapshot, productId]);

  function addLine() {
    const qty = Number(quantity);
    if (!productId || !Number.isFinite(qty) || qty <= 0 || qty > 1000000) return;
    setCart((current) => {
      const found = current.find((line) => line.product_id === productId);
      return found
        ? current.map((line) => line.product_id === productId ? { ...line, quantity: String(Number(line.quantity) + qty) } : line)
        : [...current, { product_id: productId, quantity }];
    });
    setQuantity("1");
  }

  async function queueSale() {
    if (!snapshot || !cart.length || totals.total <= 0 || !validPayments || !userId) return;
    const sale: OfflineSale = {
      id: crypto.randomUUID(),
      userId,
      tenantId: snapshot.tenantId,
      locationId: snapshot.locationId,
      sessionId: snapshot.sessionId,
      items: cart,
      payments: effectivePayments,
      createdAt: Date.now(),
    };
    try {
      await enqueueOfflineSale(sale);
      await refreshQueue(userId);
      setCart([]);
      setPayments([{ method: "cash", amount: "" }]);
      setMessage("Vente enregistrée localement. Elle sera envoyée dès le retour de la connexion.");
    } catch {
      setMessage("Impossible d'enregistrer cette vente localement. Vérifiez l'espace disponible sur l'appareil.");
    }
  }

  if (!snapshot) {
    return <section className="offline-panel"><h2>Caisse hors connexion</h2><p>Aucun catalogue de caisse n'a encore été enregistré sur cet appareil.</p><p>Connectez-vous, ouvrez une session de caisse et consultez le point de vente une première fois pour préparer le mode hors connexion.</p>{message && <p role="status">{message}</p>}</section>;
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="mark">i</span><span>iDIABA</span></div>
        <span className="pill">{online ? "Connexion disponible" : "Mode hors connexion"}</span>
      </header>
      <section className="workspace catalog-workspace">
        <p className="eyebrow">CAISSE · MODE HORS CONNEXION</p>
        <h1>Continuer les ventes</h1>
        <p className="lead">Les ventes saisies ici sont conservées sur cet appareil puis synchronisées à la reconnexion. Le stock et l'état de la caisse seront contrôlés par le serveur au moment de la synchronisation.</p>
        {snapshots.length > 1 && <label className="offline-session-select">Session de caisse<select value={snapshot.key} onChange={(event) => setSelectedKey(event.target.value)}>{snapshots.map((item) => <option key={item.key} value={item.key}>{item.tenantName} · {item.locationName}</option>)}</select></label>}
        <div className="offline-panel">
          <div className="catalog-heading"><div><h2>{snapshot.tenantName}</h2><p>{snapshot.locationName} · Catalogue enregistré le {new Date(snapshot.savedAt).toLocaleString("fr-FR")}</p></div><span className="pill">{queue.length} en attente</span></div>
          <div className="pos-add-row">
            <label>Produit<select value={productId} onChange={(event) => setProductId(event.target.value)}>{snapshot.products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku} · {Number(product.sale_price).toLocaleString("fr-FR")} F</option>)}</select></label>
            <label>Quantité<input type="number" min="0.001" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
            <button type="button" className="secondary" onClick={addLine}>Ajouter</button>
          </div>
          <div className="pos-cart">
            {cart.length ? cart.map((line) => {
              const product = snapshot.products.find((item) => item.id === line.product_id);
              if (!product) return null;
              const lineTotal = Math.round(Number(line.quantity) * cents(product.sale_price) * (1 + Number(product.tax_rate) / 100));
              return <div className="pos-cart-line" key={line.product_id}><div><strong>{product.name}</strong><small>{line.quantity} {product.unit} × {Number(product.sale_price).toLocaleString("fr-FR")} F</small></div><strong>{money(lineTotal)} F</strong><button type="button" className="archive-button" onClick={() => setCart((current) => current.filter((item) => item.product_id !== line.product_id))}>Retirer</button></div>;
            }) : <p className="catalog-empty">Ajoutez les produits à vendre.</p>}
          </div>
          <div className="pos-totals"><div><span>Sous-total HT</span><strong>{money(totals.subtotal)} F</strong></div><div><span>Taxes</span><strong>{money(totals.tax)} F</strong></div><div className="pos-grand-total"><span>Total à payer</span><strong>{money(totals.total)} F</strong></div></div>
          <div className="pos-payment-section">
            <div className="pos-payment-heading"><strong>Règlement</strong><button type="button" className="secondary" onClick={() => setPayments((current) => current.length < 4 ? [...(current.length === 1 ? [{ ...current[0], amount: (totals.total / 100).toFixed(2) }] : current), { method: "mobile_money", amount: "" }] : current)} disabled={payments.length >= 4}>Ajouter un moyen de paiement</button></div>
            {effectivePayments.map((payment, index) => <div className="pos-payment-row" key={index}><label>Moyen de paiement<select value={payment.method} onChange={(event) => setPayments((current) => current.map((item, i) => i === index ? { ...item, method: event.target.value } : item))}><option value="cash">Espèces</option><option value="mobile_money">Mobile Money</option><option value="card">Carte bancaire</option><option value="bank_transfer">Virement</option></select></label><label>Montant (FCFA)<input type="number" min="0.01" step="0.01" value={payment.amount} onChange={(event) => setPayments((current) => current.map((item, i) => i === index ? { ...item, amount: event.target.value } : item))} required /></label>{payments.length > 1 && <button type="button" className="archive-button" onClick={() => setPayments((current) => current.filter((_, i) => i !== index))}>Retirer</button>}</div>)}
            <div className="pos-payment-total"><span>Montant réglé</span><strong>{money(paidTotal)} F / {money(totals.total)} F</strong></div>
          </div>
          <button className="primary" type="button" onClick={queueSale} disabled={!cart.length || !validPayments || syncing}>Enregistrer la vente sur cet appareil</button>
        </div>
        {message && <p className="form-success" role="status">{message}</p>}
        <div className="offline-panel"><div className="catalog-heading"><h2>Synchronisation</h2><button className="secondary" type="button" onClick={() => void syncQueue()} disabled={!online || syncing || !queue.length}>{syncing ? "Synchronisation…" : "Synchroniser maintenant"}</button></div>
          {queue.length ? <ul className="offline-queue">{queue.map((sale) => <li key={sale.id}><span>Vente {sale.id.slice(0, 8).toUpperCase()}<small>{new Date(sale.createdAt).toLocaleString("fr-FR")} · {sale.items.length} ligne(s)</small></span><strong>En attente</strong></li>)}</ul> : <p className="catalog-empty">Aucune vente en attente.</p>}
          <p className="catalog-help">Les ventes restent stockées localement tant que le serveur ne les a pas confirmées. En cas de stock insuffisant ou de caisse clôturée, la vente reste en attente et nécessite une correction ou une nouvelle session.</p>
        </div>
      </section>
    </main>
  );
}
