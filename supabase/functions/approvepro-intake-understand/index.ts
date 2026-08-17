/**
 * approvepro-intake-understand — the multimodal "intake brain" for ApprovePro.
 *
 * Reads EVERYTHING a customer sends for a design order — long/messy prose, the
 * line-item brief, the checkout note, prompt-history edits, email threads, AND
 * every uploaded file — then returns ONE structured, actionable design brief.
 *
 * It does the perception the old regex `classifyIntake` could not:
 *   - Classifies each uploaded image by KIND: a reference design to match, the
 *     customer's OWN vehicle, an ANNOTATED instruction (arrows/lines/handwriting
 *     on a photo), a logo / brand asset, a color swatch, a SCREENSHOT of text
 *     (email/chat/notes), or loose inspiration.
 *   - OCRs / transcribes text inside screenshots and folds it into the brief.
 *   - Reads annotations on photos and translates them into spatial design
 *     instructions (e.g. a yellow line across the fender = the 3/4-wrap cut line).
 *   - Merges every text + image signal into one deduped brief.
 *   - DECIDES the route: DesignPro (create) vs RecreatePro (exact clone) vs
 *     RecreatePro + edits vs inspired-by vs needs-info.
 *   - Separates a LOGO/brand asset (→ editable overlay, never cloned into the
 *     wrap) from a reference DESIGN (→ clone / inspire).
 *   - Emits a discrete edit_list and clarifying questions when ambiguous.
 *
 * The structured output is what feeds design-panel-ai-generate (base render),
 * the clone→revise two-pass (edits), LayerLiftIQ (logo overlay), and the 2D
 * proof — so the render pipeline itself stays untouched (and locked).
 *
 * Input  (either pass a proof_id and we load everything, or pass fields raw):
 *   {
 *     proof_id?: string,
 *     text?: { orderNote?, lineItemBrief?, customerNote?, emailThread?,
 *              promptHistory?: string[] },
 *     images?: Array<{ url?, base64?, mimeType?, label? }>,
 *     vehicle?: { year?, make?, model? }
 *   }
 * Output: { ok: true, understanding: {...}, model, asset_count }
 *
 * Uses gemini-2.5-flash for understanding (NOT the locked image-gen model).
 * Per JWT.md §1: verify_jwt = false in supabase/config.toml.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const MAX_IMAGES = 8;
const IMG_FETCH_TIMEOUT_MS = 15_000;
const GEMINI_TIMEOUT_MS = 60_000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface RawImage {
  url?: string;
  base64?: string;
  mimeType?: string;
  label?: string;
}

interface IntakeText {
  orderNote?: string;
  lineItemBrief?: string;
  customerNote?: string;
  emailThread?: string;
  promptHistory?: string[];
}

interface IntakeRequest {
  proof_id?: string;
  text?: IntakeText;
  images?: RawImage[];
  vehicle?: { year?: string; make?: string; model?: string };
}

/** Fetch a remote image and return base64 + mime. Chunked to avoid stack overflow. */
async function fetchImageAsBase64(
  url: string,
  timeoutMs = IMG_FETCH_TIMEOUT_MS,
): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Deno/1.0 RestylePro-Intake/1.0" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return null;
    const mimeType = resp.headers.get("content-type") || "image/png";
    if (!/^image\//i.test(mimeType)) return null; // skip PDFs/zip/etc for the vision pass
    const buf = new Uint8Array(await resp.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 8192) {
      const chunk = buf.subarray(i, Math.min(i + 8192, buf.length));
      bin += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return { base64: btoa(bin), mimeType };
  } catch {
    return null;
  }
}

const SYSTEM_PROMPT = `You are the intake analyst for a $5,000–$8,000/vehicle wrap studio.
A customer has placed a custom vehicle-wrap design order and sent a mix of typed
text and uploaded files. Your job is to UNDERSTAND everything they sent and turn
it into ONE structured design brief our render pipeline can act on. Read closely —
customers write long, messy, contradictory notes and often put the real
instructions inside screenshots or drawn on a photo.

For EACH image, first decide what KIND it is:
- "reference_design": a wrap/design they want us to match or be inspired by.
- "customer_vehicle": their actual (often unwrapped) vehicle, sometimes with
  drawings/arrows/lines/handwriting marking WHERE design elements or cut lines go.
- "annotated_instruction": any image whose drawn marks/arrows/text ARE the
  instruction (e.g. a line across a fender showing the 3/4-wrap cut). Read the
  annotation and state the spatial instruction in words.
- "logo": a logo or brand mark to PLACE on the wrap as an editable overlay —
  NEVER treat a logo as the design to clone across the whole vehicle.
- "brand_asset": other brand graphics/icons to place.
- "color_swatch": a color/material reference.
- "screenshot_text": a screenshot of an email, chat, notes, or a form. OCR it —
  transcribe the readable text and treat it as typed instructions.
- "inspiration": loose mood/style reference, not a literal design to copy.
- "unknown": cannot tell.

Then MERGE every text source (order note, line-item brief, customer note, email
thread, prompt-history edits) with everything you read out of the images. Dedupe
repeated instructions. Resolve later prompt-history edits OVER earlier ones.

Then DECIDE the route:
- "recreate_exact": they uploaded a reference design and want it matched faithfully
  with NO changes.
- "recreate_edits": they uploaded a reference design to match BUT also asked for
  specific changes (coverage, cut lines, colors, swap/add text or logo, etc.).
- "recreate_inspired": a reference is a starting point but they want a NEW design
  in their colors/style (transform, don't clone).
- "designpro_create": no reference design to match — design from the written brief.
- "needs_info": not enough to design confidently; list precise questions.

Map intent: recreate_exact/recreate_edits -> visionboard_intent "exact_reference";
recreate_inspired -> "style_inspiration"; designpro_create/needs_info -> null.

Build "edit_list" as DISCRETE, actionable changes (one per item) — this is what
makes a recreate-with-edits job come out right. Capture coverage (full vs 3/4 vs
partial and which panels stay bare), cut-line geometry, color shifts (including
colors to AVOID), text to place, and whether a logo is pending (e.g. "I'll email
the logo"). Keep a logo as a placement overlay, separate from the base design.

Return ONLY JSON matching this shape (no prose, no markdown):
{
  "route": "recreate_exact|recreate_edits|recreate_inspired|designpro_create|needs_info",
  "visionboard_intent": "exact_reference|style_inspiration|null",
  "confidence": 0.0,
  "summary": "one tight paragraph a designer could act on",
  "base_design": "the look to clone/achieve, in render-ready language",
  "coverage": { "type": "full|three_quarter|partial|unspecified",
                "excluded_panels": [], "notes": "" },
  "edit_list": [ { "change": "", "type": "color|coverage|cutline|text|logo|graphic|finish|other",
                   "target": "panel/zone", "source": "where you read this" } ],
  "branding": { "text_to_place": [], "logo_pending": false,
                "logo_asset_refs": [], "placement_notes": "" },
  "colors": { "base": [], "accent": [], "avoid": [] },
  "finish": "gloss|matte|satin|chrome|null",
  "assets": [ { "ref": "label or url tail", "kind": "reference_design|customer_vehicle|annotated_instruction|logo|brand_asset|color_swatch|screenshot_text|inspiration|unknown",
                "role": "how it should be used",
                "extracted_text": "OCR'd text if any",
                "extracted_instruction": "spatial/design instruction if annotated" } ],
  "clarifying_questions": []
}`;

function buildContextText(text: IntakeText, vehicle?: IntakeRequest["vehicle"], imageLabels: string[] = []): string {
  const lines: string[] = [];
  if (vehicle && (vehicle.year || vehicle.make || vehicle.model)) {
    lines.push(`VEHICLE: ${[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ")}`);
  }
  if (text.lineItemBrief?.trim()) lines.push(`LINE-ITEM BRIEF:\n${text.lineItemBrief.trim()}`);
  if (text.orderNote?.trim()) lines.push(`CHECKOUT / ORDER NOTE:\n${text.orderNote.trim()}`);
  if (text.customerNote?.trim()) lines.push(`CUSTOMER NOTE:\n${text.customerNote.trim()}`);
  if (text.emailThread?.trim()) lines.push(`EMAIL THREAD:\n${text.emailThread.trim()}`);
  if (Array.isArray(text.promptHistory) && text.promptHistory.length) {
    lines.push(
      "PROMPT HISTORY (oldest → newest; newer edits override older):\n" +
        text.promptHistory.map((p, i) => `  v${i + 1}: ${String(p).trim()}`).join("\n"),
    );
  }
  if (imageLabels.length) {
    lines.push(
      "UPLOADED IMAGES (in order, classify each):\n" +
        imageLabels.map((l, i) => `  [image ${i + 1}] ${l}`).join("\n"),
    );
  }
  if (lines.length === 0) lines.push("(no written instructions provided — rely on the images)");
  return lines.join("\n\n");
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  // Light auth: require SOME credential (forwarded user session or service role).
  // This is internal ApprovePro tooling, not a metered customer endpoint.
  if (!req.headers.get("authorization") && !req.headers.get("apikey")) {
    return jsonResponse({ error: "Authentication required" }, 401);
  }

  if (!hasGeminiKey()) return jsonResponse({ error: "AI API key not configured" }, 500);

  let body: IntakeRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const text: IntakeText = { ...(body.text || {}) };
  let vehicle = body.vehicle;
  const rawImages: RawImage[] = Array.isArray(body.images) ? [...body.images] : [];

  // ── If a proof_id is given, load the order's text + uploads from the DB ──
  if (body.proof_id) {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const db = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: proof } = await db
        .from("proof_approvals")
        .select("*")
        .eq("id", body.proof_id)
        .maybeSingle();
      if (proof) {
        const meta = (proof.metadata as any) || {};
        text.lineItemBrief = text.lineItemBrief || meta.line_item_brief || "";
        text.orderNote = text.orderNote || meta.order_customer_note || "";
        text.customerNote = text.customerNote || meta.customer_note || "";
        text.emailThread = text.emailThread || meta.email_thread || meta.inbox_text || "";
        if (!text.promptHistory && Array.isArray(meta.prompt_history)) {
          text.promptHistory = meta.prompt_history;
        }
        if (!vehicle) {
          vehicle = {
            year: proof.vehicle_year || undefined,
            make: proof.vehicle_make || undefined,
            model: proof.vehicle_model || undefined,
          };
        }
        const uploads: string[] = Array.isArray(meta.customer_uploads) ? meta.customer_uploads : [];
        for (const url of uploads) {
          if (rawImages.length >= MAX_IMAGES) break;
          rawImages.push({ url, label: String(url).split("/").pop() || "upload" });
        }
      }
    } catch (e) {
      console.warn("intake-understand: proof load failed (non-fatal):", (e as any)?.message || e);
    }
  }

  // ── Resolve images to inline base64 (cap + skip failures) ──
  const imageParts: Array<Record<string, unknown>> = [];
  const imageLabels: string[] = [];
  for (const img of rawImages.slice(0, MAX_IMAGES)) {
    let resolved: { base64: string; mimeType: string } | null = null;
    if (img.base64 && img.mimeType) {
      resolved = { base64: img.base64, mimeType: img.mimeType };
    } else if (img.url) {
      resolved = await fetchImageAsBase64(img.url);
    }
    if (resolved) {
      imageParts.push({ inlineData: { mimeType: resolved.mimeType, data: resolved.base64 } });
      imageLabels.push(img.label || img.url || `upload ${imageLabels.length + 1}`);
    }
  }

  const contextText = buildContextText(text, vehicle, imageLabels);
  const parts: Array<Record<string, unknown>> = [
    { text: SYSTEM_PROMPT },
    { text: `\n\n=== ORDER CONTEXT ===\n${contextText}` },
    ...imageParts,
  ];

  let resp: Response;
  try {
    resp = await fetch(`${GEMINI_ENDPOINT}?key=${getGeminiKey()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
          maxOutputTokens: 4096,
        },
      }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
  } catch (e) {
    console.error("intake-understand: gemini fetch failed:", (e as any)?.message || e);
    return jsonResponse({ error: "AI understanding call failed (network/timeout)" }, 502);
  }

  if (!resp.ok) {
    const errText = (await resp.text()).slice(0, 400);
    console.error("intake-understand: gemini error", resp.status, errText);
    return jsonResponse({ error: `AI understanding failed (${resp.status})`, detail: errText }, 502);
  }

  const data = await resp.json().catch(() => ({}));
  const partsOut = data?.candidates?.[0]?.content?.parts;
  let rawJson = "";
  if (Array.isArray(partsOut)) {
    for (const p of partsOut) {
      if (p?.text) { rawJson += p.text; }
    }
  }
  rawJson = rawJson.trim();

  let understanding: any = null;
  try {
    understanding = JSON.parse(rawJson);
  } catch {
    // Salvage a JSON object if the model wrapped it in stray text/markdown.
    const start = rawJson.indexOf("{");
    const end = rawJson.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { understanding = JSON.parse(rawJson.slice(start, end + 1)); } catch { /* fall through */ }
    }
  }

  if (!understanding || typeof understanding !== "object") {
    console.error("intake-understand: unparseable model output", rawJson.slice(0, 300));
    return jsonResponse({ error: "AI returned an unparseable result", raw: rawJson.slice(0, 500) }, 502);
  }

  return jsonResponse({
    ok: true,
    understanding,
    model: MODEL,
    asset_count: imageParts.length,
    proof_id: body.proof_id || null,
  });
});
