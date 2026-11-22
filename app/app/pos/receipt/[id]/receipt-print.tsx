"use client";

export default function ReceiptPrint() {
  return <div className="receipt-actions receipt-buttons"><button className="primary" type="button" onClick={() => window.print()}>Imprimer le ticket</button><button className="secondary" type="button" onClick={() => window.print()}>Enregistrer en PDF</button></div>;
}
