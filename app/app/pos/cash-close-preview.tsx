"use client";

import { useState } from "react";

type Props = {
  sessionId: string;
  expectedCash: number;
  closeAction: (formData: FormData) => Promise<void>;
};

const format = (amount: number) => amount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CashClosePreview({ sessionId, expectedCash, closeAction }: Props) {
  const [counted, setCounted] = useState("");
  const countedValue = counted.trim() === "" ? null : Number(counted);
  const variance = countedValue === null || !Number.isFinite(countedValue) ? null : countedValue - expectedCash;
  const valid = countedValue !== null && Number.isFinite(countedValue) && countedValue >= 0;
  return (
    <form action={closeAction} className="pos-close-form">
      <input type="hidden" name="session_id" value={sessionId} />
      <label>Espèces comptées (FCFA)<input name="closing_cash" type="number" min="0" step="0.01" value={counted} onChange={(event) => setCounted(event.target.value)} required placeholder="Montant réel" /></label>
      <div className="pos-close-preview">
        <span>Solde attendu : <strong>{format(expectedCash)} F</strong></span>
        {variance !== null && <span className={variance === 0 ? "balanced" : variance < 0 ? "shortage" : "surplus"}>Écart : <strong>{variance > 0 ? "+" : ""}{format(variance)} F</strong></span>}
      </div>
      <button className="secondary" type="submit" disabled={!valid}>Clôturer la caisse</button>
    </form>
  );
}
