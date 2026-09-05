"use strict";

/**
 * RESOLVE EVERY REQUIRED ELEMENT'S SOURCE, BEFORE ANYTHING IS ASSEMBLED.
 *
 * Owner requirement, 2026-09-05, verbatim: "Required lettering, logos and focal
 * imagery must fit their intended surfaces. RESOLVE THEIR ASSET SOURCES BEFORE
 * ASSEMBLY; layering new text over already-clipped lettering is not a fix."
 *
 * So this runs BEFORE the compositor and before canonical master acceptance,
 * and it answers one question per element: what are the actual bytes, or the
 * actual string, and what is its MEASURED aspect ratio? Planning against an
 * aspect nobody measured is how a placement passes containment and overflows
 * when it is drawn.
 *
 * FOUR SOURCES, IN PRIORITY ORDER, AND ONE OF THEM IS NOT A MODEL:
 *
 *   contact / wordmark   the frozen request's own strings, outlined from the
 *                        pinned font file. Never generated, never spell-checked,
 *                        never re-typed -- the bytes that print are outlines of
 *                        the string the customer submitted.
 *   brandmark            the customer's uploaded logo when there is one;
 *                        otherwise ONE isolated `atlas-element` image call.
 *   photo                ONE isolated `atlas-element` image call, only when the
 *                        brief actually asks for a photograph.
 *   ground               Call 1, unchanged in count: still exactly one image.
 *
 * WHY THE MARK AND THE PHOTO GET THEIR OWN CALL. A mascot painted into the
 * ground is not an asset -- it is pixels wherever the model put them, and Arctic
 * Air `586abc83` shipped its shield to the roof panel reading `ARCTI`, cut by
 * `x=1071`. An element with its own bytes can be measured, planned into a
 * proven rectangle, and composited whole. That is the difference between asking
 * for containment and having it.
 *
 * THE BRIEF THAT REACHES AN ELEMENT CALL IS REDACTED. Canonical strings -- the
 * company name, the URL, the phone -- are stripped before the request and the
 * edge refuses the call if any survived. An element that came back with the
 * customer's domain painted into it would put a second, unguaranteed copy of
 * that domain on the wrap, which is the whole defect being removed.
 */

const { createHash } = require("node:crypto");
const { readFileSync, existsSync } = require("node:fs");

const ELEMENTS_CONTRACT = "designpro.atlas-elements.v1";
const ELEMENT_ASSET_CONTRACT = "designpro.atlas-element-asset.v1";
const GROUND_FIELD_CONTRACT = "designpro.atlas-field-prompt.v3";

/**
 * TYPE COMES FROM A FONT FILE, NEVER A FAMILY NAME. libvips resolves families
 * through fontconfig and substitutes silently; `ops/Dockerfile.runtime` already
 * installs `fonts-dejavu-core` for exactly this reason and says so. The file is
 * hashed on every run and the digest rides the receipt, so a font swapped
 * underneath a design is visible rather than invisible.
 */
const DEFAULT_FONT_PATHS = Object.freeze([
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
]);

/** Aspect ratios the image model accepts, and the element kinds that want them. */
const ELEMENT_ASPECT = Object.freeze({ brandmark: "1:1", photo: "3:2" });

class ElementsError extends Error {
  constructor(code, message, retryable = false) {
    super(message || code);
    this.name = "ElementsError";
    this.code = code;
    this.retryable = retryable;
  }
}

const fail = (code, message, retryable) => { throw new ElementsError(code, message, retryable); };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Read and hash the pinned font file. Fails closed: no font, no lettering. */
function loadPinnedFont(fontPath = process.env.DESIGNPRO_ATLAS_FONT_PATH) {
  const candidates = fontPath ? [fontPath, ...DEFAULT_FONT_PATHS] : DEFAULT_FONT_PATHS;
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      const bytes = readFileSync(candidate);
      return { bytes, path: candidate, contentHash: sha256(bytes), byteSize: bytes.length };
    }
  }
  fail(
    "atlas_elements_font_missing",
    `no pinned font file found; looked at ${candidates.filter(Boolean).join(", ")}`,
  );
}

/**
 * The canonical strings, straight off the frozen request. These are the only
 * strings that may print, and they are never passed to a model.
 */
function canonicalStrings(input) {
  const trimmed = (value) => String(value || "").trim();
  return {
    companyName: trimmed(input?.companyName || input?.businessName),
    website: trimmed(input?.website),
    phone: trimmed(input?.phone),
    // SUPPLIED SERVICE COPY IS CUSTOMER COPY, AND IT PRINTS.
    //
    // `textLayerPrompt` and `bulletPoints` are the fields a customer types their
    // services into ("24/7 Service · Repairs · Installs"). The ground contract
    // correctly stops the MODEL drawing them -- but the typesetter was reading
    // only `tagline`, so anything supplied through those two fields had no
    // deterministic path onto the artwork at all and simply vanished.
    tagline: trimmed(input?.tagline) || customerCopyLine(input),
  };
}

/**
 * The customer's own service copy, as ONE line the typesetter can set.
 *
 * Bullet points join with a separator the way a real wrap sets them. A long
 * free-text direction is not forced onto the vehicle: prose belongs to the
 * creative brief, and only a short, wrap-shaped line is treated as copy.
 */
const MAX_COPY_CHARS = 64;
function customerCopyLine(input) {
  const bullets = Array.isArray(input?.bulletPoints)
    ? input.bulletPoints.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  if (bullets.length > 0) {
    const joined = bullets.join("  \u00b7  ");
    if (joined.length <= MAX_COPY_CHARS) return joined;
    // Keep as many whole bullets as fit rather than truncating mid-word.
    const kept = [];
    for (const bullet of bullets) {
      const next = [...kept, bullet].join("  \u00b7  ");
      if (next.length > MAX_COPY_CHARS) break;
      kept.push(bullet);
    }
    if (kept.length > 0) return kept.join("  \u00b7  ");
  }
  const supplied = String(input?.textLayerPrompt || "").trim();
  if (supplied && supplied.length <= MAX_COPY_CHARS && !/[.!?]\s/.test(supplied)) return supplied;
  return "";
}

/**
 * The contact line: whatever contact facts exist, joined once. A wrap carries
 * one contact line, not three competing ones, and joining here means the
 * planner sees the real string width instead of guessing at it.
 */
function contactLine(strings) {
  return [strings.phone, strings.website].filter(Boolean).join("   ·   ");
}

/**
 * WHICH SURFACE THE CUSTOMER ASKED FOR.
 *
 * Arctic Air's first brief said "in 3/ sides and rear add a photo of a arctic
 * air tech installing an ac". Nothing in the pipeline read it: `briefWantsPhoto`
 * returns a boolean and the placement policy is fixed, so a named surface was
 * silently discarded and the photo landed wherever the model put it.
 *
 * This reads the request. It is deliberately conservative -- it matches a
 * SUBJECT word near a SURFACE word, and it returns surface names, never
 * rectangles. A request can choose which territory an element goes to; it can
 * never move one outside that territory's trim box, because the planner still
 * owns every coordinate and `assertContained` still runs.
 */
const SURFACE_WORDS = Object.freeze({
  driver: ["driver", "driver's side", "driver side"],
  passenger: ["passenger", "passenger side"],
  rear: ["rear", "back", "tailgate", "hatch", "rear door"],
  hood: ["hood", "bonnet"],
  roof: ["roof", "top"],
  front: ["front", "bumper", "nose", "fascia"],
});
const SUBJECT_WORDS = Object.freeze({
  photo: ["photo", "photograph", "picture", "image", "scene"],
  brandmark: ["logo", "mascot", "character", "emblem", "badge", "mark", "yeti"],
});
/** "both sides" / "3 sides" name the flanks without naming either one. */
const BOTH_FLANKS = /\b(both sides|all sides|3\s*\/?\s*sides|three sides|each side)\b/i;

function placementRequests(brief) {
  const text = String(brief || "").toLowerCase();
  const found = {};
  for (const [kind, subjects] of Object.entries(SUBJECT_WORDS)) {
    const surfaces = new Set();
    for (const subject of subjects) {
      let at = text.indexOf(subject);
      while (at >= 0) {
        // A window around the subject: "photo ... on the rear" and "on the rear
        // ... a photo" both count, and a surface named a paragraph away does not.
        const window = text.slice(Math.max(0, at - 60), at + subject.length + 60);
        for (const [surfaceKey, words] of Object.entries(SURFACE_WORDS)) {
          if (words.some((word) => new RegExp(`\\b${word}\\b`).test(window))) surfaces.add(surfaceKey);
        }
        if (BOTH_FLANKS.test(window)) { surfaces.add("driver"); surfaces.add("passenger"); }
        at = text.indexOf(subject, at + 1);
      }
    }
    if (surfaces.size > 0) found[kind] = [...surfaces].sort();
  }
  return found;
}

/**
 * Did the customer ASK for this element? If they did it is REQUIRED, and a
 * failed asset call fails the run rather than quietly shipping a wrap without
 * the mascot they asked for. A receipt warning is not a delivered brief.
 */
function elementRequested(input, kind) {
  const brief = `${String(input?.brief || "")} ${String(input?.textLayerPrompt || "")}`.toLowerCase();
  if (kind === "brandmark") {
    if (String(input?.mascot || "").trim()) return true;
    return SUBJECT_WORDS.brandmark.some((word) => new RegExp(`\\b${word}\\b`).test(brief));
  }
  if (kind === "photo") return Boolean(input?.__wantsPhoto);
  return false;
}

/** Strip canonical strings out of a brief before it reaches a model. */
function redactBrief(brief, strings) {
  let out = String(brief || "");
  for (const value of Object.values(strings)) {
    if (!value || value.length < 3) continue;
    out = out.replace(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "the business");
  }
  return out.trim();
}

/**
 * One isolated element image call through the SAME deployed edge function that
 * authors Call 1. Same key pool, same model, same one-request discipline.
 */
async function callAtlasElementEdge(body, { fetchImpl = fetch, ownerId, logger = () => {} } = {}) {
  const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!supabaseUrl || serviceRoleKey.length < 32) {
    fail("atlas_elements_transport_missing", "SUPABASE_URL / service key are required for an element request", true);
  }
  const response = await fetchImpl(`${supabaseUrl}/functions/v1/design-panel-ai-generate`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "content-type": "application/json",
      "x-designpro-owner-id": String(ownerId || ""),
    },
    body: JSON.stringify(body),
  });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok || payload?.success !== true) {
    fail(
      "atlas_elements_call_failed",
      `atlas-element ${body.elementKind} failed (HTTP ${response.status}): ${String(payload?.error || "no body").slice(0, 300)}`,
      response.status >= 500,
    );
  }
  if (Number(payload.imageRequestCount) !== 1) {
    fail("atlas_elements_call_count_invalid", `the edge reported ${payload.imageRequestCount} image requests; the contract is exactly 1`);
  }
  logger(`atlas element ${body.elementKind}: ${payload.assetSha256?.slice(0, 12)} (${payload.assetBytes} bytes)`);
  return payload;
}

/** Download an element asset the edge just wrote, and verify its digest. */
async function readElementAsset(supabase, { assetStoragePath, assetSha256 }) {
  const { data, error } = await supabase.storage.from("wrap-files").download(assetStoragePath);
  if (error || !data) {
    fail("atlas_elements_asset_unreadable", `${assetStoragePath}: ${error?.message || "missing"}`, true);
  }
  const bytes = Buffer.from(await data.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== assetSha256) {
    fail("atlas_elements_asset_hash_mismatch", `${assetStoragePath} hashed ${actual}, the edge reported ${assetSha256}`);
  }
  return bytes;
}

/**
 * RESOLVE EVERYTHING, THEN MEASURE EVERYTHING.
 *
 * Returns the `elements` array the planner consumes and the `sources` map the
 * compositor consumes, plus a receipt naming every source and every provider
 * call spent. The two image calls are issued CONCURRENTLY with each other; the
 * caller issues them concurrently with Call 1, because neither depends on the
 * ground.
 */
async function resolveAtlasElements({
  input,
  supabase,
  ownerId,
  measureOutlinedString,
  measureImageAsset,
  textVariants,
  wantsPhoto = false,
  fetchImpl = fetch,
  logger = () => {},
  fontPath,
} = {}) {
  if (typeof measureOutlinedString !== "function" || typeof measureImageAsset !== "function"
    || typeof textVariants !== "function") {
    fail("atlas_elements_measurement_missing", "the compositor's measurement helpers are required");
  }
  const strings = canonicalStrings(input);
  const font = loadPinnedFont(fontPath);
  const elements = [];
  const sources = {};
  const providerCalls = [];
  const attemptsSpent = [];
  const brief = redactBrief(input?.brief, strings);
  const palette = String(input?.brandColors || "").trim();

  // ── LETTERING. Outlined from the frozen strings. No model involved.
  //
  // Every typeset element carries EVERY line-count it could be set on, and the
  // planner picks the one that reads largest inside the slot it has. That is
  // what makes a long name placeable: "Precision Climate Solutions" is 13.3:1
  // on one line and cannot reach a legible cap height on a flank, and 4.2:1 on
  // two, which fits. Refusing the design instead was correct and useless.
  const typeset = (id, kind, string, required) => {
    if (!string) return;
    elements.push({
      id, kind, required,
      variants: textVariants({ fontBytes: font.bytes, string }),
      aspect: measureOutlinedString({ fontBytes: font.bytes, string }).aspect,
      source: { kind: "outlined-type" },
    });
    sources[id] = { kind: "outlined-type", string, fill: "#ffffff" };
  };

  typeset("wordmark", "wordmark", strings.companyName, true);
  // REQUIRED. A customer who supplied a URL and received a wrap without one has
  // been failed, and refusing the master is the cheaper outcome.
  const contact = contactLine(strings);
  typeset("contact", "contact", contact, true);
  // SUPPLIED SERVICE COPY IS REQUIRED TOO. If the customer typed their services
  // in, they are on the wrap or the run says why -- they do not evaporate
  // between a "tone only" prompt and a typesetter that was reading a different
  // field.
  typeset("tagline", "tagline", strings.tagline, Boolean(strings.tagline));

  // ── IMAGE ELEMENTS ────────────────────────────────────────────────────────
  //
  // The customer's own logo wins over a generated mark every time: it is their
  // identity, it is already exact, and it costs no call.
  //
  // AN ELEMENT THE CUSTOMER ASKED FOR IS REQUIRED. The first cut of this module
  // marked both optional and let `Promise.allSettled` swallow a failure into a
  // receipt warning -- so a brief that said "create a yeti mascot" could return
  // a wrap with no mascot and a green run. A receipt warning does not fulfil a
  // brief. A requested element is retried once and then FAILS THE RUN.
  const requested = placementRequests(`${input?.brief || ""} ${input?.textLayerPrompt || ""}`);
  const wantsMark = elementRequested(input, "brandmark");
  const customerLogo = input?.logoAsset || null;

  const attempt = async (label, run) => {
    try { return await run(); } catch (first) {
      logger(`atlas element ${label} attempt 1 failed (${first.code || first.message}); retrying once`);
      attemptsSpent.push({ kind: label, attempt: 1, outcome: "failed", reason: String(first.code || first.message).slice(0, 160) });
      return run();
    }
  };

  const jobs = [];
  if (customerLogo?.storagePath) {
    jobs.push({ kind: "brandmark", required: wantsMark, run: async () => {
      const bytes = await readElementAsset(supabase, {
        assetStoragePath: customerLogo.storagePath,
        assetSha256: customerLogo.contentHash,
      });
      return { bytes, provenance: { source: "customer-upload", contentHash: sha256(bytes) } };
    } });
  } else if (wantsMark) {
    jobs.push({ kind: "brandmark", required: true, run: () => attempt("brandmark", async () => {
      const payload = await callAtlasElementEdge({
        mode: "atlas-element",
        elementKind: "brandmark",
        elementContract: ELEMENT_ASSET_CONTRACT,
        elementBrief: String(input?.mascot || "").trim() || brief,
        palette,
        aspectRatio: ELEMENT_ASPECT.brandmark,
        forbiddenStrings: Object.values(strings).filter(Boolean),
      }, { fetchImpl, ownerId, logger });
      providerCalls.push({ kind: "brandmark", model: payload.model, requestId: payload.requestId, assetSha256: payload.assetSha256 });
      return { bytes: await readElementAsset(supabase, payload), provenance: { source: "generated", contentHash: payload.assetSha256, requestId: payload.requestId } };
    }) });
  }

  if (wantsPhoto) {
    jobs.push({ kind: "photo", required: true, run: () => attempt("photo", async () => {
      const payload = await callAtlasElementEdge({
        mode: "atlas-element",
        elementKind: "photo",
        elementContract: ELEMENT_ASSET_CONTRACT,
        elementBrief: brief,
        palette,
        aspectRatio: ELEMENT_ASPECT.photo,
        forbiddenStrings: Object.values(strings).filter(Boolean),
      }, { fetchImpl, ownerId, logger });
      providerCalls.push({ kind: "photo", model: payload.model, requestId: payload.requestId, assetSha256: payload.assetSha256 });
      return { bytes: await readElementAsset(supabase, payload), provenance: { source: "generated", contentHash: payload.assetSha256, requestId: payload.requestId } };
    }) });
  }

  const settled = await Promise.allSettled(jobs.map((job) => job.run()));
  const unresolved = [];
  for (let index = 0; index < settled.length; index += 1) {
    const job = jobs[index];
    const result = settled[index];
    if (result.status === "rejected") {
      const reason = String(result.reason?.code || result.reason?.message || result.reason).slice(0, 200);
      unresolved.push({ kind: job.kind, required: job.required, reason });
      logger(`atlas element ${job.kind} unresolved after retry: ${reason}`);
      continue;
    }
    const measured = await measureImageAsset(result.value.bytes);
    elements.push({
      id: job.kind, kind: job.kind, required: job.required, aspect: measured.aspect,
      preferredSurfaces: requested[job.kind] || [],
      source: { kind: "image" },
    });
    sources[job.kind] = { kind: "image", bytes: result.value.bytes, contentHash: result.value.provenance.contentHash };
  }

  // FAIL CLOSED ON A REQUESTED ELEMENT THAT NEVER ARRIVED. Two attempts have
  // already been spent; a third would not change the answer, and shipping the
  // wrap without it would deliver a brief the customer did not write.
  const missing = unresolved.filter((entry) => entry.required);
  if (missing.length > 0) {
    fail(
      "atlas_elements_required_asset_unresolved",
      `the brief asks for ${missing.map((m) => m.kind).join(" and ")}, and ${missing.length === 1 ? "it" : "they"} could not be produced after a retry: `
      + missing.map((m) => `${m.kind}: ${m.reason}`).join("; "),
      true,
    );
  }

  return {
    elements,
    sources,
    font,
    receipt: {
      contract: ELEMENTS_CONTRACT,
      groundFieldContract: GROUND_FIELD_CONTRACT,
      fontPath: font.path,
      fontSha256: font.contentHash,
      canonicalStrings: {
        // The exact strings that will print, recorded before they print.
        wordmark: strings.companyName || null,
        contact: contact || null,
        tagline: strings.tagline || null,
      },
      resolved: elements.map((e) => ({ id: e.id, kind: e.kind, required: e.required, aspect: Number(e.aspect.toFixed(4)), source: e.source.kind })),
      providerCalls,
      elementImageCallCount: providerCalls.length,
      // Every FAILED attempt, kept: a run that spent two calls to get one asset
      // costs what it costs, and the receipt says so.
      failedAttempts: attemptsSpent,
      placementRequests: requested,
      unresolved,
    },
  };
}

module.exports = {
  ELEMENTS_CONTRACT,
  ELEMENT_ASSET_CONTRACT,
  GROUND_FIELD_CONTRACT,
  DEFAULT_FONT_PATHS,
  ELEMENT_ASPECT,
  ElementsError,
  resolveAtlasElements,
  loadPinnedFont,
  canonicalStrings,
  contactLine,
  redactBrief,
  placementRequests,
  elementRequested,
  customerCopyLine,
  _test: { callAtlasElementEdge, readElementAsset },
};
