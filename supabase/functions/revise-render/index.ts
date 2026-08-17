/**
 * ════════════════════════════════════════════════════════════════════════
 *  MASTER EDITOR — GOLDEN CONFIG  (RevisionIQ)
 *  Spec: docs/REVISION_IQ_MASTER_EDITOR.md
 *
 *  This is the AI revision brain. It is engineered to behave like a master
 *  vehicle-wrap designer: forward the customer's exact words, execute the
 *  FULL multi-part request, understand vehicle + coverage vocabulary, honor
 *  reference examples and hand-drawn marks, and report back what it changed —
 *  while locking ONLY the camera, the vehicle itself, and anything the request
 *  doesn't mention.
 *
 *  ⚠️ The "Remove elements" tool is SEPARATE and works perfectly — DO NOT
 *  touch it from here. Removal/heal/lift runs through precise-erase,
 *  segment-click, revise-render-masked, and LayerLift. This file does not.
 *
 *  Internal function name stays "revise-render" so the frontend keeps calling
 *  it. The LABEL is the Master Editor Golden Config.
 * ════════════════════════════════════════════════════════════════════════
 *
 * revise-render — Dedicated image-editing edge function for RevisionStudioIQ
 *
 * Gemini single-turn image editing:
 *  1. Image-first: reference image leads the user turn, edit instruction follows
 *  2. Pro model (gemini-3-pro-image-preview) for precision, Flash fallback
 *  3. responseModalities: ["TEXT", "IMAGE"] (TEXT required to avoid NO_IMAGE failures)
 *  4. Short, focused [EDIT] prompt via buildCondensedRevisionPrompt()
 *  5. One edit per turn for best precision
 *
 * NOTE: Multi-turn (model turn with image) requires thought_signature from the
 * original generation session. Since our images come from separate API calls,
 * we use single-turn with the image in the user turn.
 */

export const maxDuration = 60;

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// Native Deno.serve — avoids a deno.land bundle-time import that was timing out
// on Supabase's edge bundler and blocking deploys.
const serve = (handler: (req: Request) => Response | Promise<Response>) => Deno.serve(handler);
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";
import { tokenGate, refundToken } from "../_shared/token-gate.ts";
import {
  buildCondensedRevisionPrompt,
  buildLogoPlacementPrompt,
} from "../_shared/revision-prompt-engine.ts";
import { amplifyRevisionPrompt } from "../_shared/revision-prompt-amplifier.ts";
import { verifyRevisionChanged } from "../_shared/revision-change-verifier.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fetch an image URL and return base64 + mimeType */
async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Deno/1.0" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status} ${res.statusText}`);

  const contentType = res.headers.get("content-type") || "image/png";
  const buf = await res.arrayBuffer();
  const uint8 = new Uint8Array(buf);

  // Chunked base64 conversion (8 KB chunks to avoid stack overflow)
  let bin = "";
  const chunkSize = 8192;
  for (let i = 0; i < uint8.length; i += chunkSize) {
    const chunk = uint8.subarray(i, Math.min(i + chunkSize, uint8.length));
    bin += String.fromCharCode.apply(null, Array.from(chunk));
  }

  return { data: btoa(bin), mimeType: contentType };
}

/** Upload a base64 image to Supabase Storage and return the public URL */
async function uploadToStorage(
  supabase: any,
  base64: string,
  mimeType: string,
  userId: string,
  toolType: string,
): Promise<string> {
  const ext = mimeType.includes("png") ? "png" : "jpg";
  const timestamp = Date.now();
  const fileName = `renders/${userId}/revisions/${toolType}_${timestamp}.${ext}`;

  const binaryStr = atob(base64);
  const imageData = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    imageData[i] = binaryStr.charCodeAt(i);
  }

  const { error: uploadError } = await supabase.storage
    .from("wrap-files")
    .upload(fileName, imageData, { contentType: mimeType, upsert: true });

  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

  const { data: { publicUrl } } = supabase.storage
    .from("wrap-files")
    .getPublicUrl(fileName);

  return publicUrl;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Token gate — 1 token per AI revision (renders + revisions both burn tokens).
  const gate = await tokenGate(req, { reason: "revision_studio_iq" });
  if (!gate.ok) return gate.response!;
  // If we deduct from the tokens path and the render later fails, refund the
  // token so the user isn't billed for a Gemini error. Subscription/privileged
  // sources don't burn a fungible balance so refunding is a no-op there.
  const gateUserId = gate.userId || "";
  const gateSource = gate.source || "tokens";
  const refundIfPaid = async (reason: string) => {
    if (gateUserId && gateSource === "tokens") {
      await refundToken(gateUserId, 1, `revise_render_${reason}`);
    }
  };

  try {
    // ---- Auth ----
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!authHeader || authHeader === "Bearer") {
      console.error("[revise-render] No Authorization header received");
      return new Response(
        JSON.stringify({ code: "AUTH_ERROR", message: "No authorization token provided" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);
    if (authError || !user) {
      const reason = authError?.message || "user not found";
      console.error(`[revise-render] Auth failed: ${reason} | token prefix: ${token.substring(0, 20)}...`);
      return new Response(
        JSON.stringify({ code: "AUTH_ERROR", message: `Not authenticated: ${reason}` }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ---- Parse body ----
    const body = await req.json();
    const {
      originalRenderUrl,
      revisionPrompt,
      toolType = "colorpro",
      viewType = "side",
      vehicleYear,
      vehicleMake,
      vehicleModel,
      originalPrompt,
      // previousRevisions: intentionally ignored. Passing prior-version prompts
      // to Gemini caused cross-view token pollution (e.g. front-view text "OPTIMIZE
      // HUMANS" was bleeding onto rear-bumper revisions). Gemini can SEE the
      // attached image — it does not need textual edit history. Field accepted
      // for backward compatibility but dropped before it reaches the model.
      visionBoardImageUrls,
      siblingViewUrls,
      rawPrompt = false,
      mode,
      logoLayerCount = 0,
      // Set by the frontend when the customer uploaded an example image FOR
      // this revision ("Upload example / supporting edit"). Forces the
      // reference to attach even if the typed words don't say "like this".
      forceReferenceMatch = false,
    } = body;

    if (!originalRenderUrl) {
      return new Response(
        JSON.stringify({ code: "MISSING_PARAM", message: "originalRenderUrl is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!revisionPrompt) {
      return new Response(
        JSON.stringify({ code: "MISSING_PARAM", message: "revisionPrompt is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!hasGeminiKey()) {
      await refundIfPaid("no_api_key");
      return new Response(
        JSON.stringify({ code: "SYSTEM_ERROR", message: "API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ---- Fetch the original render image ----
    // For image editing, send ONLY the target image + edit instruction.
    // Sending sibling/VisionBoard images confuses Gemini about which image to edit
    // and biases it toward preservation over modification.
    console.log(`[revise-render] Fetching original render image...`);
    const originalImage = await fetchImageAsBase64(originalRenderUrl);
    console.log(`[revise-render] Image loaded: ${(originalImage.data.length / 1024).toFixed(0)} KB`);

    // ---- Amplify the customer's request (intent-preserving) ----
    // Turn a vague/stylistic ask ("make the guns look more like a photograph")
    // into a concrete, localized edit the model will actually execute — while
    // keeping every word/idea the customer wrote. Self-gating (a concrete
    // "work order" prompt comes back ~unchanged) and FAIL-OPEN (any error
    // returns the original). Skipped for the raw/logo-placement special modes,
    // which already carry their own engineered prompts. `customerRequest` is
    // the customer's ORIGINAL wording, kept for the honesty verifier + history.
    const customerRequest = revisionPrompt;
    let effectiveRevisionPrompt = revisionPrompt;
    if (!rawPrompt && mode !== "logo-placement") {
      const amp = await amplifyRevisionPrompt(revisionPrompt, { toolType, viewType });
      effectiveRevisionPrompt = amp.amplified;
    }

    // ---- Build prompt ----
    // rawPrompt=true: skip the heavy revision prompt engine (used for mirror text-fix)
    // mode="logo-placement": use the logo blending prompt (composite already includes the logos at marked positions)
    let fullPrompt: string;
    if (rawPrompt) {
      fullPrompt = revisionPrompt;
      console.log(`[revise-render] Using raw prompt (mirror text-fix mode)`);
    } else if (mode === "logo-placement") {
      fullPrompt = buildLogoPlacementPrompt({
        userNotes: revisionPrompt,
        layerCount: Number(logoLayerCount) || 1,
        currentViewType: viewType,
      });
      console.log(`[revise-render] Logo placement mode | layerCount=${logoLayerCount}`);
    } else {
      // NOTE: We intentionally do NOT pass previousRevisions or originalPrompt
      // text into the model. Gemini has the current image attached — textual
      // history of past edits causes prompt bleed across views (see comment at
      // parse body above). The condensed prompt's SCOPE LOCK handles
      // preservation through the image, not through words.
      fullPrompt = buildCondensedRevisionPrompt({
        revisionPrompt: effectiveRevisionPrompt,
        toolType: toolType as any,
        currentViewType: viewType,
        originalPrompt: originalPrompt || null,
      });
    }
    // CRITICAL: lock the framing to the ATTACHED image — NOT to the verbose
    // view-angles GENERATION spec. Injecting that spec ("fill 85% of the frame",
    // "minimize floor", "vehicle faces left", etc.) made the model RE-FRAME and
    // RE-RENDER the photo instead of editing the design — the readback literally
    // reported "tightened framing to maximize body fill" while leaving the wrap
    // unchanged ("it's not making the edits"). On an edit we already HAVE the
    // framing; we only need it kept identical so the model spends its effort on
    // the actual design changes.
    fullPrompt += `\n\nKEEP THE FRAMING IDENTICAL: match the attached image's exact camera angle, zoom, crop, distance, and vehicle position. Do not re-frame, zoom, reposition, or recompose the shot. This is an EDIT of the attached photo — apply the design changes requested above directly onto it.`;

    // REPOSITION EDITS — the single hardest thing for an image model. When the
    // request is to MOVE/relocate an element (logo, wordmark, badge, stripe) —
    // e.g. "move the SD up so it's not cut off by the wheel well" — the model
    // tends to redraw it in the SAME place and the customer sees "it ignored my
    // note". Detect that intent and give an explicit, forceful reposition order so
    // the move actually happens and the vacated spot is cleanly filled.
    const isRepositionEdit =
      /\b(move|moved|moving|raise|raised|lift|lifted|shift|shifted|nudge|nudged|reposition|relocate|lower|lowered|scoot|bump|slide|push|pull|higher|further\s+up|further\s+down)\b/i.test(revisionPrompt) ||
      /\bnot\s+(get\s+|be\s+|to\s+be\s+)?cut\s*-?\s*off\b/i.test(revisionPrompt) ||
      /\b(clear(s|ing)?\s+(of|the|from)|off\s+the\s+wheel|above\s+the\s+wheel|out\s+of\s+the\s+wheel)\b/i.test(revisionPrompt);
    if (isRepositionEdit) {
      fullPrompt += `\n\nTHIS IS A REPOSITION EDIT AND IT IS THE ONLY CHANGE TO MAKE. Physically MOVE the exact element named in the request to the new location it describes (e.g. up / higher, onto the clear painted panel so it FULLY clears the wheel arch, wheel well, and body edges). Keep that element's identical artwork, lettering, proportions, colors, and angle — ONLY its position changes; do not redraw or restyle it. Seamlessly fill the area it moved OUT of with the surrounding wrap pattern and background so there is NO ghost, gap, outline, or duplicate left behind. Leave every other part of the image pixel-identical. The moved element MUST end up complete and fully visible on a clear panel — if it is still clipped, the edit has failed.`;
    }

    // ---- Reference images (Fix: reuse the REAL logo, don't invent one) ------
    // By default we send only the target image — sending extra images biases
    // Gemini toward preservation and confuses "which image do I edit". But when
    // the user asks to ADD or COPY an asset ("add the logo", "same logo that's
    // on the side", "put the Wildcats badge on the rear"), the model has no
    // picture of that asset and hallucinates a random one. In that specific
    // case we attach the other view(s) as labeled reference-only images so it
    // reproduces the actual logo/text. Color/finish/remove edits are unaffected.
    const referenceParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
    let referenceClause = "";
    const wantsAssetReuse =
      !rawPrompt &&
      mode !== "logo-placement" &&
      /\b(add|put|place|insert|bring back|re-?add|copy|same|matching|reuse|like the|from the)\b/i.test(revisionPrompt) &&
      /\b(logo|logos|badge|emblem|crest|mascot|text|lettering|name|decal|graphic|sticker|sponsor|number)\b/i.test(revisionPrompt);

    // The customer pointed at an example/proof they want matched. Phrases like
    // "doesn't look like the example I gave", "he wanted ...", "match the proof",
    // "like I showed you", or "make it look exactly like this picture" mean the
    // uploaded reference (VisionBoard) IS the source of truth — but the old code
    // only attached references for explicit "add the logo" requests, so the
    // model never saw the example and the customer kept getting "that's not what
    // I asked for" (and re-generating from scratch instead of revising). Now we
    // attach it. Broadened to catch "look exactly/just like", a direct pointer
    // to "this/the picture|image|photo|render|mockup", and "match this/that".
    const wantsReferenceMatch =
      !rawPrompt &&
      mode !== "logo-placement" &&
      (
        forceReferenceMatch ||
        /\b(example|reference|the proof|supposed to|he wanted|she wanted|they wanted|customer wants?|as shown|look(s|ed|ing)?[\w\s]{0,15}like|doesn'?t look|like i (showed|sent|gave|provided|attached)|like the (one|example|proof|image|design|picture|reference)|match(es|ing|ed)? (this|that|the (picture|image|photo|reference|example|proof|design))|(this|that) (picture|image|photo|reference|example|mock-?up)|drew|drawn|draw|marked|the (yellow |red |drawn )?line|cut(s)? off|lay(s)? on|where it (needs|should|cuts|ends|stops|lays|goes))\b/i.test(revisionPrompt)
      );

    if (wantsAssetReuse || wantsReferenceMatch) {
      // For a reference-match request the customer's uploaded example
      // (VisionBoard) is the most important image; for asset-reuse the sibling
      // views carry the real logo/text. Order the sources accordingly.
      const vbUrls = Array.isArray(visionBoardImageUrls) ? visionBoardImageUrls : [];
      const sibUrls = Array.isArray(siblingViewUrls) ? siblingViewUrls : [];
      // Defensive: a caller may still send a VisionBoard ref as an object
      // ({ slotLabel, storageUrl }) or a JSON-stringified version of it rather
      // than a plain URL. Those slipped past the old string filter (the JSON
      // string IS a string) and then threw "Invalid URL" in fetchImageAsBase64,
      // silently dropping the reference. Unwrap to the underlying URL here.
      const toUrl = (u: unknown): string | null => {
        if (!u) return null;
        if (typeof u === "object") {
          const o = u as Record<string, unknown>;
          return (o.storageUrl as string) || (o.url as string) || null;
        }
        if (typeof u === "string") {
          const s = u.trim();
          if (s.startsWith("{") && (s.includes("storageUrl") || s.includes("url"))) {
            try {
              const o = JSON.parse(s);
              return o?.storageUrl || o?.url || null;
            } catch { return null; }
          }
          return /^https?:\/\//i.test(s) ? s : null;
        }
        return null;
      };
      const refUrls = (wantsReferenceMatch ? [...vbUrls, ...sibUrls] : [...sibUrls, ...vbUrls])
        .map(toUrl)
        .filter((u): u is string => !!u && u !== originalRenderUrl)
        .slice(0, 2); // cap to keep payload + latency sane

      for (const url of refUrls) {
        try {
          const ref = await fetchImageAsBase64(url);
          referenceParts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
        } catch (e) {
          console.warn(`[revise-render] reference image skipped (${url.substring(0, 60)}): ${e instanceof Error ? e.message : e}`);
        }
      }

      if (referenceParts.length > 0) {
        if (wantsReferenceMatch) {
          referenceClause =
            `\n\nREFERENCE IMAGES: Image 1 is the ONLY image you edit and output. ` +
            `The ${referenceParts.length === 1 ? "following image is the customer's reference example" : "following images are the customer's reference examples"} showing how the design should look. ` +
            `Use the reference to guide the requested changes — match its design style, colors, layout, logo placement, and coverage where the change request calls for it — while keeping Image 1's exact vehicle, camera angle, framing, and any element the request does not mention. ` +
            `IMPORTANT: a reference may include hand-drawn lines, arrows, circles, or other markings (e.g. a yellow or red line) that show EXACTLY where the wrap should cut off, end, transition, or how it should lay across a panel. Treat those drawn marks as precise design instructions for the wrap's edges, angles, and placement — follow them literally. Do NOT copy the drawn lines themselves into the result; produce a clean, photorealistic wrap whose edges land exactly where the marks indicate. Output only the edited Image 1.`;
          console.log(`[revise-render] Reference-match mode: attached ${referenceParts.length} reference image(s)`);
        } else {
          referenceClause =
            `\n\nREFERENCE IMAGES: Image 1 is the ONLY image you edit and output. ` +
            `The ${referenceParts.length === 1 ? "next image is another view" : "next images are other views"} of the SAME vehicle, provided ONLY as a visual reference. ` +
            `When the instruction asks to add/copy a logo, badge, text, or graphic, reproduce it EXACTLY as it appears in the reference — same artwork, colors, and proportions. Do NOT invent a new design. Do NOT otherwise alter the reference scenes; output only the edited Image 1.`;
          console.log(`[revise-render] Asset-reuse mode: attached ${referenceParts.length} reference image(s)`);
        }
      }
    }

    if (referenceClause) fullPrompt += referenceClause;

    // Ask the model to briefly report the edits it applied, so the UI can show
    // the customer a plain-English "here's what I changed" confirmation — like a
    // designer reading back the work order. The TEXT modality is already enabled
    // (responseModalities: ["TEXT","IMAGE"]); we just capture what it returns.
    if (!rawPrompt) {
      fullPrompt += `\n\nBefore the image, output a short plain-English list of the specific changes you applied for THIS revision — 1 to 4 lines, each starting with "- ". Be factual and brief (name the panel/area and what changed). Then output the edited image.`;
    }

    console.log(`[revise-render] Prompt length: ${fullPrompt.length} chars | Tool: ${toolType} | View: ${viewType} | refs: ${referenceParts.length}`);

    // ---- Build single-turn contents for Gemini image editing ----
    // Image-first: target image leads, then any reference images, then the
    // edit instruction. Single target keeps edit precision; references are
    // only present in asset-reuse mode (see above).
    const userParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { inlineData: { mimeType: originalImage.mimeType, data: originalImage.data } },
      ...referenceParts,
      { text: fullPrompt },
    ];

    const contents = [{ role: "user", parts: userParts }];

    // System instruction primes Gemini as a surgical image editor (not a generator).
    // Two absolute rules:
    //  1. SCOPE — only modify what the user explicitly asked for. Every other
    //     pixel of the image must remain visually identical to the input.
    //     Previously-added text, logos, and decals from earlier edits stay put
    //     unless the current instruction explicitly references them.
    //  2. CAMERA — camera angle, framing, and perspective must match the input.
    const systemInstruction = {
      parts: [{ text: "You are a master vehicle-wrap designer revising the attached wrap proof. Read the user's full request and EXECUTE EVERY change they ask for the way an experienced designer would — including substantial ones: recoloring zones, changing where the wrap covers or stops, removing the wrap from a panel, resizing or repositioning graphics and logos, and following hand-drawn lines/marks on any reference image that show where the wrap should cut off or how it should lay. Do the complete request, not just the first part. ABSOLUTE RULE 1 (PRESERVE THE UNMENTIONED): Any design element the user does NOT mention — other panels, colors, finishes, existing text, logos, graphics, the background — stays exactly as it is in the input. Change what they asked for; leave the rest untouched. ABSOLUTE RULE 2 (CAMERA + VEHICLE): Keep the EXACT camera angle, perspective, framing, and field of view, and the vehicle's make/model, body shape, panels, windows, wheels, and proportions identical to the input. Never rotate, tilt, or change the viewing angle or the vehicle itself. Return the edited image." }],
    };

    // 2-tier fallback with a fast retry on the reliable Flash tier. The #1
    // observed failure is Gemini returning NO_IMAGE on a surgical 4K edit of a
    // complex baked hero → BOTH tiers miss → 422. Flash 2K is fast (~19s) and
    // reliable, so a second Flash attempt rescues transient NO_IMAGE without
    // blowing the gateway budget. Per-tier timeouts keep the worst case (~135s)
    // under the ~150s gateway limit. NOTE: same two models as before — no NEW
    // fallback model is introduced (the model lock is respected).
    // RESOLUTION LOCK: keep edits at 4K. Previously the fallbacks dropped to
    // Flash **2K**, so any edit that missed the Pro-4K tier (e.g. a complex edit
    // like adding a star field to a busy flag) silently came back at half
    // resolution and softer — and every print file downstream inherited that
    // softness ("can't get resolution since the customer edited it"). Retry Pro
    // 4K first, then Flash at 4K; only the very last resort is 2K so a genuine
    // hard failure still returns *something* rather than erroring.
    const tiers = [
      { model: "gemini-3-pro-image-preview", imageSize: "4K", label: "Pro", timeoutMs: 45_000 },
      { model: "gemini-3-pro-image-preview", imageSize: "4K", label: "Pro-retry", timeoutMs: 45_000 },
      { model: "gemini-3.1-flash-image-preview", imageSize: "4K", label: "Flash-4K", timeoutMs: 45_000 },
      { model: "gemini-3.1-flash-image-preview", imageSize: "2K", label: "Flash-2K-lastresort", timeoutMs: 40_000 },
    ];

    let imageBase64: string | null = null;
    let imageMimeType = "image/png";
    let editSummary = "";
    let lastError = "";

    for (const tier of tiers) {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${tier.model}:generateContent?key=${getGeminiKey()}`;

      console.log(`[revise-render] Attempting ${tier.label} (${tier.model}), imageSize=${tier.imageSize}`);

      try {
        const response = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction,
            contents,
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
              imageConfig: {
                aspectRatio: "16:9",
                imageSize: tier.imageSize,
              },
            },
          }),
          signal: AbortSignal.timeout(tier.timeoutMs),
        });

        if (!response.ok) {
          const errText = await response.text();
          lastError = `${tier.label} HTTP ${response.status}: ${errText.substring(0, 200)}`;
          console.error(`[revise-render] ${lastError}`);
          continue;
        }

        const result = await response.json();
        const finishReason = result.candidates?.[0]?.finishReason;

        if (finishReason === "NO_IMAGE") {
          lastError = `${tier.label}: NO_IMAGE — Gemini chose text over image`;
          console.warn(`[revise-render] ${lastError}`);
          continue;
        }

        if (finishReason && finishReason !== "STOP") {
          lastError = `${tier.label}: finishReason=${finishReason}`;
          console.warn(`[revise-render] ${lastError}`);
          continue;
        }

        const responseParts = result.candidates?.[0]?.content?.parts || [];
        let tierSummary = "";
        for (const part of responseParts) {
          if (part.inlineData && !imageBase64) {
            imageBase64 = part.inlineData.data;
            imageMimeType = part.inlineData.mimeType || "image/png";
          } else if (part.text) {
            tierSummary += part.text;
          }
        }

        if (imageBase64) {
          editSummary = tierSummary.trim();
          console.log(`[revise-render] ✅ Success with ${tier.label}${editSummary ? ` | summary: ${editSummary.substring(0, 80)}` : ""}`);
          break;
        } else {
          lastError = `${tier.label}: No image in response parts`;
          console.warn(`[revise-render] ${lastError}`);
        }
      } catch (err) {
        lastError = `${tier.label}: ${err instanceof Error ? err.message : String(err)}`;
        console.error(`[revise-render] ${lastError}`);
      }
    }

    if (!imageBase64) {
      // Refund the token — the user paid but Gemini didn't return an image.
      await refundIfPaid("gemini_no_image");
      return new Response(
        JSON.stringify({
          code: "RENDER_FAILED",
          message: `The AI couldn't produce that revision (Gemini error). Your token was refunded — try a shorter or different prompt. Detail: ${lastError}`,
          refunded: gateSource === "tokens",
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ---- Honesty guard: did the edit VISIBLY change the image? ----
    // Edit models sometimes return a near-identical image while the text
    // summary confidently claims edits were made — so the customer is told a
    // revision happened when nothing moved. Rather than ship that lie, compare
    // BEFORE (source) vs AFTER (this result) against the customer's request. If
    // nothing visibly changed, refund and return NO_VISIBLE_CHANGE so the UI is
    // honest instead of showing a fake "here's what I changed". FAIL-OPEN: the
    // verifier returns changed=true on any uncertainty, so it can never suppress
    // a real edit. Only the standard edit path — raw/logo-placement modes carry
    // their own semantics and are exempt.
    if (!rawPrompt && mode !== "logo-placement") {
      const verdict = await verifyRevisionChanged(originalRenderUrl, imageBase64, imageMimeType, customerRequest);
      if (!verdict.changed) {
        console.warn(`[revise-render] NO_VISIBLE_CHANGE — refusing to claim a revision. note="${verdict.note}"`);
        await refundIfPaid("no_visible_change");
        return new Response(
          JSON.stringify({
            code: "NO_VISIBLE_CHANGE",
            message:
              `The AI didn't visibly change the design for "${customerRequest}", so no new version was saved and your token was refunded. ` +
              `Try a more specific, localized instruction (name the exact panel and change), or tap "Upload example / supporting edit" to attach a reference image to match.`,
            refunded: gateSource === "tokens",
          }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // ---- Upload to Supabase Storage ----
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    const renderUrl = await uploadToStorage(serviceClient, imageBase64, imageMimeType, user.id, toolType);

    console.log(`[revise-render] ✅ Uploaded: ${renderUrl.substring(0, 80)}...`);

    return new Response(
      JSON.stringify({
        renderUrl,
        editSummary: editSummary || undefined,
        amplifiedPrompt: effectiveRevisionPrompt !== customerRequest ? effectiveRevisionPrompt : undefined,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[revise-render] Unhandled error: ${message}`);
    // Refund the token if the render never completed — the user shouldn't
    // pay for an exception that came from our own code or a transient hiccup.
    await refundIfPaid("unhandled_error");
    return new Response(
      JSON.stringify({ code: "INTERNAL_ERROR", message, refunded: gateSource === "tokens" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
