/**
 * Twilio Transcription Callback — Parse Voicemail → Create Lead → Send SMS
 *
 * Called by Twilio when voicemail transcription is ready.
 * Parses vehicle info from transcript using keyword matching (no AI),
 * creates/updates the lead, generates a QuickQuote link,
 * and fires SMS to both customer and shop owner.
 */

import { createExternalClient } from "../_shared/external-db.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Vehicle makes for transcript matching ──────────────────────────
// Top makes that cover 95%+ of wrap shop customers
const KNOWN_MAKES: Record<string, string[]> = {
  "BMW": ["bmw", "beamer", "bimmer"],
  "Mercedes-Benz": ["mercedes", "benz", "merc"],
  "Porsche": ["porsche"],
  "Audi": ["audi"],
  "Tesla": ["tesla"],
  "Ford": ["ford"],
  "Chevrolet": ["chevy", "chevrolet"],
  "Dodge": ["dodge"],
  "Toyota": ["toyota"],
  "Honda": ["honda"],
  "Lexus": ["lexus"],
  "Infiniti": ["infiniti"],
  "Nissan": ["nissan"],
  "Jeep": ["jeep"],
  "Ram": ["ram"],
  "GMC": ["gmc"],
  "Cadillac": ["cadillac", "caddy"],
  "Volkswagen": ["volkswagen", "vw"],
  "Hyundai": ["hyundai"],
  "Kia": ["kia"],
  "Subaru": ["subaru"],
  "Mazda": ["mazda"],
  "Acura": ["acura"],
  "Lamborghini": ["lamborghini", "lambo"],
  "Ferrari": ["ferrari"],
  "McLaren": ["mclaren"],
  "Rolls-Royce": ["rolls royce", "rolls"],
  "Bentley": ["bentley"],
  "Maserati": ["maserati"],
  "Land Rover": ["land rover", "range rover"],
  "Jaguar": ["jaguar", "jag"],
  "Volvo": ["volvo"],
  "Lincoln": ["lincoln"],
  "Chrysler": ["chrysler"],
  "Buick": ["buick"],
  "Genesis": ["genesis"],
  "Rivian": ["rivian"],
  "Lucid": ["lucid"],
};

// Common models for fuzzy matching
const KNOWN_MODELS: Record<string, string[]> = {
  // BMW
  "M3": ["m3"], "M4": ["m4"], "M5": ["m5"], "X5": ["x5"], "X3": ["x3"],
  "3 Series": ["3 series", "330", "340"], "5 Series": ["5 series", "530", "540"],
  // Mercedes
  "C-Class": ["c class", "c300", "c43", "c63"], "E-Class": ["e class", "e350", "e63"],
  "S-Class": ["s class", "s500", "s580"], "GLE": ["gle"], "AMG GT": ["amg gt"],
  // Tesla
  "Model 3": ["model 3"], "Model Y": ["model y"], "Model S": ["model s"],
  "Model X": ["model x"], "Cybertruck": ["cybertruck", "cyber truck"],
  // Ford
  "Mustang": ["mustang"], "F-150": ["f150", "f 150"], "Bronco": ["bronco"],
  "Explorer": ["explorer"], "Raptor": ["raptor"],
  // Chevy
  "Corvette": ["corvette", "vette"], "Camaro": ["camaro"], "Silverado": ["silverado"],
  "Tahoe": ["tahoe"], "Suburban": ["suburban"],
  // Dodge
  "Charger": ["charger"], "Challenger": ["challenger"], "Durango": ["durango"],
  "Hellcat": ["hellcat"],
  // Toyota
  "Supra": ["supra"], "Camry": ["camry"], "4Runner": ["4runner", "4 runner"],
  "Tundra": ["tundra"], "Tacoma": ["tacoma"], "GR86": ["gr86", "gr 86"],
  // Honda
  "Civic": ["civic"], "Accord": ["accord"], "CR-V": ["crv", "cr-v"],
  "Type R": ["type r"],
  // Porsche
  "911": ["911", "nine eleven"], "Cayenne": ["cayenne"], "Macan": ["macan"],
  "Taycan": ["taycan"], "Panamera": ["panamera"],
  // Jeep
  "Wrangler": ["wrangler"], "Grand Cherokee": ["grand cherokee"], "Gladiator": ["gladiator"],
  // Lambo
  "Urus": ["urus"], "Huracan": ["huracan"], "Aventador": ["aventador"],
  // Generic
  "Escalade": ["escalade"], "Navigator": ["navigator"],
  "Range Rover": ["range rover"], "Defender": ["defender"],
};

// Service keywords
const SERVICE_KEYWORDS: Record<string, string[]> = {
  "Full Wrap": ["full wrap", "full color", "color change", "whole car", "entire car", "complete wrap"],
  "Partial Wrap": ["partial wrap", "partial", "half wrap"],
  "Chrome Delete": ["chrome delete", "chrome", "de-chrome", "blackout trim"],
  "PPF": ["ppf", "paint protection", "clear bra", "protection film"],
  "Roof Wrap": ["roof wrap", "roof"],
  "Hood Wrap": ["hood wrap", "hood"],
  "Racing Stripes": ["stripes", "racing stripes", "rally stripes"],
  "Commercial Wrap": ["commercial", "fleet", "business", "van wrap", "truck lettering"],
  "Ceramic Coating": ["ceramic", "ceramic coating"],
};

// ── Transcript Parser ──────────────────────────────────────────────

interface ParsedLead {
  callerName: string | null;
  vehicleYear: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  serviceRequested: string | null;
}

function parseTranscript(transcript: string): ParsedLead {
  const text = transcript.toLowerCase().trim();

  // Extract year — 4-digit number between 1990 and current year + 2
  const maxYear = new Date().getFullYear() + 2;
  const yearMatch = text.match(/\b(19[9]\d|20[0-3]\d)\b/);
  const vehicleYear = yearMatch && parseInt(yearMatch[1]) <= maxYear ? yearMatch[1] : null;

  // Extract make
  let vehicleMake: string | null = null;
  for (const [make, aliases] of Object.entries(KNOWN_MAKES)) {
    for (const alias of aliases) {
      if (text.includes(alias)) {
        vehicleMake = make;
        break;
      }
    }
    if (vehicleMake) break;
  }

  // Extract model
  let vehicleModel: string | null = null;
  for (const [model, aliases] of Object.entries(KNOWN_MODELS)) {
    for (const alias of aliases) {
      if (text.includes(alias)) {
        vehicleModel = model;
        break;
      }
    }
    if (vehicleModel) break;
  }

  // Extract service
  let serviceRequested: string | null = null;
  for (const [service, keywords] of Object.entries(SERVICE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        serviceRequested = service;
        break;
      }
    }
    if (serviceRequested) break;
  }

  // Extract name — look for "my name is X", "this is X", "it's X", "I'm X"
  let callerName: string | null = null;
  const namePatterns = [
    /(?:my name is|this is|it's|i'm|i am|name's)\s+([a-z]+(?:\s+[a-z]+)?)/i,
    /^(?:hey|hi|hello|yo)[\s,]+(?:this is|it's|i'm)\s+([a-z]+(?:\s+[a-z]+)?)/i,
  ];
  for (const pattern of namePatterns) {
    const match = transcript.match(pattern);
    if (match) {
      callerName = match[1].split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      break;
    }
  }

  return { callerName, vehicleYear, vehicleMake, vehicleModel, serviceRequested };
}

// ── QuikText — Intent-based auto-text ────────────────────────────
// Parses voicemail for intent signals. If the caller mentions needing
// a quote, says it's urgent/rush, or has a problem → auto-text them
// with a QuickQuote link. Otherwise → shop notification only.

const QUOTE_KEYWORDS = [
  "quote", "price", "pricing", "estimate", "cost", "how much",
  "what would it cost", "what's the price", "get a number",
  "ballpark", "give me a price", "send me a quote",
  "need a quote", "looking for a quote", "want a quote",
  "wrap my", "wrap the", "get it wrapped", "get wrapped",
];

const RUSH_KEYWORDS = [
  "rush", "urgent", "asap", "as soon as possible", "right away",
  "immediately", "today", "this week", "need it done", "fast",
  "hurry", "time sensitive", "deadline", "emergency",
];

const PROBLEM_KEYWORDS = [
  "problem", "issue", "damage", "damaged", "scratched", "scratch",
  "dent", "faded", "peeling", "bubbling", "cracked", "broken",
  "accident", "hit", "keyed", "vandal", "insurance", "claim",
  "fix", "repair", "redo", "replace",
];

function shouldQuikText(transcript: string): { trigger: boolean; reason: string } {
  const text = transcript.toLowerCase();

  for (const kw of QUOTE_KEYWORDS) {
    if (text.includes(kw)) return { trigger: true, reason: "quote" };
  }
  for (const kw of RUSH_KEYWORDS) {
    if (text.includes(kw)) return { trigger: true, reason: "rush" };
  }
  for (const kw of PROBLEM_KEYWORDS) {
    if (text.includes(kw)) return { trigger: true, reason: "problem" };
  }

  return { trigger: false, reason: "none" };
}

// ── Send SMS via Twilio ────────────────────────────────────────────

async function sendSms(to: string, body: string): Promise<boolean> {
  const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const twilioAuth = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioPhone = Deno.env.get("TWILIO_PHONE_NUMBER");

  if (!twilioSid || !twilioAuth || !twilioPhone) {
    console.error("[twilio-transcription] Twilio credentials not configured");
    return false;
  }

  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
  const authHeader = btoa(`${twilioSid}:${twilioAuth}`);

  const formData = new URLSearchParams();
  formData.append("To", to);
  formData.append("From", twilioPhone);
  formData.append("Body", body);

  const res = await fetch(twilioUrl, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${authHeader}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`[twilio-transcription] SMS failed to ${to}: ${err}`);
    return false;
  }

  return true;
}

// ── Main Handler ───────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const type = url.searchParams.get("type");

    // Twilio sends form-encoded data
    const formData = await req.formData();
    const callSid = formData.get("CallSid")?.toString() || "";
    const callerPhone = formData.get("From")?.toString() || formData.get("Caller")?.toString() || "";

    // Handle recording_complete (just acknowledge — we wait for transcription)
    if (type === "recording_complete") {
      const recordingUrl = formData.get("RecordingUrl")?.toString() || "";

      console.log(`[twilio-transcription] Recording complete for ${callSid}: ${recordingUrl}`);

      // Update lead with recording URL
      if (recordingUrl && callSid) {
        const supabase = createExternalClient();
        await supabase
          .from("leads")
          .update({ voicemail_recording_url: recordingUrl })
          .eq("twilio_call_sid", callSid);
      }

      // Return TwiML to end the call
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Got it! We'll text you a quote shortly. Talk soon!</Say></Response>`,
        { status: 200, headers: { ...corsHeaders, "Content-Type": "text/xml" } }
      );
    }

    // ── Transcription callback ──────────────────────────────────
    const transcript = formData.get("TranscriptionText")?.toString() || "";
    const transcriptionStatus = formData.get("TranscriptionStatus")?.toString() || "";
    const recordingUrl = formData.get("RecordingUrl")?.toString() || "";
    const confidence = parseFloat(formData.get("TranscriptionConfidence")?.toString() || "0");

    console.log(`[twilio-transcription] Received for ${callSid}: status=${transcriptionStatus}, text="${transcript}"`);

    if (!transcript || transcriptionStatus !== "completed") {
      console.log("[twilio-transcription] No transcript or not completed, skipping");
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    // Parse vehicle info from transcript
    const parsed = parseTranscript(transcript);

    console.log(`[twilio-transcription] Parsed:`, parsed);

    const supabase = createExternalClient();

    // Get shop info for SMS
    const { data: shop } = await supabase
      .from("shop_profiles")
      .select("phone, shop_name, user_id")
      .limit(1)
      .single();

    const shopName = shop?.shop_name || "RestyleProAI";
    const shopPhone = shop?.phone;

    // Build QuickQuote URL
    const siteUrl = Deno.env.get("SITE_URL") || "https://restylepro.ai";
    const quoteParams = new URLSearchParams();
    if (parsed.vehicleYear) quoteParams.set("year", parsed.vehicleYear);
    if (parsed.vehicleMake) quoteParams.set("make", parsed.vehicleMake);
    if (parsed.vehicleModel) quoteParams.set("model", parsed.vehicleModel);
    const quoteUrl = `${siteUrl}/quick-quote${quoteParams.toString() ? "?" + quoteParams.toString() : ""}`;

    // QuikText — check if caller needs auto-response
    const quikText = shouldQuikText(transcript);
    console.log(`[twilio-transcription] QuikText: ${quikText.trigger ? "YES" : "no"} (reason: ${quikText.reason})`);

    // Update the lead record
    const updateData: Record<string, unknown> = {
      voicemail_transcript: transcript,
      voicemail_recording_url: recordingUrl || undefined,
      transcription_confidence: confidence,
      caller_name: parsed.callerName,
      vehicle_year: parsed.vehicleYear,
      vehicle_make: parsed.vehicleMake,
      vehicle_model: parsed.vehicleModel,
      service_requested: parsed.serviceRequested,
      quote_url: quoteUrl,
      source: "voicemail",
      is_hot: quikText.trigger,
      metadata: { quicktext_reason: quikText.reason },
    };

    // Try to update existing lead by call SID, or insert new one
    const { data: existingLead } = await supabase
      .from("leads")
      .select("id")
      .eq("twilio_call_sid", callSid)
      .limit(1)
      .single();

    let leadId: string;

    if (existingLead) {
      await supabase.from("leads").update(updateData).eq("id", existingLead.id);
      leadId = existingLead.id;
    } else {
      const { data: newLead } = await supabase
        .from("leads")
        .insert({ ...updateData, caller_phone: callerPhone, twilio_call_sid: callSid })
        .select("id")
        .single();
      leadId = newLead?.id || "unknown";
    }

    // ── Upsert customer record ─────────────────────────────────
    const vehicleStr = [parsed.vehicleYear, parsed.vehicleMake, parsed.vehicleModel]
      .filter(Boolean).join(" ");

    // Save/update customer in cloud DB
    if (callerPhone) {
      const { data: existingCustomer } = await supabase
        .from("customers")
        .select("id")
        .eq("phone", callerPhone)
        .limit(1)
        .single();

      if (existingCustomer) {
        await supabase.from("customers").update({
          name: parsed.callerName || undefined,
          last_vehicle: vehicleStr || undefined,
          last_service: parsed.serviceRequested || undefined,
          last_contact_at: new Date().toISOString(),
          total_inquiries: (existingCustomer as any).total_inquiries + 1 || 1,
        }).eq("id", existingCustomer.id);

        await supabase.from("leads").update({ customer_id: existingCustomer.id }).eq("id", leadId);
      } else {
        const { data: newCustomer } = await supabase
          .from("customers")
          .insert({
            phone: callerPhone,
            name: parsed.callerName,
            last_vehicle: vehicleStr || null,
            last_service: parsed.serviceRequested || null,
            source: "twilio-voicemail",
            total_inquiries: 1,
          })
          .select("id")
          .single();

        if (newCustomer) {
          await supabase.from("leads").update({ customer_id: newCustomer.id }).eq("id", leadId);
        }
      }
    }

    // ── QuikText → Auto-text customer if intent detected ──
    let customerTexted = false;
    if (quikText.trigger && callerPhone) {
      const customerName = parsed.callerName || "there";
      const vehicleLabel = vehicleStr || "your vehicle";

      let customerMsg = "";
      if (quikText.reason === "rush") {
        customerMsg = `Hey ${customerName}! ${shopName} here — we got your message and know it's urgent. Your ${vehicleLabel} quote is ready: ${quoteUrl} Call us back anytime.`;
      } else if (quikText.reason === "problem") {
        customerMsg = `Hey ${customerName}, ${shopName} here. We got your message about the ${vehicleLabel}. We can help — here's your quote link to get started: ${quoteUrl} We'll follow up shortly.`;
      } else {
        customerMsg = `Hey ${customerName}! ${shopName} here. We got your message about the ${vehicleLabel}. Your instant wrap estimate is ready: ${quoteUrl}`;
      }

      customerTexted = await sendSms(callerPhone, customerMsg);
      if (customerTexted) {
        await supabase.from("leads").update({
          sms_sent_to_customer: true,
          auto_texted_at: new Date().toISOString(),
        }).eq("id", leadId);
      }
      console.log(`[twilio-transcription] QuikText sent (${quikText.reason}): ${customerTexted ? "ok" : "failed"}`);
    }

    // ── SMS to Shop Owner — always notify with approve link ──
    if (shopPhone) {
      const serviceStr = parsed.serviceRequested ? ` — ${parsed.serviceRequested}` : "";
      const nameStr = parsed.callerName || "Unknown caller";
      const approveUrl = `${siteUrl}/quiktext-approve?id=${leadId}`;
      const tag = quikText.trigger ? `QUIKTEXT (${quikText.reason})` : "NEW LEAD";
      const autoNote = customerTexted ? " — customer auto-texted" : "";
      const shopMsg = vehicleStr
        ? `${tag}: ${nameStr} — ${vehicleStr}${serviceStr}${autoNote}. Approve/edit & send: ${approveUrl}`
        : `MISSED CALL from ${callerPhone}. ${nameStr} left a voicemail. Review: ${approveUrl}`;

      const shopSent = await sendSms(shopPhone, shopMsg);
      if (shopSent) {
        await supabase.from("leads").update({ sms_sent_to_shop: true }).eq("id", leadId);
      }
    }

    // Track event
    await supabase.from("quote_events").insert({
      event_type: quikText.trigger ? "quicktext_sent" : "lead_captured",
      quote_id: null,
      product_type: "QuickQuote",
      source: "twilio-voicemail",
      metadata: {
        leadId, callerPhone, callerName: parsed.callerName,
        vehicle: vehicleStr || null, serviceRequested: parsed.serviceRequested,
        transcriptionConfidence: confidence,
        quiktext: quikText.trigger, quiktextReason: quikText.reason,
        customerAutoTexted: customerTexted,
      },
    });

    console.log(`[twilio-transcription] Lead ${leadId} processed. QuikText: ${quikText.trigger} (${quikText.reason}). Texted: ${customerTexted}. Shop: ${!!shopPhone}.`);

    return new Response(JSON.stringify({ success: true, leadId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[twilio-transcription] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 200, // Always 200 for Twilio callbacks
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
