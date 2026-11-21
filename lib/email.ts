/**
 * Transactional e-mail through the Resend HTTP API (no extra dependency).
 * Configure RESEND_API_KEY and EMAIL_FROM on the server. When they are missing
 * the app keeps working: callers fall back to showing a link to copy.
 */
export type MailResult = "sent" | "disabled" | "failed";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Removes control characters (prevents header/subject injection) and trims length. */
export function cleanLine(value: string, max = 120): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
}

export async function sendEmail(message: { to: string; subject: string; html: string; text: string }): Promise<MailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return "disabled";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [message.to], subject: cleanLine(message.subject, 200), html: message.html, text: message.text }),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

export function invitationEmail(input: { companyName: string; inviterName: string; roleLabel: string; link: string }) {
  const company = cleanLine(input.companyName);
  const inviter = cleanLine(input.inviterName) || "Un administrateur";
  const subject = `${inviter} vous invite à rejoindre ${company} sur iDIABA`;
  const text = [
    `${inviter} vous invite à rejoindre l'entreprise "${company}" sur iDIABA avec le rôle : ${input.roleLabel}.`,
    "",
    `Ouvrez ce lien pour accepter l'invitation (valable 7 jours) :`,
    input.link,
    "",
    "Utilisez l'adresse e-mail à laquelle ce message a été envoyé. Si vous n'attendiez pas cette invitation, ignorez ce message.",
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#17231d">
<h2 style="margin:0 0 12px">Invitation iDIABA</h2>
<p><strong>${escapeHtml(inviter)}</strong> vous invite à rejoindre l'entreprise <strong>${escapeHtml(company)}</strong> avec le rôle <strong>${escapeHtml(input.roleLabel)}</strong>.</p>
<p><a href="${escapeHtml(input.link)}" style="display:inline-block;background:#18794e;color:#fff;padding:12px 20px;border-radius:9px;text-decoration:none;font-weight:700">Rejoindre l'entreprise</a></p>
<p style="color:#68766e;font-size:13px">Le lien est valable 7 jours. Utilisez l'adresse e-mail à laquelle ce message a été envoyé. Si vous n'attendiez pas cette invitation, ignorez ce message.</p>
</div>`;
  return { subject, html, text };
}
