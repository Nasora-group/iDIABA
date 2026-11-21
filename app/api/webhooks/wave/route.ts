import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function verifyWaveSignature(rawBody: string, header: string | null, secret: string) {
  if (!header) return false;
  const parts = header.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  if (!timestamp || !/^\d{10}$/.test(timestamp) || !signatures.length) return false;
  const age = Math.floor(Date.now() / 1000) - Number(timestamp);
  if (age > 300 || age < -30) return false;
  const expected = createHmac("sha256", secret).update(timestamp + rawBody).digest();
  return signatures.some((signature) => {
    if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
    const received = Buffer.from(signature, "hex");
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}

type WaveEvent = {
  id?: string;
  type?: string;
  data?: {
    id?: string;
    client_reference?: string;
    amount?: string;
    currency?: string;
    payment_status?: string;
    transaction_id?: string;
  };
};

export async function POST(request: Request) {
  const secret = process.env.WAVE_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "Webhook not configured" }, { status: 503 });

  const rawBody = await request.text();
  if (rawBody.length > 64_000) return Response.json({ error: "Payload too large" }, { status: 413 });
  if (!verifyWaveSignature(rawBody, request.headers.get("Wave-Signature"), secret)) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: WaveEvent;
  try {
    event = JSON.parse(rawBody) as WaveEvent;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!event.id || !event.type) {
    return Response.json({ error: "Invalid event" }, { status: 400 });
  }
  if (event.type === "test.test_event") {
    return Response.json({ received: true, test: true });
  }
  if (!event.data?.id) {
    return Response.json({ error: "Invalid event" }, { status: 400 });
  }
  if (event.type === "checkout.session.completed" && event.data.payment_status !== "succeeded") {
    return Response.json({ received: true, ignored: true });
  }

  const amount = Number(event.data.amount);
  const amountFcfa = Number.isSafeInteger(amount) ? amount : 0;
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("process_subscription_payment_webhook", {
      p_provider: "wave",
      p_event_id: event.id,
      p_event_type: event.type,
      p_provider_reference: event.data.id,
      p_provider_transaction_id: event.data.transaction_id ?? "",
      p_client_reference: event.data.client_reference ?? "",
      p_amount_fcfa: amountFcfa,
      p_currency: event.data.currency ?? "",
    });
    if (error) {
      console.error("Wave webhook processing failed:", error.message);
      return Response.json({ error: "Payment event could not be processed" }, { status: 500 });
    }
    return Response.json({ received: true, result: data });
  } catch (error) {
    console.error("Wave webhook configuration error:", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "Payment processing unavailable" }, { status: 503 });
  }
}
