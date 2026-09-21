/**
 * production-panel-proof — CALL 1 AS A FLAT PANEL PRODUCTION PROOF.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner ruling, Trish 2026-09-18: "Gemini image pro 3's newest model has no
 * issues generating text we need to rely on our custom design persona edge
 * functions and Gemini's own brain and test a flat panel production proof ...
 * it must be fed a real flat panel production proof and given the base prompt
 * system engineering so it knows its job on call 1 and has a clear example and
 * done with thought multi modal best practices."
 *
 * WHY A SEPARATE FUNCTION AND NOT A BRANCH IN design-panel-ai-generate.
 *
 * That function is the SOLE Call-1 network endpoint (RULE 0.26) and carries
 * three live modes. A new contract inside it is a new way for an edit to reach
 * atlas-artboard, which is what every customer generation runs through today.
 * A separate function cannot: production keeps calling the endpoint it always
 * called, byte for byte, whatever happens in here.
 *
 * THIS IS A PROBE SURFACE, NOT A PRODUCT PATH. Nothing routes to it. It writes
 * no revision, generation, view or artifact row. It returns the proof bytes and
 * its own provenance so the owner can look at the sheet before anything is
 * wired. That is the first rung of the same safety ladder RULE 0.35 describes
 * for the hero-driver cascade.
 *
 * WHAT IT IS TESTING, precisely, because the answer decides real architecture:
 *
 *   1. Does asking for the OBJECT the model draws well -- a panel production
 *      proof, the document a print shop receives -- produce six full-bleed
 *      panels instead of the die-cut layout drawing every previous contract
 *      got? Every documented Call-1 experiment changed the ASK and kept the
 *      object a bare artboard; RULE 0.38's canary table says the artwork was
 *      right and the object was wrong.
 *   2. Can gemini-3-pro-image be trusted with the customer's exact strings?
 *      The element graph exists because RestylePro measured a proof reading
 *      877-555-0000 / stanewerks.com against a hero reading 555-0142 /
 *      cascadestoneworks.com. If that premise has expired, mechanical
 *      typesetting is solving a problem that no longer exists -- and the
 *      composited slab it produces measured 1.95:1 contrast on 34613569.
 *   3. Does ONE designer producing branded + artwork-only + cut proof in one
 *      pass give the cohesion no compositor can?
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders as baseCorsHeaders } from "../_shared/cors.ts";
import { RELEASE_SOURCE_SHA } from "../_shared/release-source.ts";
const corsHeaders = { ...baseCorsHeaders, "X-DesignPro-Source-Sha": RELEASE_SOURCE_SHA,
  "Access-Control-Expose-Headers": "X-DesignPro-Source-Sha" };
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";
import { PRIMARY_IMAGE_MODEL, geminiImageUrl } from "../_shared/model-config.ts";
import { resolveDesignProInternalCaller } from "../_shared/designpro-internal-call.ts";
import {
  ATLAS_PANEL_PROOF_CONTRACT,
  PANEL_PROOF_CONTAINER_TEMPLATE,
  PANEL_PROOF_FORMAT_EXAMPLE,
  buildPanelProofPrompt,
  buildPanelProofTurns,
  panelProofCreativeHead,
} from "../_shared/atlas-panel-proof-prompt.ts";
import { parsePanelRows, stageProofContainer } from "../_shared/atlas-proof-container-render.ts";
/**
 * A.C.E. ITSELF — the real `buildDesignIQPrompt` out of the deployed
 * design-panel-ai-generate, sliced by scripts/build-designiq-shared.mjs and
 * locked against it by tests/designiq-shared-assembly.test.mjs.
 *
 * Owner ruling, Trish 2026-09-18: "Must use our suite of custom design edge
 * functions no fucking excuses!!!" This function used to carry a designer
 * paragraph I wrote and none of the proven persona — measured on the live
 * sheet at 3,906 prompt characters with roughly 40 of customer brief and ZERO
 * of A.C.E. That is why it returned generic blue waves and stock photography.
 */
import { buildDesignIQPrompt } from "../_shared/designiq-assembly.ts";
import { buildPrompt as buildTextLayerPrompt } from "../_shared/designpro-text-layer-prompt.ts";
import { authorProofLogo, proofLogoRequested } from "../_shared/atlas-proof-elements.mjs";
// THE PROVEN DURABLE-PROVIDER MODULE, not a second implementation of it
// (RULE 1). `design-panel-ai-generate` already routes every Call-1 image
// request through this; a bare fetch here is what made `cacheOnly` a no-op.
import {
  runDurableImageProviderRequest, authorizeAtlasProviderRequest,
  captureGeminiHttpExchange, providerSha256, GeminiProviderError,
} from "../_shared/gemini-provider-cache.mjs";
import {
  INTAKE_CONTRACT, INTAKE_MODEL, INTAKE_SCHEMA,
  extractDeterministic, intakePrompt, mergeIntake,
} from "../_shared/atlas-intake-parse.ts";

/**
 * NODE 0 — INTAKE. Raw customer text in, the structured schema out.
 *
 * Owner ruling, Trish 2026-09-18: "you shouldn't test it by giving it the same
 * design prompt as the example ... the pipeline must ingest raw, unstructured
 * customer natural language and dynamically parse it."
 *
 * The deterministic pass has already decided the phone, the web address and the
 * year/make/model before this runs, and it WINS on conflict — so the one field
 * class that must never be invented cannot be touched by a model. What this
 * call decides is only what no regular expression can: where a company name
 * ends, which words are services, which line is promotional, and which words
 * are the design brief.
 *
 * IT FAILS SOFT, on the WallPro consultant's rule: "no answer, bad JSON or a
 * timeout and the customer's own words go through unchanged". An intake reader
 * that is down must not cost a design — the raw message becomes the creative
 * direction and the deterministic fields still stand.
 */
async function parseCustomerIntake(text: string) {
  const deterministic = extractDeterministic(text);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${INTAKE_MODEL}:generateContent?key=${getGeminiKey()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: intakePrompt(text) }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: INTAKE_SCHEMA,
          },
        }),
      },
    );
    if (!response.ok) throw new Error(`intake_http_${response.status}`);
    const payload = await response.json();
    const raw = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    return { ...mergeIntake(deterministic, JSON.parse(String(raw || "{}"))), intakeRead: "ok" };
  } catch (error) {
    return {
      ...mergeIntake(deterministic, { creativeDirection: text }),
      intakeRead: `unavailable:${String((error as Error)?.message || error).slice(0, 80)}`,
    };
  }
}

const BUCKET = "wrap-files";

/**
 * The six named surfaces A.C.E.'s flat-master branch requires. It REFUSES a
 * missing or mismatched surface identity (asserted in
 * tests/designpro-persona-contract.test.mjs), which is why this is a constant
 * and not assembled from the request: a caller that sent five would get a throw
 * rather than a five-panel design.
 */
const ATLAS_PANELS = [
  { label: "DRIVER SIDE", surfaceId: "DS", placement: "right-flank" },
  { label: "PASSENGER SIDE", surfaceId: "PS", placement: "left-flank" },
  { label: "HOOD", surfaceId: "HD", placement: "center-column" },
  { label: "ROOF", surfaceId: "RF", placement: "center-column" },
  { label: "FRONT", surfaceId: "FR", placement: "center-column" },
  { label: "REAR", surfaceId: "RR", placement: "center-column" },
] as const;

/**
 * The two PINNED multimodal inputs. The container is a third attachment and
 * arrives as a reference instead -- see CALL1_INPUT_PATH below.
 *
 * THE SHEET IS THE STANDARD, NOT JUST THE FORMAT. This comment used to read
 * "FORMAT, NOT STYLE ... the prompt says in as many words that its artwork is
 * not a style reference". The owner corrected that on 2026-09-18 and the prompt
 * was changed to match; the comment was not, so it sat here contradicting the
 * text it describes. The layout AND the quality of the work on it are the bar.
 *
 * What survives of RULE 0.24's caution is narrower and about OWNERSHIP: the
 * identity on that sheet is Bright Smiles Dental's, and a customer's proof
 * carries only the strings in their own request. Canary 33389124918 is still
 * why the bytes are pinned at all -- a teaching input that silently changes
 * teaches something nobody chose.
 *
 * AND THE FORMAT EXAMPLE MUST SHOW THE FORMAT BEING ASKED FOR. It used to be
 * `panel-production-proof-example.png` -- the Arctic Air sheet, 874x717, which
 * carries ONE version. This contract asks for THREE, so the reference was
 * teaching a different document than the one requested: the same class of
 * defect, pointed the other way. The pinned sheet is 1536x1024 and shows every
 * block this contract names -- header job block and total coverage, then three
 * full-width ZONE bands (full design panels dimensioned / backgrounds only /
 * cut graphics), the panel dimensions reference row, template notes and guide
 * legend. It is the filled twin of the container template attached beside it.
 *
 * ⚠️ NO PHOTOGRAPH OF A VEHICLE IS ATTACHED. THIS IS A STANDING RULE, NOT A
 * PREFERENCE, AND IT WAS BROKEN HERE FOR ONE DAY.
 *
 * `atlas-examples/installer-one-panel-per-side.png` rode in this array as the
 * "physical reason a panel is one rectangle" -- a Wrap Institute still of an
 * installer laying vinyl over a car, in a workshop, with its own title text and
 * watermark. Live sheet 35402317471 answered it exactly: Zone 1 and Zone 2 came
 * back as PICTURES OF A VAN, wheels and windows and mirrors on the flanks, hood
 * and front drawn as body-part silhouettes, on a request whose words said SOLID
 * RECTANGLE and whose pinned example sheet shows six plain rectangles.
 *
 * RULE 0.0 names this failure and its cost: "An installed/3D vehicle proof is
 * not a Call-1 teaching input: production canary 33389124918 proved that the
 * finished-vehicle image OVERPOWERED the flat-source instructions and leaked
 * vehicle/template anatomy into the canonical rectangles." RULE 0.15 says the
 * same thing from the other side: the installed proof "was the strongest visual
 * instruction and reintroduced the anatomy that source rectangles must exclude."
 *
 * The physical fact is NOT lost -- INSTALLATION_FACT states it in words, which
 * is where it belongs. An image outranks a sentence, so an image of the thing
 * the sentence forbids drawing is the one attachment this request may never
 * carry. Owner ruling, 2026-09-18: "there shouldn't be any shapes, just the cut
 * logo shapes" -- Zones 1 and 2 are plain rectangles, and only Zone 3 holds
 * shapes.
 *
 * THE ORDER IS THE PROMPT'S ORDER, and it is load-bearing. The tail names the
 * attachments "in order: (1) the BLANK CONTAINER TEMPLATE ... (2) a FINISHED
 * PROOF", so reordering this array makes the text point at the wrong image.
 * Container first is deliberate: the empty structure, then a filled example of
 * that same structure. Both sheets are 1536x1024, which is also the request's
 * aspectRatio, so nothing has to be re-flowed to be read.
 */
const PINNED_INPUTS = [
  { path: PANEL_PROOF_FORMAT_EXAMPLE.path, role: "format", sha256: PANEL_PROOF_FORMAT_EXAMPLE.sha256 },
] as const;

/**
 * THE GOLD-STANDARD ARTBOARDS — WHAT "GOOD" LOOKS LIKE.
 *
 * On the separated-artwork route this function was sending the model a BLANK
 * container and TEXT, and nothing else. `PINNED_INPUTS` is skipped here, and
 * correctly so -- the compositor draws the three-zone document, not Gemini --
 * but that left Call 1 designing a commercial vehicle wrap with no exemplar of
 * one anywhere in the request.
 *
 * Live bbdd0db0 (2026-09-21) is what that produces: six cropped photographs of
 * a desert garden, no composition, no colour system, no integration of the
 * brand. The persona text can describe professionalism; it cannot show it.
 *
 * `runtime/flat-atlas-topology-examples.cjs#loadDesignPanelArtboardExamples`
 * has held this capability the whole time -- ported from
 * `_shared/artboard-template-os.ts#loadArtboardExamples` -- and was never
 * called by any production path, while the metadata reported a hardcoded 0.
 * Its contract is preserved exactly here: list ten, take at most the first two
 * supported images, skip anything over 8 MiB, and treat a missing or empty
 * prefix as non-fatal.
 *
 * IT READS THEM ITSELF, like the pinned sheet above, rather than taking them
 * on the request. That keeps RULE 0.24's classes apart by construction: these
 * can never arrive as `customerAssets`, so a quality reference can never
 * become CREATIVE authority and contribute artwork, palette or branding.
 *
 * The original bucket constant was the string "wrap-files flat panel", which
 * is not a bucket on this project and never has been -- a search phrase frozen
 * into a constant. These live under a prefix of the real Call-1 bucket.
 */
const ARTBOARD_QUALITY_PREFIX = "designpanel-artboard-examples/";
const ARTBOARD_QUALITY_MAX_BYTES = 8 * 1024 * 1024;
const ARTBOARD_QUALITY_MAX = 2;

/**
 * THIS FUNCTION DRAWS ITS OWN CONTAINER TEMPLATE. IT IS THE PANEL STUDIO.
 *
 * Owner, 2026-09-18, looking at a container that had been rendered elsewhere
 * and handed in: "Wrong this is wrong just use template wired as a studio edge
 * function."
 *
 * THE HISTORY, because it is two corrections deep and both matter.
 *
 * FIRST the container was PINNED BY HASH beside the format sheet. That was
 * wrong the moment it carried dimensions: the pinned PNG is drawn for the
 * Prius's 165.7" x 49.6" flanks, so an F250 request would have been shown a
 * template dimensioned for a car it is not. A hash pin proves the bytes are the
 * ones we pinned; it cannot prove they are the ones THIS request needs, and for
 * a derived artifact that is the only question worth asking.
 *
 * SECOND it was rendered on the droplet and crossed in as `{storagePath,
 * contentHash}`, on my claim that Deno could not draw it. That claim was wrong,
 * and narrowly so: *sharp* cannot run here, `@resvg/resvg-wasm` can, and the
 * drawing itself is string concatenation with no dependency at all. The cost of
 * the mistake was architectural rather than cosmetic — it meant the container
 * could only be produced by something carrying libvips, which excludes the
 * edge, which is where Call 1 lives (RULE 0.26). A teaching input the Call-1
 * endpoint cannot produce is a teaching input Call 1 cannot use.
 *
 * So `stageProofContainer` draws this request's six rectangles from the SAME
 * `panelRows` the prompt states them in, rasterises them here, and writes the
 * PNG to `atlas-call1-inputs/<sha256>.png`. One parse, one geometry, one sheet.
 *
 * THE INBOUND REFERENCE PATH IS KEPT, AND ONLY AS A FALLBACK. A caller may
 * still stage a container itself, and the three checks below are unchanged —
 * the same ones `attach()` runs on the hero view: the path must be
 * content-addressed under the Call-1 input prefix, the bytes must hash to the
 * filename, and they must hash to what the caller claimed. It is kept because
 * the wasm is fetched over the network on a cold isolate, and a probe that
 * cannot draw its own container should fall back to a verified one rather than
 * lose the image request. Which path ran is reported, never inferred.
 */
const CALL1_INPUT_PATH = /^atlas-call1-inputs\/[0-9a-f]{64}\.png$/;

/**
 * THE EDGE-SIDE INSPECTOR GATE: the sheet's SHAPE, read without decoding it.
 *
 * Owner: the gate must run before the payload reaches the UI, with no stubs.
 * This is the half of that which can honestly execute inside Deno.
 *
 * WHY NOT PIXEL VALIDATION HERE. A returned sheet is 5056x3392 -- 17.15 MP,
 * measured on d5314267 -- and decoding it with ImageScript costs roughly 69 MB
 * of RGBA before a single pixel is examined. This repo has a recorded 546 OOM
 * history with imagescript, and THIS function already died twice on a bodiless
 * 504 from a 2.2 MB base64 request. A gate that kills the worker rejects every
 * proof, including the good ones. Deno also cannot load sharp, which is why the
 * container is rendered on the runtime and crosses as a reference to begin with.
 *
 * So the per-panel pixel gate lives on the runtime beside sharp
 * (`runtime/atlas-proof-panel-locator.cjs`), and what runs HERE needs no decode:
 * both formats carry their dimensions in a header near the front of the file.
 *
 * ⚠️ THE MODEL RETURNS JPEG, NOT PNG, AND THIS FUNCTION HAS BEEN MISLABELLING
 * IT. The first version of this gate read the PNG IHDR at fixed offsets 16..23
 * and threw `panel_proof_sheet_not_png` on the real artifact -- which would have
 * refused EVERY proof the moment it deployed. The file is JFIF: the bytes begin
 * ff d8 ff e0, and `file` reports "JPEG image data ... 5056x3392". Meanwhile the
 * upload has always named it `.png` with `contentType: image/png`, so every
 * stored proof is a JPEG wearing a PNG label. sharp does not care; a browser
 * download, a RIP or anything trusting the extension does. Both are fixed here.
 *
 * WHAT IT ACTUALLY CATCHES, which is not nothing: a re-flowed sheet. Every
 * coordinate any downstream slicer uses is a FRACTION of the page, so a sheet
 * returned at a different aspect makes all of them point somewhere else. That
 * is the single failure mode which silently corrupts every later measurement,
 * and it is decidable from a handful of bytes.
 */
const SHEET_ASPECT = PANEL_PROOF_CONTAINER_TEMPLATE.width / PANEL_PROOF_CONTAINER_TEMPLATE.height;
const MAX_SHEET_ASPECT_DRIFT = 0.02;
const MIN_SHEET_MEGAPIXELS = 2;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNG keeps width/height in the IHDR chunk at fixed offsets 16..23. */
function readPngSize(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * JPEG keeps them in a start-of-frame segment, which is NOT at a fixed offset --
 * the encoder may write any number of APPn/DQT/DRI segments first, so the
 * segment chain has to be walked. SOF0..SOF15 are 0xC0..0xCF except 0xC4
 * (Huffman tables), 0xC8 (JPEG extension) and 0xCC (arithmetic conditioning),
 * which are not frame headers and must be skipped rather than parsed.
 */
function readJpegSize(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = view.getUint16(offset + 2);
    const isFrame = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error("panel_proof_sheet_no_jpeg_frame_header");
}

function readSheet(bytes: Uint8Array) {
  if (bytes.length > 24 && PNG_MAGIC.every((b, i) => bytes[i] === b)) {
    return { format: "png" as const, extension: "png", mime: "image/png", ...readPngSize(bytes) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return { format: "jpeg" as const, extension: "jpg", mime: "image/jpeg", ...readJpegSize(bytes) };
  }
  throw new Error("panel_proof_sheet_unrecognised_format");
}

function assertProofSheetShape(bytes: Uint8Array) {
  const sheet = readSheet(bytes);
  const megapixels = (sheet.width * sheet.height) / 1e6;
  if (!Number.isFinite(sheet.width) || !Number.isFinite(sheet.height)
    || sheet.width < 1 || sheet.height < 1) {
    throw new Error(`panel_proof_sheet_shape_invalid:${sheet.width}x${sheet.height}`);
  }
  if (megapixels < MIN_SHEET_MEGAPIXELS) {
    throw new Error(`panel_proof_sheet_too_small:${megapixels.toFixed(2)}MP`);
  }
  const aspect = sheet.width / sheet.height;
  if (Math.abs(aspect - SHEET_ASPECT) / SHEET_ASPECT > MAX_SHEET_ASPECT_DRIFT) {
    throw new Error(`panel_proof_sheet_reflowed:${aspect.toFixed(3)}!=${SHEET_ASPECT.toFixed(3)}`);
  }
  return { ...sheet, megapixels: Number(megapixels.toFixed(2)), aspect: Number(aspect.toFixed(3)) };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const sha256Hex = async (bytes: Uint8Array) => {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const svc = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // INTERNAL ONLY. This spends a real image request against the production
  // project; it is not reachable by a customer session.
  //
  // ONE ARGUMENT. The resolver takes the Request alone and builds its own admin
  // client from the caller's `apikey` header -- that IS the privilege check (a
  // publishable key cannot resolve a user by id). Handing it `svc` would have
  // been a TypeScript arity error, so the deploy would have failed at
  // type-check; every other call site in this project passes `req` only.
  const caller = await resolveDesignProInternalCaller(req);
  if (caller.rejection) return caller.rejection;
  if (!caller.internal || !caller.userId) {
    return json({ error: "production_panel_proof_internal_only" }, 403);
  }
  if (!hasGeminiKey()) return json({ error: "production_panel_proof_no_key" }, 503);

  // Reassigned by `runDurableImageProviderRequest` to the claim's own output
  // id, so a recovered attempt reports the request it is recovering rather
  // than a fresh one. A new uuid per invocation is exactly what made the
  // recovery contract unobservable.
  let requestId = crypto.randomUUID();
  try {
    const body = await req.json();

    // NODE 0 RUNS FIRST, and only when the caller sent raw text. A caller that
    // already holds structured fields — the real order form, once it exists —
    // skips it and spends nothing, which is why this is a branch and not a
    // stage every request pays for.
    const customerPrompt = String(body?.customerPrompt || "").trim();
    const intake = customerPrompt ? await parseCustomerIntake(customerPrompt) : null;
    // THE EXPLICIT FIELD WINS OVER THE PARSED ONE. Intake is a convenience for
    // free text; a caller that states a value is stating it, not suggesting it.
    const field = (name: string) => {
      const explicit = String((body as Record<string, unknown>)?.[name] ?? "").trim();
      return explicit || String((intake as Record<string, unknown>)?.[name] ?? "").trim();
    };

    const panelRows = Array.isArray(body?.panelRows)
      ? (body.panelRows as unknown[]).map((row) => String(row || "").trim()).filter(Boolean)
      : [];
    // THE DESIGN COMES FROM A.C.E., AND ONLY THE OUTPUT CONTRACT IS SWAPPED.
    // `atlasFlatMaster: true` is the same branch Call 1 runs, so the persona,
    // the concept translation, the layered build order, the logo architecture
    // and the customer's own FINISH_SPEC all fire exactly as they do in
    // production; `panelProofCreativeHead` then cuts its six-rectangle artboard
    // tail off and throws if that seam ever moves, rather than shipping a
    // prompt that asks for two different documents at once.
    // A.C.E. prints the body class into its own opening line, and with nothing
    // there it reads "(vehicle)" — the designer told nothing about the shape of
    // the thing it is designing for. Intake infers it from the model name.
    // Only references actually attached below activate the shared VisionBoard
    // instructions. Original Zone-3 logo assets remain in the compositor.
    const customerAssets = (Array.isArray(body?.customerAssets) ? body.customerAssets : [])
      .filter((a: unknown) => a && typeof (a as { storagePath?: unknown }).storagePath === "string")
      .filter((a: { storagePath: string; role?: string; assetRole?: string; contentType?: string; contentHash?: string }) => {
        if (body.separatedArtwork !== true) return true;
        // Zone-3 originals belong to the deterministic compositor, never the
        // image model. Untagged staged PNGs are verified VisionBoard references.
        return ![a.role, a.assetRole].some(role => ["logo", "typography", "contact", "cut-graphic", "vector"].includes(String(role || "")))
          && !["image/svg+xml", "application/pdf"].includes(String(a.contentType || ""))
          && !/\/inputs\/(logo|typography|contact)\//.test(a.storagePath)
          && a.storagePath !== body?.logoAsset?.storagePath
          && (!body?.logoAsset?.contentHash || a.contentHash !== body.logoAsset.contentHash);
      })
      .slice(0, 8);
    /**
     * A PARAPHRASE MUST NOT BE ABLE TO SWALLOW THE CUSTOMER'S PLACEMENT.
     *
     * `intake.creativeDirection` won outright here. The intake prompt tells
     * the reader to copy the customer's own words, to keep placement, and that
     * the brief "must not be shortened" -- but it is a Flash call, it fails
     * soft, and nothing measured whether it actually kept them. On live
     * bbdd0db0 the brief asked for the scene "on 3/4 of sides and rear" and
     * the design covers whole panels edge to edge.
     *
     * So the extraction is checked against the words it came from. Intake
     * legitimately drops the vehicle, the phone number and the web address, so
     * a shorter result is expected; losing most of the brief is not. Below
     * two thirds of the original wording the customer's own sentence is used
     * instead, because an unshortened brief the designer can read beats a tidy
     * one that lost the instruction.
     */
    const extracted = field("creativeDirection");
    const rawBrief = String(body?.prompt || "") || customerPrompt;
    const words = (value: string) => String(value || "").trim().split(/\s+/).filter(Boolean).length;
    const briefText = extracted && words(extracted) >= Math.ceil(words(rawBrief) * 0.66)
      ? extracted : (rawBrief || extracted);
    const creativeDirection = [
      briefText,
      field("style") ? `Style direction: ${field("style")}.` : "",
    ].filter(Boolean).join("\n");
    const vehicleType = field("vehicleType") || undefined;
    let creativeHead = panelProofCreativeHead(buildDesignIQPrompt({
      mode: "commercial",
      prompt: creativeDirection,
      finish: String(body?.finish || "Gloss"),
      substrate: "standard",
      companyName: field("companyName"),
      phone: field("phone"),
      website: field("website"),
      industryType: field("industryType"),
      brandColors: body?.brandColors,
      fontStyle: body.separatedArtwork === true ? undefined : field("fontStyle"),
      styleDescriptors: field("styleDescriptors"),
      visionboard_intent: body?.visionboard_intent,
      visionBoardImages: customerAssets.map((asset: { storagePath: string }, index: number) => ({
        slotLabel: `Customer reference ${index + 1}`, storageUrl: asset.storagePath,
      })),
      vehicleYear: field("vehicleYear"),
      vehicleMake: field("vehicleMake"),
      vehicleModel: field("vehicleModel"),
      vehicleType,
      viewType: "side",
      atlasFlatMaster: true,
      // DesignIQ names THIS document's object. Without it the head opens with
      // the six-rectangle artboard sentence and `SYSTEM_JOB` then asks for the
      // three-band proof — two contracts, wrong one first.
      atlasProofSheet: true,
      atlasCleanBase: body.separatedArtwork === true,
      atlasPanels: ATLAS_PANELS,
    } as Record<string, unknown>));
    if (body.separatedArtwork === true) {
      // The shared clean-base branch omits customer copy. Its presentation and
      // exact-reference sentences still mention branding; adapt only those
      // two clauses for this background-only output.
      /**
       * A CLEAN BASE IS STILL A DESIGN. THIS ASKED FOR A BACKGROUND.
       *
       * "Reserve calm, high-contrast negative space for the separate vector
       * overlay layer" replaced the sentence that hands the designer authority
       * over composition -- and it is the whole of what the designer was told
       * about layout. Asked for a calm background, a designer gives you a
       * photograph, which is exactly what live bbdd0db0 returned: six cropped
       * desert-garden photos with no composition, no colour system and no
       * graphic language, while the customer's own placement instruction
       * ("a desert tropical Scottsdale home front on 3/4 of sides and rear")
       * went unanswered.
       *
       * The separation is not the problem and is not being undone: Zone 2
       * needs lettering-free panels for template QC and Zone 3 needs the marks
       * as separate originals. What has to change is that the base is a
       * COMPOSED wrap missing only its lettering, not a backdrop. So the
       * replacement keeps every constraint the overlay needs -- no lettering,
       * no logo, reserved space with enough contrast to carry type -- and
       * gives back the design brief that was taken away.
       *
       * This is creative conditioning and it is therefore judgement, not a
       * measurement. It is narrow on purpose: it restores composition
       * authority and the customer's stated placement, and adds nothing about
       * subject, palette or style, which remain the brief's alone.
       */
      creativeHead = creativeHead
        .replace("The company name reads clearly at a glance; how the branding is composed is your creative call.",
          "This is a finished commercial wrap composition with its lettering left off, never a backdrop: "
          + "design it with deliberate flow across the panel, a committed colour system, and graphic language "
          + "-- shapes, sweeps, edges, photographic content -- arranged as a designer would arrange them. "
          + "Honour every placement the customer stated: where they say artwork covers a fraction of a side "
          + "or a specific area, compose it exactly there. "
          + "Leave one deliberate, calm, high-contrast area on each surface for the brand lockup that is "
          + "composited separately; reserving that area is part of the composition, not a substitute for it.")
        .replace("Recreate its colors, patterns, typography, logos, layout, composition, proportions and visual hierarchy faithfully",
          "Recreate only its background colors, patterns, layout, composition, proportions and visual hierarchy faithfully");
    }

    let prompt = buildPanelProofPrompt({
      creativeHead,
      companyName: field("companyName"),
      tagline: field("tagline"),
      phone: field("phone"),
      website: field("website"),
      services: (body?.services ?? intake?.services),
      promo: field("promo"),
      vehicleYear: field("vehicleYear"),
      vehicleMake: field("vehicleMake"),
      vehicleModel: field("vehicleModel"),
      proofDate: body?.proofDate,
      orderNumber: body?.orderNumber,
      designer: body?.designer,
      proofVersion: body?.proofVersion,
      creativeDirection,
      panelRows,
    });

    if (body.separatedArtwork === true) {
      // Preserve A.C.E.'s creative direction while replacing legacy layout
      // language with the explicit artwork-only boundary below.
      const artworkCreativeHead = creativeHead
        .replace(" — build the entire design from this palette and do not introduce unrelated colors.",
          " — build the entire design from this palette.")
        .split(/\n+/)
        .filter((line) => line.startsWith("Client's creative direction:")
          || !/\b(?:no|not|never|without|do\s+not|don't|must\s+not|cannot)\b/i.test(line))
        .join("\n");
      prompt = [
        "ROLE: Senior commercial vehicle-wrap artwork designer. OUTPUT: six clean printed background artworks for deterministic placement into the customer's six vehicle panel cells.",
        "CONTENT SCOPE: color fields, photography, illustration, gradients, textures, patterns, graphic motion, lighting, depth and visual accents. Keep every generated pixel within this artwork vocabulary.",
        artworkCreativeHead,
        "REQUIRED SUBJECT HIERARCHY: When the customer's creative direction requests a photoreal hero subject or scene, render that specific subject prominently inside the panel artwork. Preserve its people, animals, products or activity as requested. Textures and patterns support the requested subject; they must not replace it. Background artwork here includes the complete photographic and illustrated design beneath the separate branding layer.",
        "Output raw edge-to-edge wrap artwork only. Strictly forbid document frames, headers, text labels, borders, dimensions, arrows, typography, logos or zone markers.",
        "ARTWORK STAGING CANVAS: Attachment 1 contains six unlabelled gray rectangles. Fill those exact rectangles boundary-to-boundary with cohesive raw artwork. Preserve their locations and aspect ratios on the 3:2 canvas. Keep the unused canvas white.",
        "DESIGN CONTINUITY: From left to right: driver, passenger, roof, hood, front, rear. Coordinate all six artworks as one campaign. Reserve calm visual space for a separate customer branding layer. Treat every rectangle as flat printed vinyl artwork.",
        "Customer reference images demonstrate color palette and surface style ONLY; ignore all reference frames and layouts. Return the six clean background artworks on the staging canvas.",
      ].join("\n\n");
    }

    // PHASE 1 PAYLOAD CONTRACT — fail closed before the provider sees a request.
    // The live canary reports this object next to the full prompt so the exact
    // persona/layout injection can be proved from the provider payload rather
    // than inferred from source comments.
    const phase1Audit = {
      contract: "designpro.vehiclepro.phase1.graphic-designer-flat-first-opaque-edge.v1",
      graphicDesignerPersonaInjected:
        /senior graphic designer and vehicle-wrap specialist at a sign and wrap company/.test(prompt),
      nativeGeminiImageKnowledgeInjected:
        /Use your native Gemini 3 Pro Image design knowledge\./.test(prompt),
      flatPanelProductionProofInjected:
        /THE DELIVERABLE IS THE ARTWORK FOR A VEHICLE WRAP PANEL PRODUCTION PROOF/.test(prompt)
        || (/OUTPUT: six clean printed background artworks/.test(prompt)
          && /six unlabelled gray rectangles/.test(prompt)),
      templateLayoutLocked:
        /Fill the attached template; do not re-flow it\./.test(prompt)
        || /ARTWORK STAGING CANVAS/.test(prompt),
    };
    const missingPhase1 = Object.entries(phase1Audit)
      .filter(([key, value]) => key !== "contract" && value !== true)
      .map(([key]) => key);
    if (missingPhase1.length) {
      throw new Error(`panel_proof_phase1_contract_missing:${missingPhase1.join(",")}`);
    }

    // THE BIG INPUTS TRAVEL BY STORAGE PATH, NOT INSIDE THE JSON BODY.
    // Live 2026-08-27: a 2.2MB request as inline base64 killed the worker 25s
    // in, twice, with a bodiless 504.
    const parts: Array<Record<string, unknown>> = [{ text: prompt }];
    // THE SAME IMAGE OBJECTS, ALSO FILED BY RULE 0.24 CLASS.
    //
    // Every inlineData part below is pushed into `parts` (the single-turn ask,
    // unchanged) AND into exactly one of these. The anchored path then sends
    // the CREATIVE class with turn 1 and the STRUCTURAL class with turn 2, so a
    // customer's reference photograph is never weighed in the same breath as a
    // blank container template. Google's guidance is that reference images
    // carry roles; ours all arrived in one undifferentiated bag.
    const creativeParts: Array<Record<string, unknown>> = [];
    const structuralParts: Array<Record<string, unknown>> = [];
    const attached: Array<Record<string, unknown>> = [];
    // Reported separately from `attachedInputs` so "did Call 1 see a
    // gold standard, and which one" is a field rather than a grep. The
    // revision receipt recorded a hardcoded 0 for this for weeks.
    const qualityExamples: Array<{ path: string; sha256: string; byteSize: number }> = [];

    // THE CONTAINER GOES FIRST, because the prompt names it as attachment (1).
    //
    // AND THE STUDIO DRAWS IT. `panelRows` is the one place the six rectangles
    // are stated, and the prompt above has just stated them to the model, so
    // parsing that same array here means the sheet and the sentence cannot
    // disagree about what this vehicle measures.
    let containerSource: Record<string, unknown> = { origin: "studio" };
    let containerPath = "";
    let containerHash = "";
    try {
      const drawn = await stageProofContainer(svc.storage.from(BUCKET), {
        manifest: parsePanelRows(panelRows),
        mode: body.separatedArtwork === true ? "artwork" : "template",
        companyName: field("companyName"),
        vehicle: ["vehicleYear", "vehicleMake", "vehicleModel"].map(field).filter(Boolean).join(" "),
      });
      containerPath = drawn.storagePath;
      containerHash = drawn.contentHash;
      containerSource = { origin: "studio", svgChars: drawn.svgChars, byteSize: drawn.byteSize };
    } catch (renderError) {
      // A legacy fallback can contain the same labels this path removes.
      if (body.separatedArtwork === true) throw renderError;
      // FALL BACK TO A CALLER-STAGED CONTAINER, AND SAY SO. The reason is
      // carried into the response rather than swallowed: a probe that silently
      // stopped drawing its own sheet would look exactly like one that never
      // could, and this seam has already been wrong twice for want of saying
      // which half ran.
      const reason = String((renderError as Error)?.message || renderError);
      containerPath = String(body?.containerStoragePath || "").trim();
      containerHash = String(body?.containerContentHash || "").trim();
      if (!containerPath || !containerHash) {
        throw new Error(`panel_proof_container_unavailable:${reason}`);
      }
      containerSource = { origin: "caller", studioRenderFailed: reason };
    }
    if (!CALL1_INPUT_PATH.test(containerPath)) {
      throw new Error(`panel_proof_container_path_invalid:${containerPath.slice(0, 64)}`);
    }
    {
      const { data, error } = await svc.storage.from(BUCKET).download(containerPath);
      if (error || !data) throw new Error(`panel_proof_input_missing:${containerPath}`);
      const bytes = new Uint8Array(await data.arrayBuffer());
      const digest = await sha256Hex(bytes);
      // The filename IS the content hash, so these two comparisons are not the
      // same check: one catches a swapped object, the other a caller whose
      // claim does not match what it staged.
      if (digest !== containerPath.slice("atlas-call1-inputs/".length, -4)) {
        throw new Error(`panel_proof_container_not_content_addressed:${digest.slice(0, 16)}`);
      }
      if (digest !== containerHash) {
        throw new Error(`panel_proof_container_hash_mismatch:${digest.slice(0, 16)}`);
      }
      const containerPart = { inlineData: { mimeType: "image/png", data: encodeBase64(bytes) } };
      parts.push(containerPart);
      structuralParts.push(containerPart);
      attached.push({
        role: "container", path: containerPath, sha256: digest, byteSize: bytes.length,
        contract: PANEL_PROOF_CONTAINER_TEMPLATE.contract,
        // WHO DREW IT. The checks above prove the bytes are the ones named;
        // only this says whether the studio drew them for this vehicle or a
        // caller supplied them, which is the difference between the contract
        // the owner asked for and the fallback behind it.
        ...containerSource,
      });
    }

    for (const pinned of (body.separatedArtwork === true ? [] : PINNED_INPUTS)) {
      const { data, error } = await svc.storage.from(BUCKET).download(pinned.path);
      if (error || !data) throw new Error(`panel_proof_input_missing:${pinned.path}`);
      const bytes = new Uint8Array(await data.arrayBuffer());
      const digest = await sha256Hex(bytes);
      // "MUST USE THIS" IS ENFORCED, NOT ASSUMED. The owner pinned the format
      // sheet by hash; a silently different teaching input is exactly how
      // canary 33389124918 taught wheel wells back into the source rectangles,
      // and it took a request inspection to find out. Refuse rather than draw.
      if (pinned.sha256 && digest !== pinned.sha256) {
        throw new Error(`panel_proof_format_example_mismatch:${pinned.role}:${digest.slice(0, 16)}`);
      }
      const pinnedPart = { inlineData: { mimeType: "image/png", data: encodeBase64(bytes) } };
      parts.push(pinnedPart);
      structuralParts.push(pinnedPart);
      attached.push({ role: pinned.role, path: pinned.path, sha256: digest, byteSize: bytes.length });
    }

    // The gold-standard artboards. Quality reference ONLY -- never topology,
    // never artwork. A bucket outage or an empty prefix must not cost a design,
    // so every failure here is swallowed and simply yields no examples, exactly
    // as the runtime loader this is ported from behaves.
    try {
      const { data: listed } = await svc.storage.from(BUCKET)
        .list(ARTBOARD_QUALITY_PREFIX.replace(/\/$/, ""), { limit: 10 });
      // ⚠️ DO NOT PRE-SLICE TO ARTBOARD_QUALITY_MAX. COUNT WHAT IS ACCEPTED.
      //
      // The previous form took the first two names and then skipped the ones
      // that were unusable -- a duplicate, an oversized file, a failed
      // download -- which meant a rejected candidate SPENT a slot instead of
      // yielding it to the next file. With `01-panel-proof-zones-filled.png`
      // being byte-identical to the pinned format sheet, the request carried
      // ONE real exemplar however many good files sat behind it in the bucket.
      // That is the same defect the dedupe guard was written to fix, one layer
      // up, and it would have silently eaten the owner's first upload.
      //
      // So the ceiling is on ACCEPTED examples and the listing is walked until
      // it is reached. `limit: 10` still bounds the work.
      const candidates = (listed || [])
        .filter((file: { name?: string }) => /\.(png|jpe?g|webp)$/i.test(String(file?.name || "")));
      for (const file of candidates) {
        if (qualityExamples.length >= ARTBOARD_QUALITY_MAX) break;
        const path = `${ARTBOARD_QUALITY_PREFIX}${file.name}`;
        const { data, error } = await svc.storage.from(BUCKET).download(path);
        if (error || !data) continue;
        const bytes = new Uint8Array(await data.arrayBuffer());
        if (!bytes.length || bytes.length > ARTBOARD_QUALITY_MAX_BYTES) continue;
        // AN EXEMPLAR ALREADY IN THE REQUEST IS NOT A SECOND EXEMPLAR.
        //
        // Live 7a72951823648d27 attached four images of which TWO were byte
        // identical: `atlas-examples/panel-proof-zones-filled.png` as the
        // `format` anchor and `designpanel-artboard-examples/01-panel-proof-
        // zones-filled.png` as a quality example, both sha256 9586710b. Google's
        // own guidance is that reference images carry ROLES; the same bytes in
        // two roles is one role diluted, and it spent one of only
        // ARTBOARD_QUALITY_MAX=2 quality slots, leaving the model a single real
        // exemplar of professional wrap work. The seeding is fixable in the
        // bucket; this makes the request unable to carry the duplicate either
        // way, because a bucket is edited by hand and this is not.
        const qualityDigest = await sha256Hex(bytes);
        if (attached.some((a) => a.sha256 === qualityDigest)) continue;
        const extension = String(file.name).toLowerCase().split(".").pop();
        const mimeType = extension === "jpg" || extension === "jpeg" ? "image/jpeg"
          : extension === "webp" ? "image/webp" : "image/png";
        // The text goes FIRST so the image is already framed as a quality
        // reference when the model reaches it, and it names every axis the
        // example may NOT influence. Wording preserved from the runtime port.
        parts.push({
          text: `DESIGNPANEL GOLD-STANDARD ARTBOARD ${qualityExamples.length + 1} — PRODUCTION-QUALITY REFERENCE ONLY. `
            + `Match its professional depth, finish, typographic hierarchy, connected-wrap coherence and gallery-grade execution: `
            + `this is the standard of design the output must reach. `
            + `Copy none of its artwork, photography, palette, wording, logo, brand, industry, panel geometry or topology. `
            + `The container template above alone controls topology, and the customer's own brief alone controls subject and colour.`,
        });
        const qualityPart = { inlineData: { mimeType, data: encodeBase64(bytes) } };
        parts.push(qualityPart);
        // Its framing text is the part immediately before it in `parts`; both
        // move together or the image arrives unlabelled in turn 1.
        creativeParts.push(parts[parts.length - 2], qualityPart);
        qualityExamples.push({ path, sha256: qualityDigest, byteSize: bytes.length });
        attached.push({ role: "artboard-quality", path, sha256: qualityDigest, byteSize: bytes.length });
      }
    } catch (_error) {
      // Examples improve quality; their absence never blocks authoring.
    }

    // THE CUSTOMER'S VERIFIED CREATIVE REFERENCES.
    //
    // Their absence was this route's worst defect: the runtime forwarded text
    // and vehicle fields only, so a customer who uploaded a logo or a reference
    // photo received a design that never saw either, while the six-surface and
    // field contracts carried both. RULE 0.24 calls those CREATIVE authority.
    //
    // They arrive as REFERENCES, not base64, and that is deliberate: this
    // function has already died twice on a bodiless 504 from a 2.2 MB base64
    // request (see the header), and a logo plus a VisionBoard set is larger than
    // that. The runtime stages each one to the Call-1 input prefix and sends the
    // identity; the three checks below are the SAME ones the container gets, so
    // a caller cannot name bytes this side did not verify.
    //
    // They are attached AFTER the container and the pinned format sheet. On the
    // separated route, protected originals were removed above and remain solely
    // in the compositor; only background/style references reach the model.
    for (const asset of customerAssets) {
      const path = String(asset?.storagePath || "");
      const claimed = String(asset?.contentHash || "").toLowerCase();
      if (!CALL1_INPUT_PATH.test(path)) {
        throw new Error(`panel_proof_customer_asset_path_invalid:${path.slice(0, 64)}`);
      }
      const { data, error } = await svc.storage.from(BUCKET).download(path);
      if (error || !data) throw new Error(`panel_proof_customer_asset_missing:${path}`);
      const bytes = new Uint8Array(await data.arrayBuffer());
      const digest = await sha256Hex(bytes);
      if (digest !== path.slice("atlas-call1-inputs/".length, -4)) {
        throw new Error(`panel_proof_customer_asset_not_content_addressed:${digest.slice(0, 16)}`);
      }
      if (claimed && digest !== claimed) {
        throw new Error(`panel_proof_customer_asset_hash_mismatch:${digest.slice(0, 16)}`);
      }
      const customerPart = { inlineData: { mimeType: "image/png", data: encodeBase64(bytes) } };
      parts.push(customerPart);
      creativeParts.push(customerPart);
      attached.push({ role: "customer-asset", path, sha256: digest, byteSize: bytes.length });
    }

    const t0 = Date.now();

    // ═══ THE ANCHORED PATH: ONE CONVERSATION, TWO TURNS ═══
    //
    // Owner, 2026-09-21: "do the multitodal thought signatures". The full
    // reasoning is on `buildPanelProofTurns`; what happens HERE is the wiring.
    //
    // Scoped to the three-zone sheet. `separatedArtwork` already asks for
    // artwork alone with no document and no container, so it has nothing to
    // split and stays a single turn byte for byte. `anchorTurns: false` on the
    // request restores the single turn on this path too, which is what a
    // side-by-side needs and what a rollback is.
    const anchorTurns = body.separatedArtwork !== true && body.anchorTurns !== false;
    const turns = anchorTurns
      ? buildPanelProofTurns({
        creativeHead,
        companyName: field("companyName"), tagline: field("tagline"),
        phone: field("phone"), website: field("website"),
        services: (body?.services ?? intake?.services), promo: field("promo"),
        vehicleYear: field("vehicleYear"), vehicleMake: field("vehicleMake"),
        vehicleModel: field("vehicleModel"), creativeDirection, panelRows,
      })
      : null;
    const imageConfig = { aspectRatio: "3:2", imageSize: "4K" };
    let designTurnRequestId: string | null = null;
    let designExchange: { user: Record<string, unknown>; model: Record<string, unknown> } | null = null;
    let designTurnMs = 0;
    if (turns) {
      const designAt = Date.now();
      const designUser = { role: "user", parts: [{ text: turns.design }, ...creativeParts] };
      const designRequest = JSON.stringify({
        contents: [designUser],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig },
      });
      // ITS OWN CACHE KEY. The two turns are two paid requests, so a recovery
      // that re-reads the design must not be handed the layout's bytes or
      // spend a second design -- `attemptKey` is what keys the durable record.
      const designCached = await runDurableImageProviderRequest({
        bucket: svc.storage.from(BUCKET),
        identity: {
          ...providerRequest, ownerId: caller.userId, mode: "atlas-panel-proof",
          attemptKey: `${providerRequest.attemptKey}:design`,
        },
        requestHash: await providerSha256(JSON.stringify({
          model: PRIMARY_IMAGE_MODEL, promptVersion: ATLAS_PANEL_PROOF_CONTRACT,
          turn: "design", modelRequest: designRequest,
        })),
        privateRequest: designRequest,
        outputRequestId: requestId,
        cacheOnly: providerRequest.cacheOnly === true,
        authorize: () => authorizeAtlasProviderRequest(svc, {
          ...providerRequest, attemptKey: `${providerRequest.attemptKey}:design`,
        }, caller.userId),
        invoke: () => captureGeminiHttpExchange(async () => await fetch(
          geminiImageUrl(getGeminiKey(), PRIMARY_IMAGE_MODEL),
          { method: "POST", headers: { "Content-Type": "application/json" }, body: designRequest },
        )),
      });
      designTurnRequestId = designCached.requestId;
      // THE MODEL'S REPLY IS REPLAYED VERBATIM. `thoughtSignature` is opaque
      // metadata that belongs to the part it arrived on -- never summarise,
      // truncate, merge or relabel it (`gemini-image-history.mjs` says so in
      // its first line, and that module is the proven transport for exactly
      // this). Rebuilding a tidier model turn is how the continuation silently
      // becomes a fresh conversation that happens to contain an image.
      const designContent = designCached.payload?.candidates?.[0]?.content;
      if (!designContent?.parts?.length) {
        throw new Error(`panel_proof_design_turn_no_content:${designCached.payload?.candidates?.[0]?.finishReason || "unknown"}`);
      }
      if (!designContent.parts.some((p: Record<string, unknown>) => (p as { inlineData?: unknown }).inlineData)) {
        throw new Error(`panel_proof_design_turn_no_image:${designCached.payload?.candidates?.[0]?.finishReason || "unknown"}`);
      }
      designExchange = { user: designUser, model: designContent };
      designTurnMs = Date.now() - designAt;
    }

    const modelRequest = JSON.stringify({
      ...(body.separatedArtwork === true ? { systemInstruction: { parts: [{ text:
        "Follow the A.C.E. commercial-wrap creative direction in the user request. You author the imagery and background artwork for a complete three-zone Studio production proof. "
        + "The attached Studio artwork template defines six exact panel destinations. Preserve those positions and proportions. Photography and illustration belong inside the artwork. "
        + "The compositor builds Zone 1 from your art plus protected brand assets, Zone 2 from your same art, and Zone 3 from isolated brand assets. "
        + "Document headings, dimensions, panel labels, borders and other sheet annotations are drawn by code. Never paint document annotations into panel textures. Return only the requested clean artwork canvas."
      }] } } : {}),
      contents: designExchange
        // The layout turn CONTINUES the design turn: its user parts, the
        // model's reply with its signature intact, then the layout ask with the
        // structural references. The design is in the conversation, so this
        // turn decomposes it instead of inventing it again.
        ? [designExchange.user, designExchange.model,
          { role: "user", parts: [{ text: String(turns?.layout || "") }, ...structuralParts] }]
        : [{ role: "user", parts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        // 3:2 BECAUSE THE PINNED REFERENCE IS 3:2 (1536x1024, exactly 1.5).
        // This asked for 16:9 while showing the model a 1.5 document and
        // telling it to match that layout -- so the one instruction and the
        // canvas disagreed, and the model had to re-flow the thing it was
        // being told to reproduce. Google's own list confirms 3:2 across the
        // Gemini 3 image models. If PANEL_PROOF_FORMAT_EXAMPLE is ever
        // replaced, this ratio follows its dimensions.
        imageConfig: { aspectRatio: "3:2", imageSize: "4K" },
      },
    });

    // ═══ THE RECOVERY CONTRACT IS HONOURED, NOT IGNORED ═══
    //
    // This used to be a bare `fetch` with its own `crypto.randomUUID()`, and the
    // caller's `cacheOnly` meant nothing: the runtime sends `cacheOnly: true`
    // when it is RECOVERING an interrupted attempt, and this function answered
    // by spending a fresh paid image generation. So a lost worker, a lost lease
    // or an unanswered provider call could each buy the same sheet twice, and
    // the second one was invisible -- a new request id every time.
    //
    // `runDurableImageProviderRequest` is the proven module the other Call-1
    // endpoint already uses for exactly this (RULE 1: recover before you
    // invent). It gives, in one call:
    //
    //   · a STABLE operation identity -- {ownerId, requestId, generationId,
    //     mode, attemptKey} -- so a re-run addresses its own earlier request;
    //   · an atomic claim, so two workers racing the same attempt cannot both
    //     call Gemini (an uncertain claim write is never authority to call);
    //   · `cacheOnly` -> `provider_cache_miss` (404) instead of a generation;
    //   · `provider_outcome_unknown` (409) on an interrupted exchange, with the
    //     diagnostic banked, so the runtime re-reads rather than re-spends;
    //   · the exchange stored, so recovery returns the SAME sheet.
    //
    // `attemptKey` is the caller's, defaulting to the one bounded attempt this
    // contract has. It is part of the identity, so candidate 2 is a different
    // operation and is still allowed to spend -- that is the bounded budget
    // working, not a cache miss.
    const providerRequest = {
      ...(body?.providerRequest && typeof body.providerRequest === "object" ? body.providerRequest : {}),
      requestId: String(body?.requestId || body?.providerRequest?.requestId || ""),
      generationId: String(body?.generationId || body?.providerRequest?.generationId || ""),
      claimToken: body?.claimToken ?? body?.providerRequest?.claimToken,
      attemptKey: String(body?.attemptKey || body?.providerRequest?.attemptKey || "panel-proof:1"),
      cacheOnly: body?.cacheOnly === true || body?.providerRequest?.cacheOnly === true,
    };
    const logoPromise = body.separatedArtwork === true ? authorProofLogo({
      bucket: svc.storage.from(BUCKET), ownerId: caller.userId, providerRequest,
      input: { companyName: field("companyName"), logoAsset: body.hasCustomerLogo || body.logoAsset,
        generateLogo: proofLogoRequested({ ...body, customerPrompt }),
        industry: field("industryType"),
        brief: customerPrompt, colorBrief: field("brandColors"), stylePrompt: field("style") },
      model: PRIMARY_IMAGE_MODEL, buildPrompt: buildTextLayerPrompt,
      authorize: () => authorizeAtlasProviderRequest(svc, providerRequest, caller.userId),
      invoke: (request: string) => captureGeminiHttpExchange(async () => await fetch(
        geminiImageUrl(getGeminiKey(), PRIMARY_IMAGE_MODEL),
        { method: "POST", headers: { "Content-Type": "application/json" }, body: request },
      )),
    }) : Promise.resolve(null);
    const [cached, generatedLogo] = await Promise.all([runDurableImageProviderRequest({
      bucket: svc.storage.from(BUCKET),
      identity: { ...providerRequest, ownerId: caller.userId, mode: "atlas-panel-proof" },
      requestHash: await providerSha256(JSON.stringify({
        model: PRIMARY_IMAGE_MODEL, promptVersion: ATLAS_PANEL_PROOF_CONTRACT, modelRequest,
      })),
      privateRequest: modelRequest,
      outputRequestId: requestId,
      cacheOnly: providerRequest.cacheOnly === true,
      authorize: () => authorizeAtlasProviderRequest(svc, providerRequest, caller.userId),
      invoke: () => captureGeminiHttpExchange(async () => await fetch(
        geminiImageUrl(getGeminiKey(), PRIMARY_IMAGE_MODEL),
        { method: "POST", headers: { "Content-Type": "application/json" }, body: modelRequest },
      )),
    }), logoPromise]);
    requestId = cached.requestId;
    const payload = cached.payload;
    const candidateParts = payload?.candidates?.[0]?.content?.parts ?? [];
    const image = candidateParts.find((p: Record<string, unknown>) => (p as { inlineData?: unknown }).inlineData);
    if (!image) {
      throw new Error(`panel_proof_no_image:${payload?.candidates?.[0]?.finishReason || "unknown"}`);
    }
    const bytes = decodeBase64(image.inlineData.data as string);

    // THE GATE RUNS BEFORE ANYTHING IS STORED OR RETURNED. A re-flowed sheet is
    // refused here rather than handed onward for a downstream slicer to measure
    // confidently in the wrong places.
    const sheetShape = assertProofSheetShape(bytes);

    const sha256 = await sha256Hex(bytes);
    // NAMED FOR WHAT IT IS. This wrote `.png` with `contentType: image/png`
    // regardless of what the model returned, and the model returns JFIF.
    const storagePath = `atlas-panel-proof/${sha256}.${sheetShape.extension}`;
    const { error: upErr } = await svc.storage.from(BUCKET)
      .upload(storagePath, bytes, { contentType: sheetShape.mime, upsert: false });
    if (upErr && !/exists/i.test(String(upErr.message))) throw upErr;

    return json({
      success: true,
      contract: ATLAS_PANEL_PROOF_CONTRACT,
      requestId,
      model: PRIMARY_IMAGE_MODEL,
      proofStoragePath: storagePath,
      proofSha256: sha256,
      proofByteSize: bytes.length,
      sheetShape,
      generatedElements: generatedLogo ? [generatedLogo] : [],
      imageRequestCount: (turns ? 2 : 1) + (generatedLogo ? 1 : 0),
      // WHAT SHAPE THE ASK ACTUALLY HAD, on the receipt rather than inferred
      // from a count. `anchoredTurns` false is the single-turn request this
      // function has always sent; true is the design -> layout conversation.
      anchoredTurns: Boolean(turns),
      designTurn: turns ? {
        requestId: designTurnRequestId,
        promptChars: turns.design.length,
        prompt: turns.design,
        elapsedMs: designTurnMs,
        // Whether the reply carried reasoning for the layout turn to continue.
        // Zero here means the second turn replayed an image and nothing else,
        // which is the difference between a continuation and a fresh request
        // that happens to contain a picture.
        thoughtSignatureCount: (designExchange?.model?.parts as Array<Record<string, unknown>> | undefined)
          ?.filter((p) => typeof p?.thoughtSignature === "string").length ?? 0,
      } : null,
      layoutPromptChars: turns ? turns.layout.length : null,
      layoutPrompt: turns ? turns.layout : null,
      // The whole assembled ask, so a disagreement about the design is settled
      // on the REQUEST rather than on impressions of the output -- the reason
      // the designiq A/B harness exists at all.
      promptChars: prompt.length,
      prompt,
      phase1Audit,
      // WHAT THE RAW MESSAGE BECAME. A wrong parse is otherwise invisible: the
      // sheet just quietly carries the wrong company or the wrong truck.
      intake: intake ? { contract: INTAKE_CONTRACT, ...intake } : null,
      attachedInputs: attached,
      artboardQualityExamplesApplied: qualityExamples.length,
      artboardQualityExampleIdentities: qualityExamples,
      elapsedMs: Date.now() - t0,
      // Whether the model returned reasoning alongside the image, so the
      // base -> typography continuation can be judged before it is built.
      thoughtSignatureCount: candidateParts
        .filter((p: Record<string, unknown>) => typeof p?.thoughtSignature === "string").length,
    });
  } catch (error) {
    const providerError = error instanceof GeminiProviderError ? error : null;
    const storageDiagnostic = providerError ? (providerError as any).storageDiagnostic || null : null;
    const diagnosticSuffix = storageDiagnostic
      ? ` [storage ${storageDiagnostic.exceptionClass} status=${storageDiagnostic.httpStatus ?? "unknown"} code=${storageDiagnostic.code ?? "unknown"}]`
      : "";
    return json({
      error: `${String((error as Error)?.message || error)}${diagnosticSuffix}`,
      requestId,
      imageRequestCount: providerError?.imageRequestCount ?? null,
      providerOutcome: providerError?.providerOutcome ?? null,
      retryable: providerError?.retryable === true,
      providerRetryDisposition: providerError?.providerRetryDisposition ?? "operator_required",
      storageDiagnostic,
    }, providerError?.status || 500);
  }
});

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}
