"use client";

import { useState } from "react";

export default function CopyLink({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable (insecure context); the field stays selectable.
    }
  }

  return (
    <div className="copy-link">
      <input readOnly value={value} onFocus={(event) => event.currentTarget.select()} aria-label="Lien d'invitation" />
      <button type="button" className="secondary" onClick={copy}>{copied ? "Copié ✓" : "Copier"}</button>
    </div>
  );
}
