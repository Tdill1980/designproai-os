/**
 * sprocket-operator — Sprocket's ApprovePro OPERATOR brain (Claude tool-use).
 *
 * Lives as a SHARED module (not its own edge function) so the project's
 * function count cap isn't hit — sprocket-helper imports handleOperator() and
 * exposes it as mode:"operator". Sprocket can:
 *   • ORDER mode (proof_id): get_status, read_conversation, revise_design
 *     (surgical), reply_to_customer, send_proof_to_customer, switch_version,
 *     start_over_from_brief.
 *   • QUEUE mode (no proof_id): list_orders_needing_attention, find_order.
 *
 * Auth: the shop's JWT (forwarded from the dock). We validate the user owns the
 * proof, then forward that auth to downstream shop functions.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { userTeamShopIds } from "./proof-team-access.ts";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const MAX_TURNS = 5;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const ORDER_TOOLS = [
  { name: "get_status", description: "Report the order's current state: design status, how many versions exist, which version is active, AI revisions used/allowed, customer name/email, and the most recent customer message.", input_schema: { type: "object", properties: {}, required: [] } },
  { name: "read_conversation", description: "Read the recent message history between the shop and the customer so you have context before replying or acting.", input_schema: { type: "object", properties: {}, required: [] } },
  { name: "revise_design", description: "Make a SURGICAL AI edit to the CURRENT design — keeps the existing wrap, vehicle, and everything not mentioned, changes only what is asked (e.g. 'remove the S in Wildcats', 'add the sponsor logo to the rear'). Adds a new version; never rebuilds from scratch.", input_schema: { type: "object", properties: { change_request: { type: "string", description: "The exact change to make, in plain words." } }, required: ["change_request"] } },
  { name: "send_proof_to_customer", description: "Email (or re-email) the proof to the customer so they can approve or revise it. OUTWARD-FACING: only after the user clearly says to send/resend.", input_schema: { type: "object", properties: { custom_message: { type: "string", description: "Optional personal note to include." } }, required: [] } },
  { name: "reply_to_customer", description: "Send a written reply to the customer in the order's conversation thread (and email it). Write the message yourself in a warm, professional shop voice. OUTWARD-FACING: only after the user tells you what to say / to reply.", input_schema: { type: "object", properties: { message: { type: "string", description: "The exact message to send to the customer." } }, required: ["message"] } },
  { name: "switch_version", description: "Make a specific earlier version the active one (non-destructive). Use when the user wants to go back to a previous version.", input_schema: { type: "object", properties: { version_number: { type: "number", description: "The version number to make active." } }, required: ["version_number"] } },
  { name: "start_over_from_brief", description: "DESTRUCTIVE: throw away the current design and build a BRAND-NEW one from the order brief (DesignPro from scratch). Only after the user has explicitly confirmed a full do-over — never for a small change.", input_schema: { type: "object", properties: {}, required: [] } },
  { name: "send_to_wrapbox", description: "Hand a COMPLETED (customer-APPROVED) design off to WrapBox production — copies the approved render into the order's production pack so the shop can print it. Use only when the order's status is approved. Idempotent (safe to repeat). OUTWARD/production action: only after the user clearly says to send it to production / WrapBox.", input_schema: { type: "object", properties: {}, required: [] } },
];

const QUEUE_TOOLS = [
  { name: "list_orders_needing_attention", description: "List this shop's active orders that need attention now — no design yet, design ready but unsent, customer requested a revision, generation failed, or customer is revising. For 'what needs my attention', 'my queue', 'anything waiting'.", input_schema: { type: "object", properties: {}, required: [] } },
  { name: "find_order", description: "Find a specific order by customer name, email, design name, or order number, and return its current state.", input_schema: { type: "object", properties: { query: { type: "string", description: "Customer name, email, design name, or order number." } }, required: ["query"] } },
];

export async function handleOperator(req: Request, body: any): Promise<Response> {
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return jsonResponse({ error: "AI is not configured (missing key)." }, 500);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("authorization");
  if (!authHeader) return jsonResponse({ error: "Authentication required" }, 401);

  const authClient = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authErr } = await authClient.auth.getUser();
  if (authErr || !user) return jsonResponse({ error: "Invalid auth token" }, 401);

  if (!body.message?.trim()) return jsonResponse({ error: "message is required" }, 400);

  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // Team-scoped access (mirrors proof_approvals RLS): the caller may act on any
  // proof whose shop_id is in their team set — own id + owners of accepted
  // shop_members. Fails safe to owner-only. This is why the whole shop team can
  // drive A.C.E on a shared (e.g. canonical-WPW) order, matching the workbench.
  const allowedShopIds = await userTeamShopIds(db, user.id);

  let proof: any = null;
  if (body.proof_id) {
    const { data, error: proofErr } = await db.from("proof_approvals").select("*").eq("id", body.proof_id).in("shop_id", allowedShopIds).single();
    if (proofErr || !data) return jsonResponse({ error: "Order not found (or not yours)" }, 404);
    proof = data;
  }
  const isQueue = !proof;
  const shopName = proof
    ? ((proof.metadata as any)?.shop_name || (/(weprint\s*wraps|wpw)/i.test((proof.metadata as any)?.auto_ingested || "") ? "WePrintWraps" : "your shop"))
    : "your shop";

  const loadState = async () => {
    const { data: versions } = await db.from("proof_versions").select("version_number, is_active, render_urls").eq("proof_id", proof.id).order("version_number", { ascending: false });
    const active = (versions || []).find((v) => v.is_active);
    const { data: lastMsg } = await db.from("proof_events").select("event_type, payload, created_at").eq("proof_id", proof.id).in("event_type", ["customer_comment", "revision_requested", "ai_revise_started"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    return {
      design_name: proof.design_name,
      vehicle: [proof.vehicle_year, proof.vehicle_make, proof.vehicle_model].filter(Boolean).join(" ") || "(not set)",
      customer_name: proof.customer_name, customer_email: proof.customer_email, status: proof.status,
      autogen_status: (proof.metadata as any)?.autogen_status || null,
      version_count: versions?.length || 0, active_version: active?.version_number ?? null,
      ai_revisions_allowed: proof.ai_revisions_allowed, ai_revisions_used: proof.ai_revisions_used,
      last_customer_message: (lastMsg?.payload as any)?.message || (lastMsg?.payload as any)?.prompt || (lastMsg?.payload as any)?.notes || null,
    };
  };

  const callFn = async (name: string, payload: unknown, forwardUserAuth: boolean) => {
    // Gateway auth: every downstream function is verify_jwt=false, so the gateway
    // only needs a VALID `apikey`. We use the service-role key for that — it is
    // always populated in the function env, whereas SUPABASE_ANON_KEY can come
    // back empty on projects using the new (sb_publishable_) key system, which
    // produced `Bearer undefined` → gateway 401 and silently no-op'd revisions.
    // For user-scoped functions we still forward the shop's JWT as the Bearer so
    // they identify the shop; internal calls send the service-role Bearer (not
    // JWT-verified since verify_jwt=false). Downstream uses its OWN env service
    // role for privileged work regardless.
    const gatewayKey = serviceRoleKey || supabaseAnonKey;
    const r = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: gatewayKey,
        Authorization: forwardUserAuth ? (authHeader as string) : `Bearer ${gatewayKey}`,
      },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, body: j };
  };

  const runTool = async (name: string, input: any): Promise<Record<string, unknown>> => {
    if (name === "get_status") return await loadState();
    if (name === "read_conversation") {
      // Customer messages live in TWO tables — proof_messages AND proof_events
      // (portal "add details", revision requests, AI-revise prompts). Read BOTH
      // so Sprocket sees every customer message, not just direct portal DMs.
      const { data: msgs } = await db.from("proof_messages").select("sender_role, body, created_at").eq("proof_id", proof.id).eq("status", "sent").in("sender_role", ["customer", "team", "shop"]);
      const { data: evs } = await db.from("proof_events").select("event_type, actor_role, payload, created_at").eq("proof_id", proof.id).in("event_type", ["customer_comment", "revision_requested", "ai_revise_started"]);
      const fromMsgs = (msgs || []).map((m) => ({ from: m.sender_role === "shop" ? "shop" : m.sender_role, message: m.body, at: m.created_at }));
      const fromEvents = (evs || []).map((e) => {
        const p = (e.payload || {}) as any; const t = p.message || p.notes || p.prompt || "";
        return t ? { from: (e.actor_role === "shop" || e.actor_role === "system") ? "shop" : "customer", message: String(t), at: e.created_at } : null;
      }).filter(Boolean) as Array<{ from: string; message: string; at: string }>;
      const thread = [...fromMsgs, ...fromEvents].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()).slice(-30);
      return { message_count: thread.length, thread };
    }
    if (name === "revise_design") {
      const change = String(input?.change_request || "").trim();
      if (!change) return { error: "No change described." };
      // Set autogen_status=running up front so the workbench progress bar shows
      // immediately (the poller keys on it), even before A.C.E's own status write.
      const md = { ...((proof.metadata as any) || {}), autogen_status: "running", autogen_started_at: new Date().toISOString() };
      await db.from("proof_approvals").update({ change_request: change, metadata: md }).eq("id", proof.id);
      const res = await callFn("approvepro-autogen-design", { proof_id: proof.id }, false);
      return res.ok ? { ok: true, mode: (res.body as any)?.mode || "surgical_revision", note: "Surgical edit started — a new version appears shortly. The wrap is preserved; only the requested change is applied." } : { ok: false, error: (res.body as any)?.error || `revise failed (${res.status})` };
    }
    if (name === "send_proof_to_customer") {
      const res = await callFn("proof-send", { proof_id: proof.id, custom_message: input?.custom_message || undefined, force: true }, true);
      return res.ok ? { ok: true, note: `Proof emailed to ${proof.customer_email}. They can approve or revise it themselves.` } : { ok: false, error: (res.body as any)?.error || `send failed (${res.status})` };
    }
    if (name === "switch_version") {
      const vnum = Number(input?.version_number);
      const { data: target } = await db.from("proof_versions").select("id").eq("proof_id", proof.id).eq("version_number", vnum).maybeSingle();
      if (!target) return { ok: false, error: `Version ${vnum} not found on this order.` };
      const res = await callFn("proof-revert-version", { proof_id: proof.id, target_version_id: target.id }, true);
      return res.ok ? { ok: true, active_version: vnum, note: `Now showing v${vnum}. Nothing was deleted.` } : { ok: false, error: (res.body as any)?.error || `switch failed (${res.status})` };
    }
    if (name === "start_over_from_brief") {
      const res = await callFn("approvepro-autogen-design", { proof_id: proof.id, force: true }, false);
      return res.ok ? { ok: true, note: "Starting over — DesignPro is building a brand-new design from the brief. The old version stays in history." } : { ok: false, error: (res.body as any)?.error || `rebuild failed (${res.status})` };
    }
    if (name === "send_to_wrapbox") {
      if (String(proof.status || "").toLowerCase() !== "approved") {
        return { ok: false, error: "This order isn't approved yet — WrapBox production handoff is only for designs the customer has already approved." };
      }
      const res = await callFn("proof-attach-to-wrapbox", { proof_id: proof.id }, true);
      return res.ok
        ? { ok: true, note: "Handed off to WrapBox — the approved design is now in the order's production pack, ready for the shop to print." }
        : { ok: false, error: (res.body as any)?.error || `WrapBox handoff failed (${res.status})` };
    }
    if (name === "reply_to_customer") {
      const text = String(input?.message || "").trim();
      if (!text) return { error: "No message provided." };
      await db.from("proof_messages").insert({ proof_id: proof.id, sender_role: "shop", sender_name: shopName, body: text, status: "sent", sent_at: new Date().toISOString() });
      await db.from("proof_events").insert({ proof_id: proof.id, event_type: "shop_message", actor_role: "shop", payload: { message: text.slice(0, 500), via: "sprocket" } });
      let emailed = false;
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey && proof.customer_email) {
        const baseUrl = Deno.env.get("PROOF_PUBLIC_BASE_URL") || "https://restyleproai.com";
        const viewUrl = `${baseUrl}/approve/${proof.view_token}`;
        const from = /weprint\s*wraps|wpw/i.test(shopName) ? `${shopName} <Design@weprintwraps.com>` : `${shopName} <noreply@restyleproai.com>`;
        try {
          const r = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from, to: proof.customer_email, reply_to: "Design@weprintwraps.com",
              subject: `A message about your ${proof.design_name || "wrap design"}`,
              html: `<div style="font-family:system-ui,Arial,sans-serif;max-width:560px;color:#111;line-height:1.55"><p>Hi ${(proof.customer_name || "there").replace(/[<>]/g, "")},</p><p style="white-space:pre-wrap">${text.replace(/[<>]/g, "")}</p><p style="margin-top:16px"><a href="${viewUrl}" style="color:#2563eb;font-weight:600;text-decoration:none">View your design proof →</a></p><p style="color:#888;font-size:12px;margin-top:14px">— ${shopName}</p></div>`,
            }),
          });
          emailed = r.ok;
        } catch { /* non-fatal */ }
      }
      return { ok: true, emailed, note: `Replied to ${proof.customer_name || "the customer"}${emailed ? " — emailed and added to the thread." : " — added to the thread."}` };
    }
    if (name === "list_orders_needing_attention") {
      const { data: orders } = await db.from("proof_approvals").select("id, design_name, customer_name, status, change_request, metadata, updated_at").in("shop_id", allowedShopIds).not("status", "in", "(approved,declined,revoked,expired)").order("updated_at", { ascending: false }).limit(50);
      const flagged = (orders || []).map((o: any) => {
        const md = o.metadata || {}; const needs: string[] = [];
        if (md.autogen_status === "needs_brief") needs.push("needs brief/info from customer");
        if (o.status === "draft" && !md.autogen_status) needs.push("no design generated yet");
        if (o.status === "draft" && md.autogen_status === "done") needs.push("design ready — not sent to customer");
        if (md.autogen_status === "failed") needs.push("generation failed — retry");
        if (o.change_request) needs.push("customer requested a revision");
        if (o.status === "revising") needs.push("customer is revising");
        return needs.length ? { id: o.id, design: o.design_name, customer: o.customer_name, status: o.status, needs } : null;
      }).filter(Boolean);
      return { count: flagged.length, orders: flagged.slice(0, 25) };
    }
    if (name === "find_order") {
      const q = String(input?.query || "").trim();
      if (!q) return { error: "No search text." };
      const like = `%${q.replace(/[%_]/g, "")}%`;
      const { data: rows } = await db.from("proof_approvals").select("id, design_name, customer_name, customer_email, status, metadata").in("shop_id", allowedShopIds).or(`customer_name.ilike.${like},customer_email.ilike.${like},design_name.ilike.${like}`).order("updated_at", { ascending: false }).limit(8);
      const matches = (rows || []).map((o: any) => ({ id: o.id, design: o.design_name, customer: o.customer_name, email: o.customer_email, status: o.status, autogen_status: (o.metadata as any)?.autogen_status || null, order_number: (o.metadata as any)?.wpw_order_number || null }));
      return { count: matches.length, matches };
    }
    return { error: `Unknown tool: ${name}` };
  };

  const tools = isQueue ? QUEUE_TOOLS : ORDER_TOOLS;
  const system = isQueue
    ? `You are Sprocket, the operator for ${shopName} — the owner's hands-on assistant for managing their ApprovePro order queue (A.C.E is the separate design engine; you drive the workflow). No single order is open, so you're in QUEUE mode across ALL the shop's orders. Use list_orders_needing_attention to tell the owner what needs them now, and find_order to look one up. To change or send an order, tell them to open it. Keep replies short and scannable — lead with what needs action. Be warm and plain.`
    : `You are Sprocket, the ApprovePro operator for ${shopName} — the shop's hands-on assistant (A.C.E is the separate design engine; you drive the workflow). You're managing ONE customer's wrap proof. Order: "${proof.design_name}" for ${proof.customer_name || "the customer"} (${proof.customer_email}).

TWO KINDS OF CHANGES — pick the right tool:
• WHOLE-DESIGN changes (overall color theme, add/replace a logo, change wording, restyle, add an element) → use revise_design.
• PRECISE SPOT changes (remove/recolor ONE specific area or element — "take the blue off the back", "remove this stripe", "make this panel black", "remove this logo/phone number", "end the wrap at this line") → do NOT use revise_design. It re-paints the whole image, is unreliable for spot edits, and can't tell "this blue" from "that blue". Instead tell the owner: "That's a precise spot edit — the reliable way is Edit this design → Precise, then Delete (scribble over the area) or Pen (circle it and say what it becomes). Only that exact spot changes." Offer to handle any whole-design parts yourself and hand the spot edit to Precise.

DRAFT-AND-APPROVE WORKFLOW (this is your default — follow it every time):
1. When the owner asks you to handle the customer's message, or to make a change, FIRST use read_conversation (if you don't already have it) to see exactly what the customer said.
2. Then PROPOSE — do NOT act yet. In the chat, show:
   • the exact reply you would send the customer (write it out, in a warm professional shop voice), and/or
   • the exact revision(s) you would make (describe each change plainly).
   Then ask: "Approve, or want changes?" and STOP.
3. WAIT for the owner. Only after they clearly approve ("yes", "send it", "approved", "do it", "go ahead") do you actually call the tool:
   • reply_to_customer to send the message, and/or
   • revise_design to make the edit.
   If they ask for tweaks, update your draft and re-propose — never send the old one.
4. NEVER call reply_to_customer, send_proof_to_customer, start_over_from_brief, or send_to_wrapbox before an explicit approval in THIS conversation. revise_design is non-destructive (it adds a new version the owner reviews before any proof is sent), but still propose the change and get a yes first.

COMPLETED ORDERS: when this order's status is approved, the customer is happy and the design is locked. You can still re-send them the approved proof (send_proof_to_customer) if they ask for a copy, and — when the owner says to send it to production / WrapBox — hand the approved design to WrapBox with send_to_wrapbox so the shop can print it. Don't try to revise an approved design unless the owner explicitly wants changes.

OTHER: report status with get_status; switch_version to go back a version. Keep your messages short and plain. After you take an action, say exactly what you did and what's next (e.g. "Sent. A new version will appear in the workbench — review it, then hit Send Proof when you're ready.").`;

  type CMsg = { role: "user" | "assistant"; content: any };
  // Sanitize the dock's chat history for the Anthropic API, which REQUIRES the
  // first message to be role:user and roles to strictly alternate. A raw
  // slice(-10) can start on an assistant turn (or contain same-role runs, e.g.
  // an error bubble), which makes Anthropic 400 instantly — that was surfacing
  // as "Edge Function returned a non-2xx status code" on perfectly normal asks.
  const messages: CMsg[] = [];
  for (const h of (body.history || []).slice(-10)) {
    if (!h?.role || typeof h.content !== "string" || !h.content.trim()) continue;
    const role: "user" | "assistant" = h.role === "assistant" ? "assistant" : "user";
    const last = messages[messages.length - 1];
    if (last && last.role === role && typeof last.content === "string") {
      last.content += "\n" + h.content; // merge same-role runs
    } else {
      messages.push({ role, content: h.content });
    }
  }
  while (messages.length && messages[0].role !== "user") messages.shift();
  const currentMsg = String(body.message).trim();
  const tail = messages[messages.length - 1];
  if (tail && tail.role === "user" && typeof tail.content === "string") {
    tail.content += "\n" + currentMsg;
  } else {
    messages.push({ role: "user", content: currentMsg });
  }

  const actionsTaken: Array<{ tool: string; ok: boolean }> = [];
  let finalText = "";

  // Claude call with retry — the operator's Anthropic calls intermittently
  // 429/500/502/503/529 (overload) or time out; a single hiccup must not fail
  // the whole turn (and make a successful revision look broken). Retry a few
  // times with backoff before giving up.
  const callClaude = async (): Promise<{ res: Response | null; data: any }> => {
    let lastData: any = {};
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(CLAUDE_API_URL, {
          method: "POST",
          headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
          body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 1024, system, tools, messages }),
          signal: AbortSignal.timeout(30_000),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) return { res, data };
        lastData = data;
        if (![429, 500, 502, 503, 529].includes(res.status)) return { res, data };
      } catch (e) {
        lastData = { error: { message: (e as Error).message } };
      }
      await new Promise((r) => setTimeout(r, 600 * Math.pow(2, attempt)));
    }
    return { res: null, data: lastData };
  };

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const { res, data } = await callClaude();
    if (!res || !res.ok) {
      console.error("[sprocket-operator] anthropic error:", res?.status ?? "no-response", JSON.stringify(data).slice(0, 300));
      // If we ALREADY performed actions this turn, a transient summarizer hiccup
      // must NOT surface as a scary "non-2xx" — the revision/reply already
      // happened. Report what got done so the owner isn't told it failed.
      if (actionsTaken.length > 0) {
        const did = Array.from(new Set(actionsTaken.filter((a) => a.ok).map((a) => a.tool)))
          .map((t) => t.replace(/_/g, " ")).join(", ");
        return jsonResponse({
          reply: finalText
            || `Done${did ? ` — I ran: ${did}` : ""}. A new version will appear in the workbench shortly (the progress bar shows while A.C.E generates it). Refresh if you don't see it.`,
          actions: actionsTaken,
        });
      }
      // No action ran and the AI is unreachable/rejected: tell the owner in
      // plain words (200) instead of a cryptic gateway "non-2xx" toast — the
      // dock renders `reply`, so this is what they actually see.
      const detail = data?.error?.message ? ` (${String(data.error.message).slice(0, 140)})` : "";
      return jsonResponse({
        reply: `I hit a snag reaching my brain just now${detail}. Nothing was changed — give it another try in a few seconds.`,
        actions: [],
      });
    }
    const content = data?.content || [];
    messages.push({ role: "assistant", content });
    const toolUses = content.filter((b: any) => b.type === "tool_use");
    const textBlocks = content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
    if (textBlocks) finalText = textBlocks;
    if (toolUses.length === 0 || data?.stop_reason !== "tool_use") break;
    const toolResults: any[] = [];
    for (const tu of toolUses) {
      const result = await runTool(tu.name, tu.input || {});
      actionsTaken.push({ tool: tu.name, ok: (result as any)?.ok !== false });
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result) });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return jsonResponse({ reply: finalText || "Done.", actions: actionsTaken });
}
