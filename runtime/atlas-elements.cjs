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
    tagline: trimmed(input?.tagline),
  };
}

/**
 * The contact line: whatever contact facts exist, joined once. A wrap carries
 * one contact line, not three competing ones, and joining here means the
 * planner sees the real string width instead of guessing at it.
 */
function contactLine(strings) {
  return [strings.phone, strings.website].filter(Boolean).join("   ·   ");
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
  wantsPhoto = false,
  fetchImpl = fetch,
  logger = () => {},
  fontPath,
} = {}) {
  if (typeof measureOutlinedString !== "function" || typeof measureImageAsset !== "function") {
    fail("atlas_elements_measurement_missing", "the compositor's measurement helpers are required");
  }
  const strings = canonicalStrings(input);
  const font = loadPinnedFont(fontPath);
  const elements = [];
  const sources = {};
  const providerCalls = [];
  const brief = redactBrief(input?.brief, strings);
  const palette = String(input?.brandColors || "").trim();

  // ── LETTERING. Outlined from the frozen strings. No model involved.
  if (strings.companyName) {
    const measured = measureOutlinedString({ fontBytes: font.bytes, string: strings.companyName });
    elements.push({ id: "wordmark", kind: "wordmark", required: true, aspect: measured.aspect, source: { kind: "outlined-type" } });
    sources.wordmark = { kind: "outlined-type", string: strings.companyName, fill: "#ffffff" };
  }
  const contact = contactLine(strings);
  if (contact) {
    const measured = measureOutlinedString({ fontBytes: font.bytes, string: contact });
    // REQUIRED. A customer who supplied a URL and received a wrap without one
    // has been failed, and it is better to refuse the master than to ship it.
    elements.push({ id: "contact", kind: "contact", required: true, aspect: measured.aspect, source: { kind: "outlined-type" } });
    sources.contact = { kind: "outlined-type", string: contact, fill: "#ffffff" };
  }
  if (strings.tagline) {
    const measured = measureOutlinedString({ fontBytes: font.bytes, string: strings.tagline });
    elements.push({ id: "tagline", kind: "tagline", required: false, aspect: measured.aspect, source: { kind: "outlined-type" } });
    sources.tagline = { kind: "outlined-type", string: strings.tagline, fill: "#ffffff" };
  }

  // ── IMAGE ELEMENTS. The customer's own logo wins over a generated mark every
  //    time: it is their identity, it is already exact, and it costs no call.
  const jobs = [];
  const customerLogo = input?.logoAsset || null;
  if (customerLogo?.storagePath) {
    jobs.push((async () => {
      const bytes = await readElementAsset(supabase, {
        assetStoragePath: customerLogo.storagePath,
        assetSha256: customerLogo.contentHash,
      });
      return { kind: "brandmark", bytes, provenance: { source: "customer-upload", contentHash: sha256(bytes) } };
    })());
  } else if (String(input?.mascot || "").trim() || /\b(logo|mascot|character|emblem|badge)\b/i.test(String(input?.brief || ""))) {
    jobs.push((async () => {
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
      const bytes = await readElementAsset(supabase, payload);
      return { kind: "brandmark", bytes, provenance: { source: "generated", contentHash: payload.assetSha256, requestId: payload.requestId } };
    })());
  }

  if (wantsPhoto) {
    jobs.push((async () => {
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
      const bytes = await readElementAsset(supabase, payload);
      return { kind: "photo", bytes, provenance: { source: "generated", contentHash: payload.assetSha256, requestId: payload.requestId } };
    })());
  }

  // AN ELEMENT CALL THAT FAILS IS NOT FATAL. The mark and the photograph are
  // optional by policy: a ground with correct, contained lettering is a usable
  // wrap, and refusing the whole design because a mascot request timed out
  // would be a worse outcome than shipping without the mascot and saying so.
  const settled = await Promise.allSettled(jobs);
  const unresolved = [];
  for (const result of settled) {
    if (result.status === "rejected") {
      unresolved.push({ reason: String(result.reason?.code || result.reason?.message || result.reason).slice(0, 200) });
      logger(`atlas element unresolved: ${unresolved[unresolved.length - 1].reason}`);
      continue;
    }
    const { kind, bytes, provenance } = result.value;
    const measured = await measureImageAsset(bytes);
    elements.push({ id: kind, kind, required: false, aspect: measured.aspect, source: { kind: "image" } });
    sources[kind] = { kind: "image", bytes, contentHash: provenance.contentHash };
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
  _test: { callAtlasElementEdge, readElementAsset },
};
