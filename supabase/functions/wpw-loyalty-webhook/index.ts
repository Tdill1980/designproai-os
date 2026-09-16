/**
 * wpw-loyalty-webhook — receives WPLoyalty balance-changed pushes.
 *
 * WPLoyalty's own public REST API (wc/v3/wployalty/*) is add/reduce-only —
 * there is no endpoint to read a customer's current balance, so RestylePro
 * cannot poll it. Instead, the WordPress plugin at
 * wordpress/wpw-loyalty-webhook/ hooks WPLoyalty's own
 * `wlr_customer_points_balance_changed` action (fired on every point change,
 * with the fresh balance already computed) and pushes it here.
 *
 * Authentication mirrors wpw-orders-webhook exactly: an HMAC-SHA256 (base64)
 * over the exact raw request body, verified against a Vault secret via
 * verify_wpw_loyalty_webhook_signature() — never over a parsed/re-serialized
 * copy, which would not match what the sender actually signed. This function
 * must be deployed with JWT verification disabled (WordPress cannot mint a
 * Supabase JWT); see supabase/config.toml.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_BODY_BYTES = 20_000;

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function normalizeEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase().slice(0, 200);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed", request_id: requestId });
  }

  try {
    const declaredLength = Number(req.headers.get("content-length") || "0");
    if (declaredLength > MAX_BODY_BYTES) {
      return json(413, { ok: false, error: "Payload too large", request_id: requestId });
    }

    // Never call req.json() before signature verification — the plugin signs
    // the exact raw bytes, and re-serializing JSON can change them.
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return json(413, { ok: false, error: "Payload too large", request_id: requestId });
    }

    const signature = String(req.headers.get("x-wpw-loyalty-signature") || "").trim();
    if (!signature) {
      return json(401, { ok: false, error: "Invalid signature", request_id: requestId });
    }

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) {
      return json(500, { ok: false, error: "Server configuration missing", request_id: requestId });
    }
    const sb = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: validSignature, error: signatureError } = await sb.rpc(
      "verify_wpw_loyalty_webhook_signature",
      { payload: rawBody, candidate: signature },
    );
    if (signatureError) {
      console.error("[wpw-loyalty-webhook] verifier unavailable", signatureError.message);
      return json(503, { ok: false, error: "Webhook verification unavailable", request_id: requestId });
    }
    if (validSignature !== true) {
      console.warn("[wpw-loyalty-webhook] signature mismatch", { request_id: requestId });
      return json(401, { ok: false, error: "Invalid signature", request_id: requestId });
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json(400, { ok: false, error: "Invalid JSON", request_id: requestId });
    }

    const email = normalizeEmail(payload.user_email);
    if (!email) {
      return json(400, { ok: false, error: "Invalid or missing user_email", request_id: requestId });
    }
    const pointBalance = Number(payload.point_balance);
    if (!Number.isFinite(pointBalance)) {
      return json(400, { ok: false, error: "Invalid or missing point_balance", request_id: requestId });
    }
    const pointsChanged = Number.isFinite(Number(payload.points_changed))
      ? Math.trunc(Number(payload.points_changed))
      : null;
    const transactionType = typeof payload.transaction_type === "string"
      ? payload.transaction_type.slice(0, 40)
      : null;
    const actionType = typeof payload.action_type === "string"
      ? payload.action_type.slice(0, 60)
      : null;

    const { error: upsertError } = await sb
      .from("wpw_loyalty_points")
      .upsert(
        {
          customer_email: email,
          points_balance: Math.trunc(pointBalance),
          last_points_changed: pointsChanged,
          last_transaction_type: transactionType,
          last_action_type: actionType,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "customer_email" },
      );
    if (upsertError) {
      console.error("[wpw-loyalty-webhook] upsert failed", upsertError.message);
      return json(500, { ok: false, error: "Failed to record points update", request_id: requestId });
    }

    return json(200, { ok: true, request_id: requestId });
  } catch (err) {
    console.error("[wpw-loyalty-webhook] request failed", err instanceof Error ? err.message : err);
    return json(500, { ok: false, error: "Webhook processing failed", request_id: requestId });
  }
});
