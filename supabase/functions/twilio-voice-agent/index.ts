/**
 * twilio-voice-agent
 *
 * AI receptionist for NML Pro shops. When a shop has voice_agent_enabled=true
 * and the owner misses a call, this function picks up instead of voicemail.
 *
 * Uses a turn-by-turn loop:
 *   Twilio <Gather input="speech"> → this function → OpenAI Chat → TwiML <Say> + <Gather>
 *
 * Gathers: caller name, vehicle year/make/model, service needed, urgency.
 * Creates a lead in the same pipeline as voicemail transcription.
 */

import { createExternalClient } from "../_shared/external-db.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── State passed between turns via URL param ──────────────────────────

interface AgentState {
  shopName: string;
  shopId: string | null;
  shopPhone: string | null;
  callerPhone: string;
  callSid: string;
  turn: number;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  collected: {
    name: string | null;
    year: string | null;
    make: string | null;
    model: string | null;
    service: string | null;
    urgency: string | null;
  };
}

function encodeState(state: AgentState): string {
  return btoa(JSON.stringify(state));
}

function decodeState(encoded: string): AgentState | null {
  try {
    return JSON.parse(atob(encoded));
  } catch {
    return null;
  }
}

// ── OpenAI Chat Completions ───────────────────────────────────────────

function buildSystemPrompt(shopName: string): string {
  return `You are a friendly AI receptionist for ${shopName}, a professional vehicle wrap shop. A customer just called and the team is busy — you're here to help.

YOUR JOB: Gather information to create a quote request. You need:
1. Their name
2. Vehicle year, make, and model
3. What service they want (full wrap, partial wrap, color change, chrome delete, PPF/paint protection, ceramic coating, commercial/fleet wrap, roof wrap, hood wrap, racing stripes, or other)
4. How soon they need it (just browsing, planning in the next few weeks, need it soon, urgent/ASAP)

RULES:
- Keep every response to 1-2 SHORT sentences. This is a phone call, not a text chat.
- Be warm, professional, and conversational. Sound human.
- If they give multiple pieces of info at once, acknowledge all of them.
- Don't repeat info they already gave you.
- Don't ask for info you already have.
- When you have everything, give a brief summary and say goodbye warmly.

RESPONSE FORMAT:
After your spoken response, on a NEW LINE output ONLY this JSON (no other text after it):
{"name":null,"year":null,"make":null,"model":null,"service":null,"urgency":null,"complete":false}
Fill in values as you learn them. Keep previously collected values. Set "complete":true ONLY when you have ALL 4 categories filled.`;
}

async function callOpenAI(
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 250,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error("[voice-agent] OpenAI error:", err);
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

// ── Parse AI response into spoken text + extraction ───────────────────

interface ParsedResponse {
  spokenText: string;
  extracted: {
    name: string | null;
    year: string | null;
    make: string | null;
    model: string | null;
    service: string | null;
    urgency: string | null;
    complete: boolean;
  };
}

function parseAIResponse(raw: string): ParsedResponse {
  // Split on the JSON block — it should be on the last line
  const lines = raw.trim().split("\n");
  let jsonLine = "";
  let spokenLines: string[] = [];

  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      jsonLine = trimmed;
      spokenLines = lines.slice(0, i);
      break;
    }
  }

  if (!jsonLine) {
    // No JSON found — treat entire response as spoken text
    spokenLines = lines;
  }

  const spokenText = spokenLines.join(" ").trim() || "I didn't quite catch that. Could you say that again?";

  let extracted = {
    name: null as string | null,
    year: null as string | null,
    make: null as string | null,
    model: null as string | null,
    service: null as string | null,
    urgency: null as string | null,
    complete: false,
  };

  if (jsonLine) {
    try {
      const parsed = JSON.parse(jsonLine);
      extracted = { ...extracted, ...parsed };
    } catch {
      console.warn("[voice-agent] Failed to parse JSON extraction:", jsonLine);
    }
  }

  return { spokenText, extracted };
}

// ── TwiML builders ────────────────────────────────────────────────────

function buildGatherTwiml(
  sayText: string,
  state: AgentState,
  baseUrl: string,
): string {
  const encodedState = encodeState(state);
  const actionUrl = `${baseUrl}/functions/v1/twilio-voice-agent?state=${encodeURIComponent(encodedState)}`;
  // Fallback: if caller doesn't speak, redirect to voicemail
  const voicemailUrl = `${baseUrl}/functions/v1/twilio-voice-webhook?step=voicemail-fallback&shopName=${encodeURIComponent(state.shopName)}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" timeout="6" speechTimeout="auto" action="${actionUrl}" language="en-US">
    <Say voice="Google.en-US-Standard-C">${escapeXml(sayText)}</Say>
  </Gather>
  <Say voice="Google.en-US-Standard-C">I didn't hear anything. Let me connect you to voicemail instead.</Say>
  <Redirect>${voicemailUrl}</Redirect>
</Response>`;
}

function buildEndCallTwiml(sayText: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Standard-C">${escapeXml(sayText)}</Say>
  <Hangup />
</Response>`;
}

function buildVoicemailRedirectTwiml(baseUrl: string, shopName: string): string {
  const voicemailUrl = `${baseUrl}/functions/v1/twilio-voice-webhook?step=voicemail-fallback&shopName=${encodeURIComponent(shopName)}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Standard-C">Let me connect you to voicemail instead. Please leave a message after the beep.</Say>
  <Redirect>${voicemailUrl}</Redirect>
</Response>`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── SMS helper ────────────────────────────────────────────────────────

async function sendSms(to: string, body: string): Promise<boolean> {
  const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const twilioAuth = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioPhone = Deno.env.get("TWILIO_PHONE_NUMBER");
  if (!twilioSid || !twilioAuth || !twilioPhone) return false;

  const formData = new URLSearchParams();
  formData.append("To", to);
  formData.append("From", twilioPhone);
  formData.append("Body", body);

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${twilioSid}:${twilioAuth}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    },
  );

  if (!res.ok) {
    console.error(`[voice-agent] SMS failed to ${to}:`, await res.text());
    return false;
  }
  return true;
}

// ── Lead creation (mirrors twilio-transcription-callback pattern) ─────

async function createOrUpdateLead(state: AgentState): Promise<string | null> {
  const supabase = createExternalClient();
  const c = state.collected;

  const vehicleStr = [c.year, c.make, c.model].filter(Boolean).join(" ");
  const siteUrl = Deno.env.get("SITE_URL") || "https://restylepro.ai";

  const quoteParams = new URLSearchParams();
  if (c.year) quoteParams.set("year", c.year);
  if (c.make) quoteParams.set("make", c.make);
  if (c.model) quoteParams.set("model", c.model);
  const quoteUrl = `${siteUrl}/quick-quote${quoteParams.toString() ? "?" + quoteParams.toString() : ""}`;

  const leadData: Record<string, unknown> = {
    caller_name: c.name,
    vehicle_year: c.year,
    vehicle_make: c.make,
    vehicle_model: c.model,
    service_requested: c.service,
    source: "voice_agent",
    is_hot: true,
    quote_url: quoteUrl,
    voicemail_transcript: state.messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join(" | "),
    metadata: {
      voice_agent_turns: state.turn,
      urgency: c.urgency,
      collected: c,
    },
  };

  // Try to update existing lead (created by twilio-voice-webhook step=missed)
  const { data: existing } = await supabase
    .from("leads")
    .select("id")
    .eq("twilio_call_sid", state.callSid)
    .limit(1)
    .single();

  let leadId: string | null = null;

  if (existing) {
    await supabase.from("leads").update(leadData).eq("id", (existing as any).id);
    leadId = (existing as any).id;
  } else {
    const { data: newLead } = await supabase
      .from("leads")
      .insert({
        ...leadData,
        caller_phone: state.callerPhone,
        twilio_call_sid: state.callSid,
        status: "new",
      })
      .select("id")
      .single();
    leadId = (newLead as any)?.id || null;
  }

  // Upsert customer record
  if (state.callerPhone) {
    const { data: existingCustomer } = await supabase
      .from("customers")
      .select("id, total_inquiries")
      .eq("phone", state.callerPhone)
      .limit(1)
      .single();

    if (existingCustomer) {
      await supabase
        .from("customers")
        .update({
          name: c.name || undefined,
          last_vehicle: vehicleStr || undefined,
          last_service: c.service || undefined,
          last_contact_at: new Date().toISOString(),
          total_inquiries: ((existingCustomer as any).total_inquiries || 0) + 1,
        })
        .eq("id", (existingCustomer as any).id);

      if (leadId) {
        await supabase.from("leads").update({ customer_id: (existingCustomer as any).id }).eq("id", leadId);
      }
    } else {
      const { data: newCustomer } = await supabase
        .from("customers")
        .insert({
          phone: state.callerPhone,
          name: c.name,
          last_vehicle: vehicleStr || null,
          last_service: c.service || null,
          source: "voice-agent",
          total_inquiries: 1,
        })
        .select("id")
        .single();

      if (newCustomer && leadId) {
        await supabase.from("leads").update({ customer_id: (newCustomer as any).id }).eq("id", leadId);
      }
    }
  }

  // QuikText — auto-text customer with QuickQuote link
  if (state.callerPhone) {
    const customerName = c.name || "there";
    const vehicleLabel = vehicleStr || "your vehicle";
    const msg = `Hey ${customerName}! ${state.shopName} here. Thanks for calling — we got all your info on the ${vehicleLabel}. Here's your instant quote link: ${quoteUrl}`;
    const sent = await sendSms(state.callerPhone, msg);

    if (sent && leadId) {
      await supabase.from("leads").update({
        sms_sent_to_customer: true,
        auto_texted_at: new Date().toISOString(),
      }).eq("id", leadId);
    }
  }

  // Notify shop owner
  if (state.shopPhone) {
    const nameStr = c.name || "Unknown caller";
    const serviceStr = c.service ? ` — ${c.service}` : "";
    const urgencyStr = c.urgency ? ` [${c.urgency}]` : "";
    const approveUrl = `${siteUrl}/quiktext-approve?id=${leadId}`;
    const shopMsg = `AI RECEPTIONIST: ${nameStr} — ${vehicleStr}${serviceStr}${urgencyStr}. Review & send quote: ${approveUrl}`;
    const sent = await sendSms(state.shopPhone, shopMsg);

    if (sent && leadId) {
      await supabase.from("leads").update({ sms_sent_to_shop: true }).eq("id", leadId);
    }
  }

  // Track event
  await supabase.from("quote_events").insert({
    event_type: "voice_agent_lead",
    product_type: "QuickQuote",
    source: "voice-agent",
    metadata: {
      leadId,
      callerPhone: state.callerPhone,
      callerName: c.name,
      vehicle: vehicleStr || null,
      serviceRequested: c.service,
      urgency: c.urgency,
      turns: state.turn,
    },
  }).catch(() => {});

  console.log(`[voice-agent] Lead ${leadId} created. ${c.name} — ${vehicleStr} — ${c.service} — ${c.urgency}`);
  return leadId;
}

// ── Main handler ──────────────────────────────────────────────────────

const MAX_TURNS = 8;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const baseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("EXTERNAL_SUPABASE_URL") || "";
  const url = new URL(req.url);

  try {
    // ── Initial entry (redirected from twilio-voice-webhook) ────────
    const ctxParam = url.searchParams.get("ctx");
    const stateParam = url.searchParams.get("state");

    let state: AgentState;

    if (stateParam) {
      // Continuing conversation — decode state
      const decoded = decodeState(stateParam);
      if (!decoded) {
        console.error("[voice-agent] Invalid state param");
        return new Response(
          buildVoicemailRedirectTwiml(baseUrl, "the shop"),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "text/xml" } },
        );
      }
      state = decoded;
    } else if (ctxParam) {
      // First turn — initialize from context
      let ctx: { shopName: string; shopId: string | null; shopPhone: string | null; callerPhone: string; callSid: string };
      try {
        ctx = JSON.parse(atob(decodeURIComponent(ctxParam)));
      } catch {
        console.error("[voice-agent] Invalid ctx param");
        return new Response(
          buildVoicemailRedirectTwiml(baseUrl, "the shop"),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "text/xml" } },
        );
      }

      state = {
        shopName: ctx.shopName || "the shop",
        shopId: ctx.shopId || null,
        shopPhone: ctx.shopPhone || null,
        callerPhone: ctx.callerPhone || "",
        callSid: ctx.callSid || "",
        turn: 0,
        messages: [{ role: "system", content: buildSystemPrompt(ctx.shopName || "the shop") }],
        collected: { name: null, year: null, make: null, model: null, service: null, urgency: null },
      };

      // First turn — just send the greeting
      const greeting = `Hi, thanks for calling ${state.shopName}! I'm the AI assistant and I can help get you a quote right now. What's your name?`;
      state.messages.push({ role: "assistant", content: greeting });
      state.turn = 1;

      console.log(`[voice-agent] New call from ${state.callerPhone}, SID: ${state.callSid}`);

      return new Response(
        buildGatherTwiml(greeting, state, baseUrl),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "text/xml" } },
      );
    } else {
      // No context — shouldn't happen, redirect to voicemail
      return new Response(
        buildVoicemailRedirectTwiml(baseUrl, "the shop"),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "text/xml" } },
      );
    }

    // ── Continuing conversation — process speech ───────────────────
    let speechResult = "";
    try {
      const formData = await req.formData();
      speechResult = formData.get("SpeechResult")?.toString() || "";
    } catch {
      // If form parsing fails, try to continue
    }

    console.log(`[voice-agent] Turn ${state.turn}, SID: ${state.callSid}, speech: "${speechResult}"`);

    if (!speechResult) {
      // No speech detected — ask them to try again (one retry, then voicemail)
      if (state.turn >= MAX_TURNS - 1) {
        return new Response(
          buildVoicemailRedirectTwiml(baseUrl, state.shopName),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "text/xml" } },
        );
      }

      const retry = "Sorry, I didn't catch that. Could you say that again?";
      return new Response(
        buildGatherTwiml(retry, state, baseUrl),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "text/xml" } },
      );
    }

    // Add user message
    state.messages.push({ role: "user", content: speechResult });

    // Call OpenAI
    let aiRaw: string;
    try {
      aiRaw = await callOpenAI(state.messages);
    } catch (err: any) {
      console.error("[voice-agent] OpenAI failed:", err?.message);
      // Save partial data if we have any, then redirect to voicemail
      if (state.collected.name || state.collected.make) {
        await createOrUpdateLead(state).catch(() => {});
      }
      return new Response(
        buildVoicemailRedirectTwiml(baseUrl, state.shopName),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "text/xml" } },
      );
    }

    // Parse response
    const { spokenText, extracted } = parseAIResponse(aiRaw);

    // Merge extracted data (keep previous values if new ones are null)
    const c = state.collected;
    if (extracted.name) c.name = extracted.name;
    if (extracted.year) c.year = extracted.year;
    if (extracted.make) c.make = extracted.make;
    if (extracted.model) c.model = extracted.model;
    if (extracted.service) c.service = extracted.service;
    if (extracted.urgency) c.urgency = extracted.urgency;

    state.messages.push({ role: "assistant", content: aiRaw });
    state.turn++;

    console.log(`[voice-agent] Collected so far:`, c, `complete=${extracted.complete}`);

    // ── Check if done ──────────────────────────────────────────────
    if (extracted.complete || state.turn >= MAX_TURNS) {
      // Create lead + send notifications
      await createOrUpdateLead(state);

      // Build goodbye message
      const vehicleStr = [c.year, c.make, c.model].filter(Boolean).join(" ");
      const goodbye = extracted.complete
        ? spokenText || `Perfect! I've got everything. We'll text you a quote for the ${vehicleStr || "vehicle"} right away. Thanks for calling ${state.shopName}!`
        : `Thanks for the info! We'll follow up with you shortly. Have a great day!`;

      return new Response(
        buildEndCallTwiml(goodbye),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "text/xml" } },
      );
    }

    // ── Continue conversation ──────────────────────────────────────
    return new Response(
      buildGatherTwiml(spokenText, state, baseUrl),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "text/xml" } },
    );
  } catch (err: any) {
    console.error("[voice-agent] Unexpected error:", err);
    return new Response(
      buildVoicemailRedirectTwiml(baseUrl, "the shop"),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "text/xml" } },
    );
  }
});
