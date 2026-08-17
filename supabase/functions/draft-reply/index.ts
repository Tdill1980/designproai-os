import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-6";

interface ThreadMsg { who: "customer" | "shop" | "system"; text: string; }
interface Body {
  customerName?: string;
  orderNumber?: string;
  vehicle?: string;
  needsInstructions?: boolean;
  thread?: ThreadMsg[];
  instruction?: string; // optional steering from the designer ("offer 10% off", etc.)
  draft?: string;       // the designer's rough/shorthand text to REWRITE professionally
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) {
      return new Response(JSON.stringify({ error: "AI is not configured (missing key)." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const b = (await req.json()) as Body;

    const ctx: string[] = [];
    if (b.orderNumber) ctx.push(`Order #${b.orderNumber}`);
    if (b.customerName) ctx.push(`Customer: ${b.customerName}`);
    if (b.vehicle) ctx.push(`Vehicle: ${b.vehicle}`);
    if (b.needsInstructions) ctx.push("We still need the customer's project details and artwork to start the design.");

    const transcript = (b.thread || [])
      .slice(-12)
      .map((m) => `${m.who === "customer" ? "CUSTOMER" : m.who === "system" ? "SYSTEM" : "US"}: ${m.text}`)
      .join("\n");

    // Two modes:
    //  - REWRITE (designer typed shorthand → polish it): preserve their meaning
    //    and facts exactly, just make it sound professional.
    //  - DRAFT (box empty → write from context/thread): the original behavior.
    const rewriteDraft = (b.draft || "").trim();
    const isRewrite = rewriteDraft.length > 0;

    const system = isRewrite
      ? "You are a writing assistant for WePrintWraps, a vehicle-wrap design & print shop. " +
        "A designer wrote a rough, shorthand reply to a customer. Rewrite it so it sounds warm, clear, and professional. " +
        "CRITICAL: preserve the designer's meaning and every specific they wrote (numbers, dates, names, prices, promises) EXACTLY — do not add, remove, or invent any facts, prices, dates, or commitments. " +
        "Keep it concise (2-5 sentences), no corporate fluff, no emojis. Match the conversation's tone. " +
        "Output ONLY the rewritten message, ready to send — no preamble, no options, no quotes around it."
      : "You are a warm, professional customer-service writer for WePrintWraps, a vehicle-wrap design & print shop. " +
        "Write a SHORT reply (2-5 sentences) the shop can send to the customer. Be friendly and clear, no corporate fluff, no emojis. " +
        "If we're waiting on details, politely ask for exactly what's missing: a short description of the wrap, the vehicle year/make/model, any logos/brand colors/photos, and any inspiration examples — and tell them to reply with their artwork attached. " +
        "Do not invent prices, dates, or promises. Sign off as 'The WePrintWraps Design Team'. Output ONLY the reply text, ready to send.";

    const userMsg = isRewrite
      ? `Context:\n${ctx.join("\n") || "(none)"}\n\n` +
        (transcript ? `Conversation so far (for tone only):\n${transcript}\n\n` : "") +
        `The designer's rough draft to rewrite (keep all its facts exactly):\n${rewriteDraft}\n\n` +
        "Rewrite it now."
      : `Context:\n${ctx.join("\n") || "(none)"}\n\n` +
        (transcript ? `Conversation so far:\n${transcript}\n\n` : "") +
        (b.instruction ? `Designer's instruction for this reply: ${b.instruction}\n\n` : "") +
        "Draft the reply now.";

    const res = await fetch(CLAUDE_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 500,
        system,
        messages: [{ role: "user", content: userMsg }],
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("[draft-reply] anthropic error:", data);
      return new Response(JSON.stringify({ error: data?.error?.message || "AI request failed" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const draft = (data?.content?.[0]?.text || "").trim();
    return new Response(JSON.stringify({ draft }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[draft-reply] error:", e);
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
