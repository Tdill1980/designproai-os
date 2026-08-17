/**
 * generate-2d-proof
 *
 * Sends (1) WPW 2D proof example + (2) ALL 3D render views + (3) exact dimensions
 * to Gemini. Mirrors what worked in Gemini Studio sandbox.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// std@0.168.0 exports `encode`/`decode`, NOT the newer `encodeBase64`
// names. Importing the wrong symbol is a BOOT error, not a call-site
// error — the whole function 503s before any request runs (live
// 2026-08-04: "worker boot error: Uncaught SyntaxError: the requested
// module does not provide an export named encodeBase64"). Aliased the
// same way _shared/panelizer-os/storage.ts does.
import {
  encode as encodeBase64,
  decode as decodeBase64,
} from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
// Per-tile flat elevations + deterministic sheet composition. Lives in its
// own module so the composition math is unit-testable without booting the
// function or calling Gemini (tests/proof-sheet-composition.test.ts).
import {
  PROOF_SHEET_W,
  PROOF_TILE_ORDER,
  PROOF_TILE_LABELS,
  PROOF_TILE_SIDE_LABELS,
  buildProofTextLock,
  proofTextLiterals,
  findFabricatedText,
  readTileText,
  renderFlatTile,
  composeProofSheet,
  proofTileBoxes,
} from "./proof-sheet.ts";

// NOTE: the server-side dimension fallback (resolveVehicleSpecs, backed by a
// 266KB specs JSON in _shared) is stubbed out so the function bundles without
// that large dependency — required because it is deployed via the Supabase MCP
// (commits through the GitHub MCP token do not trigger the deploy workflow).
// The frontend (TwoDProofSheet) passes real dimensions for any vehicle in the
// client DB, so this only affects vehicles NOT in that DB — they render the
// proof without dimension callouts. To restore the full DB-backed fallback,
// re-add the import and deploy from CI:
//   import { resolveVehicleSpecs } from "../_shared/vehicle-specs-lookup.ts";
const resolveVehicleSpecs = (_year: string, _make: string, _model: string): any => ({ source: "none" });

// GENIE dimension connection — resolve the SAME per-side dims the
// UniversalPanelizer uses for the print panels (panelizer-step-validate →
// vehicle_dimensions), so the proof's dimension callouts MATCH the panels
// exactly. This is the connection that was lost (the stub above), which is why
// the proof was labeling invented numbers (e.g. 39.79"). Server-side,
// service-role, best-effort — returns null on any failure.
async function resolveGenieDims(
  make: string,
  model: string,
  year: string,
  isTrailer = false,
  bodyText = "",
): Promise<any | null> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return null;
    const r = await fetch(`${supabaseUrl}/functions/v1/panelizer-step-validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
      body: JSON.stringify({
        vehicleMake: make,
        vehicleModel: model,
        vehicleYear: year,
        bodyText,
        sideSize: "medium",
        // A trailer has four printable walls. Car add-ons are not trailer faces.
        addHood: !isTrailer,
        addRear: true,
        addFrontBumper: !isTrailer,
        addRearBumper: !isTrailer,
        addRoof: !isTrailer,
      }),
      // 30s was too tight — live panelizer-step-validate calls have been observed
      // taking ~22s on their own before function-to-function network overhead, so
      // the deadline occasionally tripped and silently fell back to "no dims"
      // (dimensionInstruction then correctly tells the AI not to invent numbers,
      // which is why the proof rendered bare "W"/"H" labels with no values).
      signal: AbortSignal.timeout(55000),
    });
    if (!r.ok) return null;
    const d = await r.json();

    // Tall trailer walls are split into upper/lower print tiles in d.panels.
    // Call 8 needs the complete physical wall rectangle, so read the canonical
    // vehicle body dimensions instead of accidentally taking only panel 1.
    if (isTrailer) {
      const vehicle = d?.vehicle || {};
      const sideW = Number(vehicle.bodyLengthInches);
      const sideH = Number(vehicle.bodyHeightInches);
      const wallW = Number(vehicle.backWidthInches);
      const wallH = Number(vehicle.backHeightInches || vehicle.bodyHeightInches);
      if (!(sideW > 0 && sideH > 0 && wallW > 0 && wallH > 0)) return null;
      const totalSqFt = Math.round((2 * sideW * sideH + 2 * wallW * wallH) / 144);
      return {
        source: "genie",
        sideW,
        sideH,
        frontW: wallW,
        frontH: wallH,
        backW: wallW,
        backH: wallH,
        totalSqFt,
      };
    }

    const panels: any[] = Array.isArray(d.panels) ? d.panels : [];
    const find = (re: RegExp) => panels.find((p) => re.test(`${p.panelKey || ""} ${p.label || ""}`.toLowerCase()));
    const side = find(/driver|(^|[^a-z])side/);
    const hood = find(/hood/);
    const roof = find(/roof|top/);
    const rear = find(/rear|back/);
    const front = find(/front/);
    if (!side?.widthInches) return null;
    const out: any = { source: "genie", sideW: side.widthInches, sideH: side.heightInches };
    if (hood?.widthInches) { out.hoodW = hood.widthInches; out.hoodL = hood.heightInches; }
    if (roof?.widthInches) { out.roofW = roof.widthInches; out.roofL = roof.heightInches; }
    if (rear?.widthInches) { out.backW = rear.widthInches; out.backH = rear.heightInches; }
    if (front?.widthInches) { out.frontW = front.widthInches; out.frontH = front.heightInches; }
    if (d.totalSqFt) out.totalSqFt = d.totalSqFt;
    return out;
  } catch { return null; }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-worker-secret",
};

const PROOF_EXAMPLES = ["genie-examples/van-proof-sheet.png", "genie-examples/car-proof-sheet.png"];

const _pool: string[] = [];
let _loaded = false;
let _idx = 0;
function _load() {
  if (_loaded) return;
  const p = Deno.env.get("GOOGLE_AI_API_KEY");
  if (p) _pool.push(p);
  for (let i = 2; i <= 5; i++) { const k = Deno.env.get(`GOOGLE_AI_API_KEY_${i}`); if (k) _pool.push(k); }
  _loaded = true;
}
function getKey(): string { _load(); if (!_pool.length) throw new Error("No GOOGLE_AI_API_KEY"); const k = _pool[_idx % _pool.length]; _idx++; return k; }
function hasKey(): boolean { _load(); return _pool.length > 0; }

// SINGLE-PASS, like the panelizer-os fix (2026-07-22). The chunked
// String.fromCharCode + string-concat form copies the growing string on every
// chunk — O(n^2) bytes moved — and is the documented cause of this project's
// prior 546s. Under the per-request CPU budget it is also what starved
// proof.build: five straight "CPU Time exceeded" kills on run 400b63e3
// (2026-08-04), each landing right after sheet composition once the budget
// was already spent on these loops.
function toBase64(buf: ArrayBuffer): string {
  return encodeBase64(new Uint8Array(buf));
}

// Rewrite a Supabase Storage object URL to the image-transform endpoint so the
// SERVER returns a pre-downscaled copy. This is the 546 fix: 7 full 4K renders
// base64-encode to a ~40MB Gemini request body (stringified up to 4 retry
// attempts), which blows the 256MB worker. Gemini downscales >2K inputs anyway,
// so sending ~1600px copies loses nothing. Same transform path used by
// generate-artboard-flat and panel-extract-v2. Non-storage URLs pass through.
function toThumbUrl(url: string, w = 1280): string {
  if (!url || !url.includes("/storage/v1/object/")) return url;
  const rendered = url.replace("/storage/v1/object/", "/storage/v1/render/image/");
  const sep = rendered.includes("?") ? "&" : "?";
  // width + height + resize=contain is mandatory: a width-only transform is
  // served as a cover-crop against a default tall frame (vertical slivers),
  // which feeds Gemini distorted reference views.
  return `${rendered}${sep}width=${w}&height=${w}&resize=contain&quality=80`;
}

async function fetchImg(url: string): Promise<{ b64: string; mime: string } | null> {
  try {
    let r = await fetch(toThumbUrl(url), { headers: { "User-Agent": "Deno/1.0" }, signal: AbortSignal.timeout(15000) });
    // If the transform endpoint is unavailable for this object, fall back to
    // the original — one full-size image won't crash the worker on its own.
    if (!r.ok) r = await fetch(url, { headers: { "User-Agent": "Deno/1.0" }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    return { b64: toBase64(await r.arrayBuffer()), mime: r.headers.get("content-type") || "image/jpeg" };
  } catch { return null; }
}

// ── Authoritative GENIE size band ───────────────────────────────────
// Gemini hallucinates the dimension numbers it draws on the proof (e.g. it
// labels a 260.6" side as 120.90"). So after the proof is generated we STAMP
// the exact GENIE Universal Panelizer sizes (from panelizer-step-validate /
// resolveGenieDims) as a deterministic band beneath the proof — the numbers
// can never drift from the print panels because they come from the same source.
const FONT_URL = "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf";
let _fontBytes: Uint8Array | null = null;
async function getFont(): Promise<Uint8Array> {
  if (!_fontBytes) { const r = await fetch(FONT_URL); _fontBytes = new Uint8Array(await r.arrayBuffer()); }
  return _fontBytes;
}
const fmtIn = (n: number): string => (Math.round(Number(n) * 10) / 10).toString();

// Returns PNG bytes of the proof with a GENIE-sizes band appended at the bottom.
// Throws on any failure so the caller can fall back to the original image.
// 5" bleed on EVERY edge — the print panel is the trim size + 5" all around,
// i.e. +10" to each dimension. The proof shows BOTH so the shop sees the
// finished (trim) size and the actual printed size with bleed.
async function fingerprintBase64(data: string): Promise<{ sha256: string; bytes: number }> {
  // SINGLE-PASS DECODE. The previous form was `atob()` followed by
  // `Uint8Array.from(binary, (c) => c.charCodeAt(0))` — a per-CHARACTER JS
  // callback over the whole base64 string. Seven views at a few MB each is on
  // the order of 18 MILLION callback invocations per attempt, and this runs
  // ONLY on the workflow path (isRevisionNormalProofRequest requires a pack
  // artifact scope). That asymmetry is the whole mystery of 2026-08-04: a
  // DIRECT call with identical views and the TEXT LOCK engaged returned 200 in
  // 49.7s, while every workflow attempt died with "CPU Time exceeded" — the
  // direct call never fingerprints. Reducing the sheet width did not help
  // because the sheet was never the sink.
  const bytes = decodeBase64(data);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return {
    sha256: Array.from(digest).map((value) => value.toString(16).padStart(2, "0")).join(""),
    bytes: bytes.byteLength,
  };
}

function canonicalizeProofMaterial(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeProofMaterial);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalizeProofMaterial(item)]),
    );
  }
  return value;
}

async function sha256CanonicalProofMaterial(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify(canonicalizeProofMaterial(value)),
  );
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes),
  );
  return Array.from(digest)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256ProofText(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    ),
  );
  return Array.from(digest)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function storageObjectMissing(error: unknown): boolean {
  const candidate = (error || {}) as {
    message?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  const status = Number(candidate.statusCode || candidate.status || 0);
  const message = String(candidate.message || "");
  return (
    status === 404 ||
    (status === 400 && /not[\s_-]*found|does not exist/i.test(message))
  );
}

function canonicalSourceUrl(value: unknown): string | null {
  try {
    const parsed = new URL(String(value || "").trim());
    if (
      !["https:", "http:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function strongestSourceValidator(
  headers: Headers,
): { validatorKind: string; validator: string } | null {
  for (const validatorKind of [
    "x-goog-generation",
    "x-amz-version-id",
    "x-ms-version-id",
  ]) {
    const validator = String(headers.get(validatorKind) || "").trim();
    if (validator && validator.toLowerCase() !== "null") {
      return { validatorKind, validator };
    }
  }
  const etag = String(headers.get("etag") || "").trim();
  if (etag && !/^W\//i.test(etag)) {
    return { validatorKind: "etag", validator: etag };
  }
  return null;
}

async function attestDurableProofSource(
  expected: {
    url: string;
    validatorKind: string;
    validator: string;
    contentLength: number;
  },
): Promise<{ ok: true } | { ok: false; reason: string; retryable: boolean }> {
  try {
    const response = await fetch(expected.url, {
      method: "HEAD",
      redirect: "error",
      cache: "no-store",
      headers: {
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      return {
        ok: false,
        reason: `HEAD returned HTTP ${response.status}`,
        retryable:
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500,
      };
    }
    const observed = strongestSourceValidator(response.headers);
    const observedLength = Number(
      response.headers.get("content-length") || 0,
    );
    const validatorKindMatches =
      expected.validatorKind === "object-version"
        ? observed?.validatorKind !== "etag"
        : observed?.validatorKind === expected.validatorKind;
    if (
      !observed ||
      !validatorKindMatches ||
      observed.validator !== expected.validator
    ) {
      return {
        ok: false,
        reason: "strong object validator changed or is unavailable",
        retryable: false,
      };
    }
    if (
      !Number.isSafeInteger(observedLength) ||
      observedLength <= 0 ||
      observedLength !== expected.contentLength
    ) {
      return {
        ok: false,
        reason: "content length changed or is unavailable",
        retryable: false,
      };
    }
    return { ok: true };
  } catch (error) {
    const timedOut =
      (error as { name?: unknown })?.name === "TimeoutError" ||
      (error as { name?: unknown })?.name === "AbortError";
    return {
      ok: false,
      reason: timedOut
        ? "source attestation timed out"
        : String((error as { message?: unknown })?.message || error),
      retryable: true,
    };
  }
}

const DURABLE_PROOF_DEFINITION_VERSION = "designpro.entice_pack.v2";

async function authorizeDurableProofProducer(
  db: ReturnType<typeof createClient>,
  context: {
    workflowRunId: string;
    enticePackId: string;
    userId: string;
    artifactAttemptId: string;
    manifestHash: string;
  },
): Promise<
  | {
      ok: true;
      stageId: string;
      revisionId: string;
      leaseToken: string;
      leaseExpiresAt: string;
      submissionHash: string;
      manifestHash: string;
    }
  | { ok: false; reason: string }
> {
  const { data, error } = await db.rpc(
    "authorize_designpro_proof_producer",
    {
      p_workflow_run_id: context.workflowRunId,
      p_entice_pack_id: context.enticePackId,
      p_user_id: context.userId,
      p_artifact_attempt_id: context.artifactAttemptId,
      p_manifest_hash: context.manifestHash,
      p_definition_version: DURABLE_PROOF_DEFINITION_VERSION,
    },
  );
  if (error) {
    return {
      ok: false,
      reason: `authorization RPC unavailable: ${error.message || "unknown error"}`,
    };
  }
  const receipt =
    Array.isArray(data) && data.length === 1 ? data[0] : data;
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const stageId = String(receipt?.stageId || "");
  const revisionId = String(receipt?.revisionId || "");
  const leaseToken = String(receipt?.leaseToken || "");
  const leaseExpiresAt = String(receipt?.leaseExpiresAt || "");
  const submissionHash = String(receipt?.submissionHash || "")
    .toLowerCase();
  const receiptManifestHash = String(receipt?.manifestHash || "")
    .toLowerCase();
  if (
    receipt?.authorized !== true ||
    !uuidPattern.test(stageId) ||
    !uuidPattern.test(revisionId) ||
    leaseToken !== context.artifactAttemptId ||
    !uuidPattern.test(leaseToken) ||
    receiptManifestHash !== context.manifestHash.toLowerCase() ||
    !/^[0-9a-f]{64}$/.test(submissionHash) ||
    !Number.isFinite(Date.parse(leaseExpiresAt)) ||
    Date.parse(leaseExpiresAt) <= Date.now()
  ) {
    return {
      ok: false,
      reason: "workflow lease identity is missing, expired, or mismatched",
    };
  }
  return {
    ok: true,
    stageId,
    revisionId,
    leaseToken,
    leaseExpiresAt,
    submissionHash,
    manifestHash: receiptManifestHash,
  };
}

async function renewDurableProofProducerFence(
  db: ReturnType<typeof createClient>,
  context: {
    workflowRunId: string;
    enticePackId: string;
    userId: string;
    artifactAttemptId: string;
    manifestHash: string;
  },
): Promise<
  | {
      ok: true;
      stageId: string;
      revisionId: string;
      leaseToken: string;
      leaseExpiresAt: string;
      submissionHash: string;
      manifestHash: string;
    }
  | { ok: false; reason: string }
> {
  const authorization =
    await authorizeDurableProofProducer(db, context);
  if (!authorization.ok) return authorization;
  const { data: heartbeatAccepted, error: heartbeatError } =
    await db.rpc("heartbeat_workflow_stage", {
      p_stage_id: authorization.stageId,
      p_lease_token: authorization.leaseToken,
      p_lease_seconds: 900,
    });
  if (heartbeatError || heartbeatAccepted !== true) {
    return {
      ok: false,
      reason: "workflow heartbeat was rejected",
    };
  }
  return authorization;
}

const BLEED_IN = 5;
/**
 * The two authoritative GENIE size-band lines. Gemini hallucinates the numbers
 * it draws, so these come from panelizer-step-validate and are DRAWN by code.
 *
 * They are returned as strings rather than stamped onto a finished image on
 * purpose: stamping meant decoding the composed sheet and re-encoding it — a
 * second full PNG round-trip in pure-JS imagescript on top of compositing every
 * tile, which is what killed the worker with a 546 on the first live per-tile
 * run (119s, version 215). composeProofSheet now draws the band in the same
 * pass, so the sheet is encoded exactly once.
 */
type GenieTrimSurface = {
  side: string;
  label: string;
  widthIn: number;
  heightIn: number;
};

/**
 * Resolve exactly the physical trim surfaces that this proof is publishing.
 * Stored corrSqFt/totalSqFt values are deliberately not inputs: the visible
 * total must be reproducible from the same per-side trim figures printed on
 * this sheet, including FRONT, and must not count an unselected surface.
 */
function genieTrimSurfaces(
  dims: any,
  expectedSurfaceSides?: unknown,
): GenieTrimSurface[] {
  const selected = new Set(
    (Array.isArray(expectedSurfaceSides) ? expectedSurfaceSides : [])
      .map((side: unknown) => String(side || "").trim().toUpperCase())
      .filter(Boolean),
  );
  const candidates: GenieTrimSurface[] = [
    { side: "DRIVER SIDE", label: "Driver", widthIn: Number(dims?.sideW), heightIn: Number(dims?.sideH) },
    { side: "PASSENGER SIDE", label: "Passenger", widthIn: Number(dims?.sideW), heightIn: Number(dims?.sideH) },
    { side: "HOOD", label: "Hood", widthIn: Number(dims?.hoodW), heightIn: Number(dims?.hoodL) },
    { side: "ROOF", label: "Roof", widthIn: Number(dims?.roofW), heightIn: Number(dims?.roofL) },
    { side: "FRONT", label: "Front", widthIn: Number(dims?.frontW), heightIn: Number(dims?.frontH) },
    { side: "REAR", label: "Rear", widthIn: Number(dims?.backW), heightIn: Number(dims?.backH) },
  ];
  return candidates.filter((surface) =>
    surface.widthIn > 0 &&
    surface.heightIn > 0 &&
    (!selected.size || selected.has(surface.side))
  );
}

function genieTotalSqFt(dims: any, expectedSurfaceSides?: unknown): number {
  const sqIn = genieTrimSurfaces(dims, expectedSurfaceSides)
    .reduce(
      (total, surface) =>
        total + surface.widthIn * surface.heightIn,
      0,
    );
  return sqIn > 0 ? Math.round((sqIn / 144) * 10) / 10 : 0;
}

function buildGenieSizeBandLines(
  dims: any,
  expectedSurfaceSides?: unknown,
): string[] {
  const surfaces = genieTrimSurfaces(dims, expectedSurfaceSides);
  if (!surfaces.length) return [];
  const b = BLEED_IN * 2; // +10" total per dimension (5" each edge)
  const compact: Array<{
    label: string;
    widthIn: number;
    heightIn: number;
  }> = [];
  const driver = surfaces.find((surface) => surface.side === "DRIVER SIDE");
  const passenger = surfaces.find(
    (surface) => surface.side === "PASSENGER SIDE",
  );
  if (
    driver &&
    passenger &&
    driver.widthIn === passenger.widthIn &&
    driver.heightIn === passenger.heightIn
  ) {
    compact.push({
      label: "Driver/Passenger",
      widthIn: driver.widthIn,
      heightIn: driver.heightIn,
    });
  } else {
    for (const surface of [driver, passenger]) {
      if (surface) compact.push(surface);
    }
  }
  compact.push(
    ...surfaces.filter(
      (surface) =>
        surface.side !== "DRIVER SIDE" &&
        surface.side !== "PASSENGER SIDE",
    ),
  );

  const trimParts = compact.map(
    (surface) =>
      `${surface.label} ${fmtIn(surface.widthIn)}" x ${fmtIn(surface.heightIn)}"`,
  );
  const printParts = compact.map(
    (surface) =>
      `${surface.label} ${fmtIn(surface.widthIn + b)}" x ${fmtIn(surface.heightIn + b)}"`,
  );
  const sqft = genieTotalSqFt(dims, expectedSurfaceSides);
  trimParts.push(`TOTAL ${fmtIn(sqft)} sq ft FROM TRIM`);

  // Three surface figures per line remain readable on the 1800px proof. The
  // compositor accepts an arbitrary line count and grows the band accordingly.
  const lines = (prefix: string, parts: string[]) => {
    const output: string[] = [];
    for (let index = 0; index < parts.length; index += 3) {
      output.push(
        `${prefix}${index ? " (CONT.)" : ""}   ${parts.slice(index, index + 3).join("    |    ")}`,
      );
    }
    return output;
  };
  return [
    ...lines("TRIM SIZE", trimParts),
    ...lines('PRINT SIZE — 5" BLEED EACH EDGE', printParts),
  ];
}

const FROZEN_DIMENSION_PAIRS = [
  ["sideW", "sideH"],
  ["hoodW", "hoodL"],
  ["roofW", "roofL"],
  ["frontW", "frontH"],
  ["backW", "backH"],
] as const;

/**
 * Validate the internal manifest-bound dimension shortcut before GENIE is
 * skipped. Browser callers still go through GENIE; the server orchestrator may
 * reuse only the exact, already-verified numeric shape from its manifest stage.
 */
function frozenDimensionError(value: unknown, isTrailer: boolean): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "dimensions must be an object";
  }
  const dimensions = value as Record<string, unknown>;
  const allowed = new Set([
    ...FROZEN_DIMENSION_PAIRS.flatMap(([width, height]) => [width, height]),
    "corrSqFt",
    "totalSqFt",
  ]);
  const unknown = Object.keys(dimensions).filter((key) => !allowed.has(key));
  if (unknown.length) return `unsupported dimension keys: ${unknown.join(", ")}`;

  for (const [widthKey, heightKey] of FROZEN_DIMENSION_PAIRS) {
    const hasWidth = Object.prototype.hasOwnProperty.call(dimensions, widthKey);
    const hasHeight = Object.prototype.hasOwnProperty.call(dimensions, heightKey);
    if (hasWidth !== hasHeight) {
      return `${widthKey}/${heightKey} must be supplied together`;
    }
    if (!hasWidth) continue;
    const width = dimensions[widthKey];
    const height = dimensions[heightKey];
    if (
      typeof width !== "number" ||
      typeof height !== "number" ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0 ||
      width > 1000 ||
      height > 300
    ) {
      return `${widthKey}/${heightKey} must be finite production dimensions`;
    }
  }

  const sideW = dimensions.sideW;
  const sideH = dimensions.sideH;
  if (
    typeof sideW !== "number" ||
    typeof sideH !== "number" ||
    sideW < 80 ||
    sideW > (isTrailer ? 636 : 400) ||
    sideH < 24 ||
    sideH > (isTrailer ? 144 : 130)
  ) {
    return "sideW/sideH are outside the supported production range";
  }
  if (
    isTrailer &&
    (!Object.prototype.hasOwnProperty.call(dimensions, "frontW") ||
      !Object.prototype.hasOwnProperty.call(dimensions, "backW"))
  ) {
    return "trailer frozen dimensions require front and rear wall sizes";
  }
  for (const coverageKey of ["corrSqFt", "totalSqFt"]) {
    if (!Object.prototype.hasOwnProperty.call(dimensions, coverageKey)) continue;
    const coverage = dimensions[coverageKey];
    if (
      typeof coverage !== "number" ||
      !Number.isFinite(coverage) ||
      coverage <= 0 ||
      coverage > 100_000
    ) {
      return `${coverageKey} must be a finite positive number`;
    }
  }
  return null;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const configuredWorkerSecret = Deno.env.get("WORKER_SECRET") || "";
    const auth = req.headers.get("Authorization");
    const bearer = String(auth || "").replace(/^Bearer\s+/i, "").trim();
    const workerSecret = String(req.headers.get("x-worker-secret") || "").trim();
    if (!serviceRoleKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Proof service is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);
    const isService =
      (!!bearer && bearer === serviceRoleKey) ||
      (!!configuredWorkerSecret && workerSecret === configuredWorkerSecret);
    let callerUserId = "";
    let callerEmail = "";
    if (!isService) {
      if (!bearer) {
        return new Response(
          JSON.stringify({ success: false, error: "Authentication required" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const {
        data: { user: caller },
        error: callerError,
      } = await db.auth.getUser(bearer);
      if (callerError || !caller) {
        return new Response(
          JSON.stringify({ success: false, error: "Authentication required" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      callerUserId = caller.id;
      callerEmail = String(caller.email || "").trim().toLowerCase();
    }
    if (!hasKey()) return new Response(JSON.stringify({ success: false, error: "No Gemini key" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json();
    let { allViewUrls, sideUrl, vehicleYear, vehicleMake, vehicleModel, vehicleType, bodyText, designName, finish, shopName, dimensions, revisionNote, previousProofUrl, stripBranding, designiqGenerationId, artboardOnly, artboardVariant, surfaceSide, surfaceViewUrl, deferArtboards, persistCanonical = true, userId, workflowRunId, enticePackId, dimensionsFrozen, manifestHash, geminiKeySlot, artifactAttemptId, idempotencyKey, sourceEvidence, surfaceMasterContractVersion, expectedSurfaceSides, designAnchorViewKey } = body;
    const requestedKeySlot = Number(geminiKeySlot);
    const trustedKeySlot =
      isService &&
      Number.isInteger(requestedKeySlot) &&
      requestedKeySlot >= 0 &&
      requestedKeySlot <= 4
        ? requestedKeySlot
        : null;
    let keySlotOffset = 0;
    const nextGeminiKey = (): string => {
      if (trustedKeySlot === null) return getKey();
      _load();
      if (!_pool.length) throw new Error("No GOOGLE_AI_API_KEY");
      const key = _pool[(trustedKeySlot + keySlotOffset) % _pool.length];
      keySlotOffset += 1;
      return key;
    };
    // MEMORY SPLIT: which artboard pass(es) this artboardOnly call should emit.
    // "clean" or "branded" runs exactly ONE Gemini image pass so a single worker
    // never holds two image generations at once (the 546 / WORKER_RESOURCE_LIMIT
    // OOM). Omitted → both passes (legacy artboardOnly callers keep working).
    const _artboardVariant = String(artboardVariant || "").trim().toLowerCase();
    const explicitVehicleType = String(vehicleType || "").trim().toLowerCase();
    // The explicit contract wins. The word-boundary fallback keeps old trailer
    // callers safe until every legacy producer passes vehicleType.
    const isTrailer = explicitVehicleType === "trailer" ||
      (!explicitVehicleType && /\btrailer\b/i.test(`${vehicleMake || ""} ${vehicleModel || ""}`));

    // Server-only, manifest-bound surface-master mode. This is additive: legacy
    // proof and artboard callers retain their existing behavior.
    const SURFACE_MASTER_CONTRACT =
      "generate-2d-proof.call8-surface-master-2026-07-29";
    const SURFACE_BUCKET: Record<string, string> = {
      "driver-side": "side",
      "passenger-side": "passenger",
      hood: "hood",
      roof: "roof",
      front: "front",
      rear: "rear",
    };
    const requestedSurface = String(surfaceSide || "").trim().toLowerCase();
    const requestedSurfaceUrl = String(surfaceViewUrl || "").trim();
    const isSurfaceMasterRequest = !!(requestedSurface || requestedSurfaceUrl);
    if (
      isSurfaceMasterRequest &&
      (!isService ||
        artboardOnly !== true ||
        _artboardVariant !== "branded" ||
        persistCanonical !== false ||
        !SURFACE_BUCKET[requestedSurface] ||
        !requestedSurfaceUrl)
    ) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid surface master contract",
          code: "invalid_surface_master_contract",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const requestedSurfaceMasterContractVersion = String(
      surfaceMasterContractVersion || "",
    ).trim();
    if (
      isSurfaceMasterRequest &&
      requestedSurfaceMasterContractVersion &&
      requestedSurfaceMasterContractVersion !== SURFACE_MASTER_CONTRACT
    ) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Unsupported surface master contract version",
          code: "surface_master_contract_version_mismatch",
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (
      isSurfaceMasterRequest &&
      isTrailer &&
      (requestedSurface === "hood" || requestedSurface === "roof")
    ) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Surface is not present in the frozen trailer manifest",
          code: "surface_not_in_manifest",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // The durable worker has already resolved and persisted this exact manifest
    // through panelizer-step-validate. It may reuse that result only under the
    // service role and with a SHA-256 manifest binding. Merely setting these
    // fields from a browser can never bypass GENIE.
    const requestedFrozenDimensions = dimensionsFrozen === true;
    const trustedFrozenDimensions =
      isService &&
      requestedFrozenDimensions &&
      /^[0-9a-f]{64}$/i.test(String(manifestHash || ""));
    if (isSurfaceMasterRequest && !trustedFrozenDimensions) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Surface masters require frozen manifest-bound GENIE dimensions",
          code: "surface_master_frozen_dimensions_required",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (isService && requestedFrozenDimensions && !trustedFrozenDimensions) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Frozen dimensions require a valid manifestHash",
          code: "invalid_frozen_dimension_contract",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (trustedFrozenDimensions) {
      const dimensionError = frozenDimensionError(dimensions, isTrailer);
      if (dimensionError) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Invalid frozen dimensions: ${dimensionError}`,
            code: "invalid_frozen_dimensions",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      console.log(
        `[2D-PROOF] Reusing manifest-bound GENIE dimensions (${String(manifestHash).slice(0, 12)}…)`,
      );
    }
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const hasPackArtifactScope =
      isService && uuidPattern.test(String(enticePackId || ""));
    const trustedArtifactAttempt =
      isService && uuidPattern.test(String(artifactAttemptId || ""))
        ? String(artifactAttemptId)
        : "";
    const trustedEnticePackId = hasPackArtifactScope
      ? String(enticePackId).toLowerCase()
      : "";
    const trustedDurableUserId =
      isService && uuidPattern.test(String(userId || ""))
        ? String(userId).toLowerCase()
        : "";
    const trustedWorkflowRunId =
      isService && uuidPattern.test(String(workflowRunId || ""))
        ? String(workflowRunId).toLowerCase()
        : "";
    if (hasPackArtifactScope && !trustedArtifactAttempt) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Revision artifacts require a fenced attempt identity",
          code: "artifact_attempt_required",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (
      isSurfaceMasterRequest &&
      (!hasPackArtifactScope || !trustedArtifactAttempt)
    ) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Surface masters require a fenced pack and attempt identity",
          code: "surface_master_fence_required",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const isRevisionNormalProofRequest =
      isService &&
      hasPackArtifactScope &&
      !!trustedArtifactAttempt &&
      trustedFrozenDimensions &&
      !isSurfaceMasterRequest &&
      artboardOnly !== true &&
      stripBranding !== true &&
      deferArtboards === true &&
      persistCanonical === false;
    if (
      isRevisionNormalProofRequest &&
      (!trustedWorkflowRunId || !trustedDurableUserId)
    ) {
      return new Response(
        JSON.stringify({
          success: false,
          error:
            "Durable normal proofs require a workflow run and tenant identity",
          code: "normal_proof_workflow_identity_required",
          retryable: false,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (isRevisionNormalProofRequest) {
      const authorization = await authorizeDurableProofProducer(db, {
        workflowRunId: trustedWorkflowRunId,
        enticePackId: trustedEnticePackId,
        userId: trustedDurableUserId,
        artifactAttemptId: trustedArtifactAttempt,
        manifestHash: String(manifestHash).toLowerCase(),
      });
      if (!authorization.ok) {
        return new Response(
          JSON.stringify({
            success: false,
            error:
              `Durable proof producer authorization failed: ${authorization.reason}`,
            code: "normal_proof_producer_fence_lost",
            retryable: true,
            retryAfterSeconds: 30,
          }),
          {
            status: 503,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
              "Retry-After": "30",
            },
          },
        );
      }
    }

    // Resolve per-side dims from GENIE (the SAME panelizer-step-validate source
    // the print panels are fed), so the proof's per-side dimension callouts MATCH
    // the panels exactly. The only skip is the service-authenticated,
    // manifest-bound contract above; all legacy and browser calls retain GENIE.
    if (!trustedFrozenDimensions && vehicleYear && vehicleMake && vehicleModel) {
      // Args are (make, model, year) — keep this order. Passing them scrambled
      // (year, make, model) made panelizer-step-validate look up make="2020",
      // model="Cadillac", which never matched the vehicle_dimensions table, sent
      // garbage to Google grounding, and stamped wrong/blank dims on the proof.
      const genie = await resolveGenieDims(
        vehicleMake,
        vehicleModel,
        String(vehicleYear),
        isTrailer,
        String(bodyText || designName || ""),
      );
      if (genie?.sideW) {
        dimensions = { ...(dimensions || {}), ...genie };
        console.log(`[2D-PROOF] GENIE dims: side ${genie.sideW}"x${genie.sideH}", hood ${genie.hoodW || "?"}, roof ${genie.roofW || "?"}, rear ${genie.backW || "?"}`);
      }
    }
    // Trailers never carry car-only tokens. A single verified rear-wall size is
    // also the front-wall size for the flat enclosed body.
    if (isTrailer && dimensions) {
      dimensions = { ...dimensions };
      delete dimensions.hoodW;
      delete dimensions.hoodL;
      delete dimensions.roofW;
      delete dimensions.roofL;
      if (!dimensions.frontW && dimensions.backW) {
        dimensions.frontW = dimensions.backW;
        dimensions.frontH = dimensions.backH;
      }
      if (!dimensions.backW && dimensions.frontW) {
        dimensions.backW = dimensions.frontW;
        dimensions.backH = dimensions.frontH;
      }
    }

    if (!dimensions || !dimensions.sideW) {
      if (vehicleYear && vehicleMake && vehicleModel) {
        const specs = resolveVehicleSpecs(String(vehicleYear), vehicleMake, vehicleModel);
        if (specs.source !== "none") {
          dimensions = specs;
          console.log(`[2D-PROOF] Resolved vehicle dimensions from DB (${specs.source}): ${specs.sideW}"x${specs.sideH}" side`);
        }
      }
    }

    // ── CONSISTENCY GATE: never stamp INSANE dimensions ─────────────
    // A vehicle wrap side is physically ~80–400" long and ~24–130" tall. If the
    // resolved/client dims fall outside that, they're garbage — almost always a
    // missing/"unknown" vehicle model that GENIE couldn't resolve (this is exactly
    // how #34934 got a 39.79" side). Drop the bad dims so the proof renders WITHOUT
    // dimension callouts instead of stamping wrong sizes that mis-scale the panels.
    const _saneSide = (w: any, h: any) =>
      Number(w) >= 80 &&
      Number(w) <= (isTrailer ? 636 : 400) &&
      Number(h) >= 24 &&
      Number(h) <= (isTrailer ? 144 : 130);
    let dimsResolved = !!(dimensions && dimensions.sideW);
    if (dimensions?.sideW && !_saneSide(dimensions.sideW, dimensions.sideH)) {
      console.warn(`[2D-PROOF] GATE: rejecting insane dims side ${dimensions.sideW}"x${dimensions.sideH}" for vehicle="${[vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(" ") || "unknown"}" — set the real vehicle make+model. Proof will render without size callouts rather than stamp garbage.`);
      dimensions = null;
      dimsResolved = false;
    }

    // Always calculate coverage from the exact selected trim rectangles that
    // this proof will draw. A stored aggregate may be rounded, stale, include
    // an unselected surface, or omit FRONT; none of those can truthfully label
    // the production proof.
    if (dimensions?.sideW) {
      const calculatedSqFt = genieTotalSqFt(
        dimensions,
        expectedSurfaceSides,
      );
      if (calculatedSqFt > 0) {
        dimensions.totalSqFt = calculatedSqFt;
        dimensions.corrSqFt = calculatedSqFt;
        console.log(
          `[2D-PROOF] Calculated trim coverage: ${calculatedSqFt} sq ft`,
        );
      }
    }

    // Collect view URLs — send ALL available views so Gemini can paint each
    // panel from its corresponding render instead of hallucinating the other
    // angles from a single side view. Each view is fetched DOWNSCALED (see
    // fetchImg → downscaleStorageUrl): a full 4K PNG would OOM/CPU-kill the
    // 256MB worker (status 546) once 6+ views are encoded at once.
    const urls: Record<string, string> = allViewUrls || {};
    if (sideUrl && !urls.side) urls.side = sideUrl;
    const urlEntries = Object.entries(urls).filter(([, u]) => u);
    if (!urlEntries.length) return new Response(JSON.stringify({ success: false, error: "No render URLs" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Pick exactly one render per canonical proof panel. This replaced a
    // priority-sort + .slice(0,7) that silently dropped the ROOF view (the
    // 7th canonical view): roof ranked near the bottom, so any extra/aliased
    // label or the validation-only close-up shot bumped it past the cap.
    //
    // Close-up / macro shots are quality-validation only — they are never a
    // printed proof panel (the layout prompt below has no close-up slot), so
    // they must not consume a panel slot. NOTE: do not exclude on "detail" —
    // the canonical hood view is labelled "hood_detail".
    const isExcluded = (t: string) => /close|macro|zoom/.test(t);
    const STANDARD_PANEL_BUCKETS: Array<{ key: string; match: (t: string) => boolean }> = [
      { key: "side", match: (t) => (t.includes("side") || t.includes("driver") || t.includes("left")) && !t.includes("passenger") },
      { key: "passenger", match: (t) => t.includes("passenger") },
      { key: "hood", match: (t) => t.includes("hood") },
      { key: "front", match: (t) => t.includes("front") || t.includes("hero") },
      { key: "rear", match: (t) => t.includes("rear") || t.includes("back") },
      { key: "roof", match: (t) => t.includes("roof") || t.includes("top") },
    ];
    const TRAILER_PANEL_KEYS = new Set(["side", "passenger", "front", "rear"]);
    const PANEL_BUCKETS = isTrailer
      ? STANDARD_PANEL_BUCKETS.filter((bucket) => TRAILER_PANEL_KEYS.has(bucket.key))
      : STANDARD_PANEL_BUCKETS;
    const picked = new Map<string, [string, string]>();
    for (const [type, url] of urlEntries) {
      const lt = type.toLowerCase();
      if (isExcluded(lt)) continue;
      const bucket = PANEL_BUCKETS.find((b) => b.match(lt));
      if (bucket && !picked.has(bucket.key)) picked.set(bucket.key, [type, url]);
    }
    // Canonical order (roof guaranteed present when a roof render exists).
    let sortedEntries = PANEL_BUCKETS
      .map((b) => picked.get(b.key))
      .filter((e): e is [string, string] => !!e);
    // Fallback: unrecognised labels — keep only the number of printable surfaces
    // for this vehicle class so a trailer can never grow a roof/hood tile.
    if (!sortedEntries.length) sortedEntries = urlEntries.slice(0, PANEL_BUCKETS.length);
    // An artboard edit consumes only the canonical driver-side render. The
    // other views and proof-layout example were discarded before the edit call,
    // so fetching them added latency and edge-memory pressure without affecting
    // the output. Legacy proof generation still loads the complete surface set.
    if (artboardOnly) {
      const surfaceEntry: [string, string] | undefined = isSurfaceMasterRequest
        ? [requestedSurface, requestedSurfaceUrl]
        : (picked.get("side") || sortedEntries[0]);
      sortedEntries = surfaceEntry ? [surfaceEntry] : [];
    }

    let surfaceInputFingerprint: { sha256: string; bytes: number } | null = null;

    const vehicleName = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(" ");
    const baseUrl = Deno.env.get("SUPABASE_URL")!;

    // Fetch layout example first, then render views SEQUENTIALLY.
    // Promise.all() on 7 4K images spikes memory to 100MB+ and crashes
    // the Deno worker. Sequential fetch keeps peak memory ~15-20MB.
    const exampleUrl = `${baseUrl}/storage/v1/object/public/wrap-files/${PROOF_EXAMPLES[0]}`;
    // The current example is a car sheet with hood/roof slots. It is useful for
    // standard vehicles but would teach Gemini to invent those slots on a trailer.
    const exampleImg = isTrailer || artboardOnly ? null : await fetchImg(exampleUrl);

    const views: Array<{ type: string; img: { b64: string; mime: string } }> = [];
    for (const [type, url] of sortedEntries) {
      const img = await fetchImg(url);
      if (img) views.push({ type, img });
    }
    if (isSurfaceMasterRequest && views[0]?.img?.b64) {
      surfaceInputFingerprint = await fingerprintBase64(views[0].img.b64);
    }
    if (!views.length) return new Response(JSON.stringify({ success: false, error: "Could not fetch renders" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Build dimensions text
    let dimText = "";
    let totalSqFt = "";
    if (dimensions) {
      const d: string[] = [];
      if (dimensions.sideW && dimensions.sideH) d.push(`Side Panel: ${dimensions.sideW}" W x ${dimensions.sideH}" H`);
      if (dimensions.hoodW && dimensions.hoodL) d.push(`Hood: ${dimensions.hoodW}" W x ${dimensions.hoodL}" L`);
      if (dimensions.roofW && dimensions.roofL) d.push(`Roof: ${dimensions.roofW}" W x ${dimensions.roofL}" L`);
      if (dimensions.frontW && dimensions.frontH) d.push(`Front: ${dimensions.frontW}" W x ${dimensions.frontH}" H`);
      if (dimensions.backW && dimensions.backH) d.push(`Rear: ${dimensions.backW}" W x ${dimensions.backH}" H`);
      if (d.length) dimText = "\n\nEXACT PANEL DIMENSIONS (use for dimension lines):\n" + d.join("\n");
      if (dimensions.corrSqFt || dimensions.totalSqFt) {
        totalSqFt = `\nTOTAL COVERAGE: ${dimensions.corrSqFt || dimensions.totalSqFt} sq ft — display this prominently on the proof`;
      }
    }

    // TRUE-RATIO TEMPLATES — map the GENIE per-side dimension tokens straight into
    // the layout so each view's vehicle silhouette is drawn at the vehicle's REAL
    // width:height proportions, never a generic square or 16:9 block. The proof is
    // built to scale from the actual truck geometry so the downstream 1:1 slicer
    // crops true-proportioned panels.
    let ratioText = "";
    if (dimensions) {
      const ratio = (w: any, h: any) => {
        const a = Number(w), b = Number(h);
        return (a > 0 && b > 0) ? (Math.round((a / b) * 100) / 100).toString() : null;
      };
      const r: string[] = [];
      const sr = ratio(dimensions.sideW, dimensions.sideH);
      const hr = ratio(dimensions.hoodW, dimensions.hoodL);
      const rr = ratio(dimensions.roofW, dimensions.roofL);
      const fr = ratio(dimensions.frontW, dimensions.frontH);
      const br = ratio(dimensions.backW, dimensions.backH);
      if (sr) r.push(`driver & passenger side ${dimensions.sideW}" x ${dimensions.sideH}" (width:height ${sr}:1)`);
      if (hr) r.push(`hood ${dimensions.hoodW}" x ${dimensions.hoodL}" (${hr}:1)`);
      if (rr) r.push(`roof ${dimensions.roofW}" x ${dimensions.roofL}" (${rr}:1)`);
      if (fr) r.push(`front ${dimensions.frontW}" x ${dimensions.frontH}" (${fr}:1)`);
      if (br) r.push(`rear ${dimensions.backW}" x ${dimensions.backH}" (${br}:1)`);
      if (r.length) {
        ratioText = `\n\nTRUE-RATIO TEMPLATES (CRITICAL — draw each view to the vehicle's REAL proportions, never a generic square or 16:9 box): ${r.join("; ")}. Each silhouette's width-to-height ratio MUST match these GENIE panel dimensions exactly so the proof is to scale.`;
      }
    }

    // Build prompt + parts
    const viewList = views.map(v => `- ${v.type}`).join("\n");
    // The 2D Production Proof is generated for EVERY tenant/subscription — only
    // the TEMPLATE branding differs: WPW orders carry the WePrintWraps template,
    // everything else keeps the DesignProAI / RestyleProAI branding.
    const isWpw = /weprint\s*wraps|wpw/i.test(String(shopName || ""));
    const brandTitle = isWpw ? "WePrintWraps — 2D Production Proof" : "DesignProAI™ — 2D Production Proof";
    const brandSite = isWpw ? "WePrintWraps.com" : "RestyleProAI.com";
    const requiredPanelNames = isTrailer
      ? "driver side, passenger side, front, and rear"
      : "driver side, passenger side, roof/top, front, and rear";
    const trailerNoRoofInstruction = isTrailer
      ? " This is an enclosed trailer: do not create hood, roof, top, bumper, or close-up proof tiles."
      : "";
    const sourcePanelInstructions = isTrailer
      ? `- Driver/side panel → use the "side" (or "driver") render
- Passenger panel → use the "passenger" render
- Front wall panel → use the "front" render
- Rear wall/door panel → use the "rear" or "back" render
- TRAILER RULE: create exactly these four printable surfaces. Do not create hood, roof/top, bumper, or close-up tiles.`
      : `- Driver/side panel → use the "side" (or "driver") render
- Passenger panel → use the "passenger" render (mirror the side if no passenger render was provided)
- Roof panel → use the "roof" or "top" render
- Hood panel → use the "hood" render
- Front panel → use the "front" or "hero" render
- Rear panel → use the "rear" or "back" render`;
    const dimensionInstruction = dimensions?.sideW
      ? "Dimension lines with arrows must use only the exact GENIE measurements supplied below."
      : "GENIE dimensions were not resolved. Do not draw, guess, or invent any numeric measurements or dimension labels.";
    const layoutInstructions = isTrailer
      ? `- Driver side view (largest, left side)
- Passenger side view (below or beside it)
- Front wall view (front-on)
- Rear wall/door view (rear-on)
- MANDATORY: exactly four printable trailer tiles: driver, passenger, FRONT, rear
- No hood, roof/top, bumper, or close-up tile
- ${dimensionInstruction}`
      : `- Driver side view (largest, left side) — with dimension lines showing width and height
- Passenger side view (below or beside it) — with dimension lines. CRITICAL: the passenger side is the MIRROR IMAGE of the driver side — the vehicle faces the OPPOSITE direction (if the driver view's nose points right, the passenger view's nose points left). Never paint the same-facing driver silhouette twice.
- Top/roof view (upper right) — overhead with dimension lines
- Front view (lower center-left) — front-on with dimension lines
- Rear view (lower right) — rear with dimension lines
- MANDATORY: the sheet MUST include a dedicated FRONT view tile. All required views must appear: driver side, passenger side, top/roof, FRONT, and rear.
- ${dimensionInstruction}`;
    const surfaceIntegrityInstruction = isTrailer
      ? "Each trailer wall must keep the design from its own matching render; never substitute one wall for another."
      : "Each panel must keep its OWN design from its OWN render (for example, a stars-only roof stays stars-only and a navy rear stays navy); do not copy the side design onto the roof, hood, or rear.";
    const prompt = `Create a professional 2D design proof sheet for a ${vehicleName} vehicle wrap.

BRANDING — LOCKED STYLING (must be identical on every proof):
- Top header bar: PURE WHITE background (#FFFFFF), BLACK text (#000000)
  - Line 1 (large, bold): "${brandTitle}"
  - Line 2 (smaller, regular weight): "Vehicle: ${vehicleName}  |  Design: "${designName || "Custom Design"}"  |  Finish: ${finish || "Gloss"}"${totalSqFt ? `  |  Coverage: ${dimensions.corrSqFt || dimensions.totalSqFt} sq ft` : ""}
- Bottom footer bar: PURE WHITE background (#FFFFFF), BLACK text (#000000)
  - "Approved By: ____________  Signature: ____________  Date: ____________  |  ${brandSite}"
- The header and footer must ALWAYS be white with black text — NEVER pick up colors from the wrap design
- DO NOT include any other company name, order number, or shop name
- DO NOT copy text from the example image — use ONLY the branding text above

CRITICAL — FLAT 2D ELEVATIONS ONLY (this is a PRINT PROOF, not a photo collage):
The attached renders are 3D STUDIO PHOTOGRAPHS — they are the source of the wrap
DESIGN only. REDRAW every panel as a FLAT, ORTHOGRAPHIC 2D ELEVATION: a flat
technical outline of the ${isTrailer ? "trailer side/front/rear walls" : "vehicle side/top/front/rear"} drawn directly on the white
sheet, with the wrap design painted onto that flat silhouette. Every panel is a
flat technical drawing — zero perspective, zero 3D depth, no studio room, no
floor, no ground shadows, no reflections. Pasting or reproducing the 3D
photograph itself into a panel is WRONG.

CRITICAL — MATCH THE ATTACHED RENDERS' DESIGN EXACTLY:
The 3D renders below are the SOURCE OF TRUTH for the wrap design. For every
panel in the proof sheet, paint the wrap using the SAME colors, logos, text,
imagery, and graphic layout shown in the corresponding 3D render view.
${sourcePanelInstructions}
DO NOT invent, substitute, or simplify any graphic, logo, wording, or color.
PALETTE LOCK: use ONLY colors that actually appear in the attached renders —
sample them exactly. If the wrap is a light aqua/mint, paint that exact light
aqua/mint; NEVER swap in a deeper, brighter, or more "typical" color for the
industry (no generic blue swooshes on a dental wrap, no generic red flames on
a hot-rod wrap). A proof whose colors read differently from the renders is
WRONG.
LOGO LOCK: copy the company logo and lettering GLYPH-FOR-GLYPH — the same
words, the same tagline, the same font style, the same colors, and the SAME
arrangement (a horizontal lockup stays horizontal, a stacked lockup stays
stacked). Never redesign, restack, abbreviate, re-font, or drop any part of
the lockup (taglines included).
COPY, DO NOT REDESIGN: trace each render's wrap artwork verbatim — the same
element positions, the same graphic routing and flow, the same imagery. Any
PHOTOGRAPHIC element in the design (a person, a product photo) stays
PHOTOGRAPHIC and identical — never converted into an illustrated character,
mascot, or drawing. "Technical drawing style" applies ONLY to the sheet itself
(white background, flat vehicle outlines, dimension lines) — the artwork inside
each outline is an exact copy of the render's design, not a re-illustration.
If the design is or contains a flag, reproduce the EXACT flag shown in that
render — its specific colors, wave/ripple, flames, distressing, star field, and
how it blends into the body color — NEVER replace it with a standard, clean, or
canonical stock flag. ${surfaceIntegrityInstruction}
If a view was not provided, leave that panel blank white rather than guessing.

ATTACHED RENDER VIEWS (in order):
${viewList}

LAYOUT (match the attached example for LAYOUT ONLY, not text or graphics):
${layoutInstructions}
- Every view shows the wrap design applied to the flat vehicle silhouette
${dimensionInstruction}
- Clean white background, professional technical drawing style
${dimText}${totalSqFt}`;

    // If this is a revision, append the fix instructions
    const revisionBlock = revisionNote
      ? `\n\nREVISION REQUEST — The previous proof had issues. Fix the following:\n${revisionNote}\nKeep everything else the same but address this specific issue.`
      : "";

    // STRIPPED (clean-background) variant: paint the wrap ARTWORK only and omit
    // every piece of WRAP branding (company logo, company name, phone, lettering)
    // from the vehicle panels — the white DesignProAI header/footer bars are NOT
    // affected. This is the locked clean-background source: branding is applied
    // separately as deterministic Konva overlays, so the wrap panels carry ONE
    // logo (the overlay), never a baked one underneath (no duplicate-logo bug).
    const stripBlock = stripBranding
      ? `\n\nCLEAN-BACKGROUND VARIANT (HIGHEST PRIORITY — overrides the logo/text matching above for the WRAP panels only): On every vehicle panel, paint ONLY the wrap background artwork — color, pattern, gradient, texture, and graphic flow that match the attached renders. OMIT every company logo, company name, phone number, website, tagline, and any lettering from the WRAP design. The panels show the background art with NOTHING readable on them. (The white header bar and white footer/signature bar described above are unaffected and must still appear exactly as specified.)`
      : "";

    // HOOD CONSISTENCY: the proof has no separate hood tile — the hood is painted
    // inside the side/front/roof views. When a dedicated hood render is provided
    // it is the AUTHORITATIVE hood design (e.g. RJ's corrected all-stars hood),
    // and the side/front renders may show a stale/different hood ("two different
    // hoods"). Force every view's hood area to match the hood render so the proof
    // is consistent and reflects the latest hood, not the side view's old one.
    const hasHood = !isTrailer && views.some((v) => String(v.type).toLowerCase().includes("hood"));
    const hoodBlock = hasHood
      ? `\n\nHOOD CONSISTENCY (CRITICAL): The "hood" render is the AUTHORITATIVE hood design. Paint the hood area in EVERY view (driver side, passenger side, front, and roof) to MATCH the hood render EXACTLY — same colors, pattern, and graphics. If the side or front render shows a different hood than the hood render, IGNORE it and use the hood render's design for the hood in all views. The hood must look identical everywhere in the proof.`
      : "";

    // PICKUP BED: the wrap goes on EXTERIOR body panels only. Never paint the
    // design inside the cargo bed — the bed floor and inner bed walls stay
    // factory. (Harmless for non-pickups, which have no bed.)
    const bedBlock = isTrailer
      ? ""
      : `\n\nTRUCK BED (CRITICAL): For pickup trucks, the wrap covers the EXTERIOR body panels only — outer bed sides, outer tailgate, cab, doors, fenders, hood. NEVER paint the wrap design INSIDE the truck bed / cargo area. The bed interior (bed floor and inner bed walls) stays the vehicle's factory finish — no wrap, no design inside the bed.`;

    // Assemble the IMAGE parts ONCE (previous proof, layout example, render views).
    // The text instruction is rebuilt per attempt so we can shorten it on retry
    // without re-fetching/re-encoding any image.
    const imageParts: Array<Record<string, unknown>> = [];
    let previousProofImg: { b64: string; mime: string } | null = null;
    if (!artboardOnly && revisionNote && previousProofUrl) {
      previousProofImg = await fetchImg(previousProofUrl);
      if (previousProofImg) {
        imageParts.push({ text: "PREVIOUS PROOF (fix the issues described above):" });
        imageParts.push({
          inlineData: {
            mimeType: previousProofImg.mime,
            data: previousProofImg.b64,
          },
        });
      }
    }
    if (exampleImg) {
      imageParts.push({ text: "USE THIS FOR LAYOUT REFERENCE ONLY — do NOT copy any text, logos, order numbers, or company names from this image. Match the multi-view orthographic layout style only:" });
      imageParts.push({ inlineData: { mimeType: exampleImg.mime, data: exampleImg.b64 } });
    }
    for (const v of views) {
      imageParts.push({ text: `SOURCE RENDER — "${v.type}" view (3D photo — design reference ONLY). Repaint this design onto the FLAT 2D elevation panel using the EXACT colors, logos, text, and graphics shown here — sample this render's exact colors (no substitutes) and copy its logo lockup glyph-for-glyph in the same arrangement — do not copy the photo itself:` });
      imageParts.push({ inlineData: { mimeType: v.img!.mime, data: v.img!.b64 } });
    }

    // Gemini best practice: shorter prompts are far more likely to RETURN an image.
    // finishReason:"NO_IMAGE" means Gemini chose text over image (NOT a safety
    // refusal) — re-sending the same long prompt tends to fail the same way. So on
    // each retry we DROP to a shorter instruction tier instead. Same locked model
    // (gemini-3-pro-image-preview) — no model fallback (model is locked).
    const stripShort = stripBranding
      ? ` On every vehicle panel paint ONLY the wrap background artwork (no logos, company name, phone, website, or lettering). The white header/footer bars are unaffected.`
      : "";
    // NOTE (2026-07-31): these sheet-level tiers NO LONGER DRIVE GENERATION.
    // The proof is now built per-tile (renderFlatTile) and composed by code
    // (composeProofSheet), because one shared 1K sheet put the wrap's lettering
    // at 2-3px and Gemini invented it. They are retained solely as inputs to
    // the idempotency material hash so an artifact cached under the old
    // shared-sheet contract is not silently reused; `generation.producer`
    // pins the real producer. Editing them changes cache keys, not pixels.
    const promptTiers = [
      // Tier 0 — full (with GENIE true-ratio template tokens)
      prompt + revisionBlock + stripBlock + hoodBlock + bedBlock + ratioText,
      // Tier 1 — medium: branding + match instruction + dims, drop layout verbosity
      `Create a 2D multi-view vehicle-wrap production proof sheet for a ${vehicleName}.
White header bar (#FFFFFF) with black text: "${brandTitle}" then "Vehicle: ${vehicleName} | Design: ${designName || "Custom Design"} | Finish: ${finish || "Gloss"}". White footer bar: "Approved By: ____  Signature: ____  Date: ____  | ${brandSite}".
Lay out ${requiredPanelNames} views on a clean white background in technical-drawing style. ${dimensionInstruction}${trailerNoRoofInstruction} Every view is a FLAT ORTHOGRAPHIC ELEVATION — a flat vehicle outline with the wrap painted on it, zero perspective, no studio, no floor, no reflections; never a copy of the 3D photograph. For each panel COPY the corresponding attached render's DESIGN exactly — sample the render's exact colors (never a deeper/brighter industry-typical substitute), copy the logo lockup glyph-for-glyph in the same arrangement (taglines included), same graphics and element positions; photographic elements stay photographic (never redrawn as illustrated characters). Do not invent, restyle, or simplify anything.${stripShort}${ratioText}${dimText}${totalSqFt}`,
      // Tier 2 — short: minimal core so Gemini reliably emits an image
      `2D multi-view wrap proof sheet for a ${vehicleName} on a clean white background, technical-drawing style. White header bar (black text) reading "${brandTitle}". Each panel (${requiredPanelNames}) is a FLAT orthographic elevation — flat vehicle outline, no perspective, no studio, no reflections — painted as an exact copy of its attached render's design — exact same colors sampled from the render and the identical logo lockup, glyph-for-glyph (photographic elements stay photographic, nothing restyled).${trailerNoRoofInstruction}${stripShort}`,
    ];

    console.log(`[2D-PROOF] ${vehicleName}: ${views.length} panels [${views.map((v) => v.type).join(", ")}] + layout ref${revisionNote ? ' + REVISION' : ''} → Gemini`);

    // Service-role client, auth uid, and canonical DesignIQ id — needed by BOTH
    // the proof upload/persist AND the artboard emit, so resolve them ONCE up front
    // (they used to sit in the middle of the proof code, which the artboardOnly
    // fast-path skips).
    let uid = callerUserId;
    if (
      isService &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        String(userId || ""),
      )
    ) {
      uid = String(userId);
    }
    const immutablePackArtifact =
      hasPackArtifactScope && !!trustedArtifactAttempt;
    const packArtifactScope = immutablePackArtifact
      ? `${trustedEnticePackId}/${trustedArtifactAttempt}`
      : String(Date.now());
    // Bind immutable surface objects to every material fence. A retry under the
    // same attempt can reuse the exact object; a changed manifest cannot.
    const surfaceArtifactScope = isSurfaceMasterRequest
      ? `${packArtifactScope}_${String(manifestHash || "").toLowerCase()}`
      : packArtifactScope;

    // The durable revision workflow is at-least-once: a new lease token is
    // expected after worker loss, but the frozen proof material is unchanged.
    // Keep artifactAttemptId as the per-attempt fence while binding a separate,
    // stable idempotency key to the exact proof inputs. Legacy/browser calls and
    // the service-only surface-master mode retain their existing paths.
    const NORMAL_PROOF_IDEMPOTENCY_CONTRACT =
      "generate-2d-proof.normal-revision-idempotency.v2";
    const NORMAL_PROOF_SOURCE_EVIDENCE_CONTRACT =
      "generate-2d-proof.normal-source-evidence.v1";
    let normalProofIdempotency: {
      bindingPath: string;
      keyHash: string;
      materialHash: string;
      proofPath: string;
      surfaceManifestPath: string;
      reused: boolean;
      sourceEvidenceHash: string;
      bindingCreated: boolean;
      bindingOwnerAttemptId: string;
      bindingStartedAtMs: number;
    } | null = null;

    if (isRevisionNormalProofRequest) {
      const stableKey = String(idempotencyKey || "").trim();
      const keyIsSafe =
        /^[A-Za-z0-9][A-Za-z0-9._:/-]{15,511}$/.test(stableKey) &&
        !stableKey.toLowerCase().includes(
          trustedArtifactAttempt.toLowerCase(),
        );
      if (!keyIsSafe || !uuidPattern.test(String(uid || ""))) {
        return new Response(
          JSON.stringify({
            success: false,
            error:
              "Normal revision proofs require a stable idempotencyKey independent of artifactAttemptId",
            code: "invalid_normal_proof_idempotency_key",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const evidenceInput =
        sourceEvidence &&
        typeof sourceEvidence === "object" &&
        !Array.isArray(sourceEvidence)
          ? sourceEvidence as Record<string, unknown>
          : {};
      const evidenceViewsInput =
        evidenceInput.views &&
        typeof evidenceInput.views === "object" &&
        !Array.isArray(evidenceInput.views)
          ? evidenceInput.views as Record<string, unknown>
          : {};
      const requiredViewKeys = Array.isArray(
          evidenceInput.requiredViewKeys,
        )
        ? evidenceInput.requiredViewKeys.map((key) =>
            String(key || "").trim()
          )
        : [];
      const sortedRequiredViewKeys = [...requiredViewKeys].sort(
        (left, right) => left.localeCompare(right),
      );
      const requestViewKeys = Object.keys(urls)
        .filter((key) => !!urls[key])
        .sort((left, right) => left.localeCompare(right));
      const selectedViewKeys = sortedEntries
        .map(([key]) => key)
        .sort((left, right) => left.localeCompare(right));
      const fetchedViewKeys = views
        .map((view) => view.type)
        .sort((left, right) => left.localeCompare(right));
      const evidenceViewKeys = Object.keys(evidenceViewsInput)
        .sort((left, right) => left.localeCompare(right));
      const sameKeys = (left: string[], right: string[]) =>
        left.length === right.length &&
        left.every((key, index) => key === right[index]);
      const requiredKeysValid =
        evidenceInput.contract ===
          NORMAL_PROOF_SOURCE_EVIDENCE_CONTRACT &&
        requiredViewKeys.length > 0 &&
        new Set(requiredViewKeys).size === requiredViewKeys.length &&
        requiredViewKeys.every((key) =>
          /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(key)
        ) &&
        sameKeys(sortedRequiredViewKeys, requestViewKeys) &&
        sameKeys(sortedRequiredViewKeys, selectedViewKeys) &&
        sameKeys(sortedRequiredViewKeys, fetchedViewKeys) &&
        sameKeys(sortedRequiredViewKeys, evidenceViewKeys);
      if (!requiredKeysValid) {
        return new Response(
          JSON.stringify({
            success: false,
            error:
              "Durable normal proof source evidence does not exactly match the resolved view set",
            code: "normal_proof_source_evidence_invalid",
            retryable: false,
            requiredViewKeys: sortedRequiredViewKeys,
            requestViewKeys,
            selectedViewKeys,
            fetchedViewKeys,
            evidenceViewKeys,
          }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          },
        );
      }

      const strongKinds = new Set([
        "object-version",
        "x-goog-generation",
        "x-amz-version-id",
        "x-ms-version-id",
        "etag",
      ]);
      const attestedViews: Record<string, {
        url: string;
        sha256: string;
        bytes: number;
        contentLength: number;
        validatorKind: string;
        validator: string;
      }> = {};
      for (const key of sortedRequiredViewKeys) {
        const raw =
          evidenceViewsInput[key] &&
          typeof evidenceViewsInput[key] === "object" &&
          !Array.isArray(evidenceViewsInput[key])
            ? evidenceViewsInput[key] as Record<string, unknown>
            : {};
        const requestedUrl = canonicalSourceUrl(urls[key]);
        const evidenceUrl = canonicalSourceUrl(raw.url);
        const sha256 = String(raw.sha256 || "").toLowerCase();
        const bytes = Number(raw.bytes || 0);
        const contentLength = Number(raw.contentLength || 0);
        const validatorKind = String(raw.validatorKind || "")
          .trim()
          .toLowerCase();
        const validator = String(raw.validator || "").trim();
        if (
          !requestedUrl ||
          !evidenceUrl ||
          requestedUrl !== evidenceUrl ||
          !/^[0-9a-f]{64}$/.test(sha256) ||
          !Number.isSafeInteger(bytes) ||
          bytes <= 0 ||
          !Number.isSafeInteger(contentLength) ||
          contentLength <= 0 ||
          bytes !== contentLength ||
          !strongKinds.has(validatorKind) ||
          !validator ||
          (validatorKind === "etag" && /^W\//i.test(validator))
        ) {
          return new Response(
            JSON.stringify({
              success: false,
              error:
                `Durable source evidence is incomplete or mismatched for ${key}`,
              code: "normal_proof_source_evidence_invalid",
              retryable: false,
              viewKey: key,
            }),
            {
              status: 400,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            },
          );
        }
        attestedViews[key] = {
          url: evidenceUrl,
          sha256,
          bytes,
          contentLength,
          validatorKind,
          validator,
        };
      }

      // The transformed render bytes have already been fetched above. Recheck
      // the original immutable object identities now, so the attestation is as
      // close as possible to binding/Gemini without re-downloading huge files.
      const attestations = await Promise.all(
        sortedRequiredViewKeys.map(async (key) => ({
          key,
          result: await attestDurableProofSource(attestedViews[key]),
        })),
      );
      const failedAttestation = attestations.find(
        ({ result }) => !result.ok,
      );
      if (failedAttestation && !failedAttestation.result.ok) {
        return new Response(
          JSON.stringify({
            success: false,
            error:
              `Durable source attestation failed for ${failedAttestation.key}: ${failedAttestation.result.reason}`,
            code: "normal_proof_source_attestation_failed",
            retryable: failedAttestation.result.retryable,
            viewKey: failedAttestation.key,
          }),
          {
            status: failedAttestation.result.retryable ? 503 : 409,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
              ...(failedAttestation.result.retryable
                ? { "Retry-After": "30" }
                : {}),
            },
          },
        );
      }
      const attestedSourceEvidence = {
        contract: NORMAL_PROOF_SOURCE_EVIDENCE_CONTRACT,
        requiredViewKeys: sortedRequiredViewKeys,
        views: attestedViews,
      };
      const sourceEvidenceHash =
        await sha256CanonicalProofMaterial(attestedSourceEvidence);

      // Hash the bytes Gemini actually sees, not mutable URLs. This keeps a
      // stable key from ever reusing an artifact after any render, layout
      // example, previous proof, prompt, dimension, model, or contract change.
      const viewMaterial: Array<Record<string, unknown>> = [];
      for (const view of views) {
        viewMaterial.push({
          type: view.type,
          mime: view.img.mime,
          ...(await fingerprintBase64(view.img.b64)),
        });
      }
      const exampleMaterial = exampleImg
        ? {
            mime: exampleImg.mime,
            ...(await fingerprintBase64(exampleImg.b64)),
          }
        : null;
      const previousMaterial = previousProofImg
        ? {
            mime: previousProofImg.mime,
            ...(await fingerprintBase64(previousProofImg.b64)),
          }
        : null;
      const materialHash = await sha256CanonicalProofMaterial({
        contract: NORMAL_PROOF_IDEMPOTENCY_CONTRACT,
        userId: uid,
        enticePackId: trustedEnticePackId,
        manifestHash: String(manifestHash || "").toLowerCase(),
        dimensions: dimensions || null,
        sourceEvidence: attestedSourceEvidence,
        promptTiers,
        inputs: {
          instructions: imageParts
            .filter((part) => typeof part.text === "string")
            .map((part) => String(part.text)),
          layoutExample: exampleMaterial,
          previousProof: previousMaterial,
          views: viewMaterial,
        },
        generation: {
          // per-tile flat elevations + deterministic composition (2026-07-31).
          // The producer identity is part of the key on purpose: an artifact
          // built by the old shared-sheet pass must never be reused for a
          // request that would now be built tile-wise.
          producer: "perSurfaceBleedMaster.v2",
          model: "gemini-3-pro-image-preview",
          aspectRatio: "nearest-supported-to-genie-trim",
          imageSize: "1K",
          responseModalities: ["TEXT", "IMAGE"],
          maxAttempts: 3,
          sheetWidth: PROOF_SHEET_W,
          sheetCompositor: "designproComposeSheet.v1",
          genieSizeBand: "composeProofSheet.sizeBand.v1",
          surfaceTransform: "contain-mirror-fill-at-call7.v1",
          bleedInchesPerEdge: 5,
          expectedSurfaceSides: Array.isArray(expectedSurfaceSides)
            ? expectedSurfaceSides.map((side: unknown) => String(side)).sort()
            : [],
          designAnchorViewKey: String(designAnchorViewKey || ""),
          fontUrl: FONT_URL,
        },
      });
      // Match the worker's sha256(string) contract exactly. Canonical JSON
      // hashing would include quote bytes around a string and make the producer
      // and worker attest to different logical keys.
      const keyHash = await sha256ProofText(stableKey);
      const stableDirectory =
        `renders/${uid}/2d-proofs/${trustedEnticePackId}` +
        `/normal-proof/${keyHash}`;
      const bindingPath = `${stableDirectory}/binding.json`;
      // The immutable normal-proof route has one stable object name. Supabase
      // still serves the exact stored content type if the upstream image MIME
      // differs from PNG during a rare size-band fallback.
      const proofPath =
        `${stableDirectory}/${materialHash}_proof-branded.png`;
      const surfaceManifestPath =
        `${stableDirectory}/${materialHash}_surface-manifest.json`;
      const bindingStartedAt = new Date().toISOString();
      const binding = {
        contract: NORMAL_PROOF_IDEMPOTENCY_CONTRACT,
        keyHash,
        materialHash,
        ownerAttemptId: trustedArtifactAttempt,
        startedAt: bindingStartedAt,
      };
      const bindingBytes = new TextEncoder().encode(
        JSON.stringify(canonicalizeProofMaterial(binding)),
      );
      const storage = db.storage.from("wrap-files");
      const bindingAuthorization =
        await renewDurableProofProducerFence(db, {
          workflowRunId: trustedWorkflowRunId,
          enticePackId: trustedEnticePackId,
          userId: trustedDurableUserId,
          artifactAttemptId: trustedArtifactAttempt,
          manifestHash: String(manifestHash).toLowerCase(),
        });
      if (!bindingAuthorization.ok) {
        return new Response(
          JSON.stringify({
            success: false,
            error:
              `Immutable proof binding lost its workflow fence: ${bindingAuthorization.reason}`,
            code: "normal_proof_producer_fence_lost",
            retryable: true,
            retryAfterSeconds: 30,
          }),
          {
            status: 503,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
              "Retry-After": "30",
            },
          },
        );
      }
      const { error: bindingUploadError } = await storage.upload(
        bindingPath,
        bindingBytes,
        {
          contentType: "application/json",
          upsert: false,
        },
      );
      const bindingCreated = !bindingUploadError;
      let bindingOwnerAttemptId = binding.ownerAttemptId;
      let bindingStartedAtMs = Date.parse(binding.startedAt);
      if (bindingUploadError) {
        const { data: existingBinding, error: bindingReadError } =
          await storage.download(bindingPath);
        if (bindingReadError || !existingBinding) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Could not verify the immutable proof idempotency binding",
              code: "normal_proof_idempotency_binding_unavailable",
              retryable: true,
            }),
            {
              status: 503,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
                "Retry-After": "15",
              },
            },
          );
        }
        let observedBinding: Record<string, unknown> | null = null;
        try {
          observedBinding = JSON.parse(await existingBinding.text());
        } catch {
          observedBinding = null;
        }
        if (
          observedBinding?.contract !== binding.contract ||
          observedBinding?.keyHash !== binding.keyHash ||
          observedBinding?.materialHash !== binding.materialHash
        ) {
          return new Response(
            JSON.stringify({
              success: false,
              error:
                "The idempotency key is already bound to different proof material",
              code: "normal_proof_idempotency_conflict",
            }),
            {
              status: 409,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            },
          );
        }
        bindingOwnerAttemptId = String(
          observedBinding.ownerAttemptId || "",
        );
        bindingStartedAtMs = Date.parse(
          String(observedBinding.startedAt || ""),
        );
      }

      normalProofIdempotency = {
        bindingPath,
        keyHash,
        materialHash,
        proofPath,
        surfaceManifestPath,
        reused: false,
        sourceEvidenceHash,
        bindingCreated,
        bindingOwnerAttemptId,
        bindingStartedAtMs,
      };
      let { data: existingProof, error: existingProofError } =
        await storage.download(proofPath);
      if (!existingProofError && existingProof && existingProof.size > 0) {
        normalProofIdempotency.reused = true;
      } else if (
        existingProofError &&
        !storageObjectMissing(existingProofError)
      ) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Could not verify the immutable proof artifact",
            code: "normal_proof_idempotency_lookup_unavailable",
            retryable: true,
          }),
          {
            status: 503,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
              "Retry-After": "15",
            },
          },
        );
      } else if (!existingProofError) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "The immutable proof artifact is empty",
            code: "normal_proof_idempotency_artifact_invalid",
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      if (
        !normalProofIdempotency.reused &&
        !normalProofIdempotency.bindingCreated
      ) {
        const now = Date.now();
        const bindingAgeMs = now - bindingStartedAtMs;
        const bindingMetadataValid =
          uuidPattern.test(bindingOwnerAttemptId) &&
          Number.isFinite(bindingStartedAtMs) &&
          bindingStartedAtMs <= now + 60_000 &&
          bindingAgeMs >= -60_000;
        if (!bindingMetadataValid) {
          return new Response(
            JSON.stringify({
              success: false,
              error:
                "The immutable proof binding has invalid producer ownership metadata",
              code: "normal_proof_idempotency_binding_invalid",
              retryable: false,
            }),
            {
              status: 409,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            },
          );
        }
        // This must remain safely above the worker's 540-second Call 8
        // timeout; otherwise an aborted client could authorize a takeover while
        // the original edge invocation is still stamping or uploading.
        const producerWindowMs = 660_000;
        if (bindingAgeMs < producerWindowMs) {
          // A prior invocation owns the fresh immutable binding. Briefly poll
          // for its exact output; never start a second Gemini generation while
          // that producer window remains active.
          for (let poll = 0; poll < 3; poll += 1) {
            await new Promise((resolve) => setTimeout(resolve, 750));
            const polled = await storage.download(proofPath);
            existingProof = polled.data;
            existingProofError = polled.error;
            if (
              !existingProofError &&
              existingProof &&
              existingProof.size > 0
            ) {
              normalProofIdempotency.reused = true;
              break;
            }
            if (
              existingProofError &&
              !storageObjectMissing(existingProofError)
            ) {
              return new Response(
                JSON.stringify({
                  success: false,
                  error:
                    "Could not recheck the in-progress immutable proof artifact",
                  code: "normal_proof_idempotency_lookup_unavailable",
                  retryable: true,
                }),
                {
                  status: 503,
                  headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                    "Retry-After": "30",
                  },
                },
              );
            }
          }
          if (!normalProofIdempotency.reused) {
            const retryAfterSeconds = Math.max(
              1,
              Math.ceil(
                (producerWindowMs - (Date.now() - bindingStartedAtMs)) /
                  1000,
              ),
            );
            return new Response(
              JSON.stringify({
                success: false,
                error:
                  "The immutable normal proof is still being produced",
                code: "normal_proof_idempotency_in_progress",
                retryable: true,
                retryAfterSeconds,
                ownerAttemptId: bindingOwnerAttemptId,
              }),
              {
                status: 409,
                headers: {
                  ...corsHeaders,
                  "Content-Type": "application/json",
                  "Retry-After": String(retryAfterSeconds),
                },
              },
            );
          }
        }
        if (!normalProofIdempotency.reused) {
          // The original material binding is immutable and is never rewritten.
          // A stale recovery instead claims one immutable marker scoped to its
          // currently authorized lease token. The DB fence excludes different
          // live tokens; this marker excludes duplicate deliveries sharing the
          // same token.
          const takeoverPath =
            `${stableDirectory}/takeovers/` +
            `${trustedArtifactAttempt}.json`;
          const takeover = {
            contract: NORMAL_PROOF_IDEMPOTENCY_CONTRACT,
            keyHash,
            materialHash,
            ownerAttemptId: trustedArtifactAttempt,
            startedAt: new Date().toISOString(),
          };
          const takeoverBytes = new TextEncoder().encode(
            JSON.stringify(canonicalizeProofMaterial(takeover)),
          );
          const takeoverAuthorization =
            await renewDurableProofProducerFence(db, {
              workflowRunId: trustedWorkflowRunId,
              enticePackId: trustedEnticePackId,
              userId: trustedDurableUserId,
              artifactAttemptId: trustedArtifactAttempt,
              manifestHash: String(manifestHash).toLowerCase(),
            });
          if (!takeoverAuthorization.ok) {
            return new Response(
              JSON.stringify({
                success: false,
                error:
                  `Stale-proof takeover lost its workflow fence: ${takeoverAuthorization.reason}`,
                code: "normal_proof_producer_fence_lost",
                retryable: true,
                retryAfterSeconds: 30,
              }),
              {
                status: 503,
                headers: {
                  ...corsHeaders,
                  "Content-Type": "application/json",
                  "Retry-After": "30",
                },
              },
            );
          }
          const { error: takeoverUploadError } =
            await storage.upload(takeoverPath, takeoverBytes, {
              contentType: "application/json",
              upsert: false,
            });
          if (takeoverUploadError) {
            const { data: existingTakeover, error: takeoverReadError } =
              await storage.download(takeoverPath);
            if (takeoverReadError || !existingTakeover) {
              return new Response(
                JSON.stringify({
                  success: false,
                  error:
                    "Could not verify the immutable stale-recovery marker",
                  code:
                    "normal_proof_takeover_binding_unavailable",
                  retryable: true,
                  retryAfterSeconds: 30,
                }),
                {
                  status: 503,
                  headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                    "Retry-After": "30",
                  },
                },
              );
            }
            let observedTakeover: Record<string, unknown> | null = null;
            try {
              observedTakeover = JSON.parse(
                await existingTakeover.text(),
              );
            } catch {
              observedTakeover = null;
            }
            if (
              observedTakeover?.contract !== takeover.contract ||
              observedTakeover?.keyHash !== takeover.keyHash ||
              observedTakeover?.materialHash !== takeover.materialHash ||
              observedTakeover?.ownerAttemptId !==
                takeover.ownerAttemptId ||
              !Number.isFinite(
                Date.parse(String(observedTakeover?.startedAt || "")),
              )
            ) {
              return new Response(
                JSON.stringify({
                  success: false,
                  error:
                    "The stale-recovery marker does not match this fenced proof attempt",
                  code: "normal_proof_takeover_conflict",
                  retryable: false,
                }),
                {
                  status: 409,
                  headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                  },
                },
              );
            }
            // Marker loser may still reuse the winner if it finishes during a
            // short poll, but it must never launch another Gemini request.
            for (let poll = 0; poll < 3; poll += 1) {
              await new Promise((resolve) =>
                setTimeout(resolve, 750)
              );
              const polled = await storage.download(proofPath);
              if (
                !polled.error &&
                polled.data &&
                polled.data.size > 0
              ) {
                normalProofIdempotency.reused = true;
                break;
              }
              if (
                polled.error &&
                !storageObjectMissing(polled.error)
              ) {
                return new Response(
                  JSON.stringify({
                    success: false,
                    error:
                      "Could not recheck the stale-recovery proof artifact",
                    code:
                      "normal_proof_idempotency_lookup_unavailable",
                    retryable: true,
                    retryAfterSeconds: 30,
                  }),
                  {
                    status: 503,
                    headers: {
                      ...corsHeaders,
                      "Content-Type": "application/json",
                      "Retry-After": "30",
                    },
                  },
                );
              }
            }
            if (!normalProofIdempotency.reused) {
              return new Response(
                JSON.stringify({
                  success: false,
                  error:
                    "A fenced stale-proof recovery is already in progress",
                  code:
                    "normal_proof_idempotency_in_progress",
                  retryable: true,
                  retryAfterSeconds: 60,
                  ownerAttemptId: trustedArtifactAttempt,
                }),
                {
                  status: 409,
                  headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                    "Retry-After": "60",
                  },
                },
              );
            }
          }
        }
        const recoveryAuthorization =
          normalProofIdempotency.reused
            ? null
            : await authorizeDurableProofProducer(db, {
                workflowRunId: trustedWorkflowRunId,
                enticePackId: trustedEnticePackId,
                userId: trustedDurableUserId,
                artifactAttemptId: trustedArtifactAttempt,
                manifestHash: String(manifestHash).toLowerCase(),
              });
        if (
          recoveryAuthorization &&
          !recoveryAuthorization.ok
        ) {
          return new Response(
            JSON.stringify({
              success: false,
              error:
                `Stale proof recovery lost its workflow fence: ${recoveryAuthorization.reason}`,
              code: "normal_proof_producer_fence_lost",
              retryable: true,
              retryAfterSeconds: 30,
            }),
            {
              status: 503,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
                "Retry-After": "30",
              },
            },
          );
        }
      }
    }

    // CANONICAL DesignIQ id. Callers (e.g. DesignAssetsPanel) sometimes pass a
    // color_visualizations RENDER id as designiqGenerationId. Every
    // designiq_generations.update(...).eq("id", <CV id>) below then SILENTLY
    // no-ops (no designiq row with that id), so flat_proof_url / master_artboard_url
    // / master_artboard_clean_url never persist on the design row the panel slicer
    // reads — leaving both artboard columns NULL (the exact job-7aeb5bb2 failure).
    // Resolve the canonical designiq id via color_visualizations.admin_notes.
    // designiq_generation_id (same back-link buildProductionPanels uses) BEFORE the
    // designiq_generations writes. The color_visualizations admin_notes writes keep
    // using the passed id — that IS the CV row.
    let canonicalDesigniqId: string | null = designiqGenerationId || null;
    let sourceVisualizationOwnerEmail = "";
    if (designiqGenerationId) {
      try {
        const { data: cvRow } = await db.from("color_visualizations")
          .select("admin_notes,customer_email").eq("id", designiqGenerationId)
          .maybeSingle();
        if (cvRow) {
          sourceVisualizationOwnerEmail = String(
            (cvRow as any).customer_email || "",
          ).trim().toLowerCase();
          let n: any = {};
          try { n = typeof (cvRow as any).admin_notes === "string" ? JSON.parse((cvRow as any).admin_notes) : ((cvRow as any).admin_notes || {}); } catch { n = {}; }
          if (n?.designiq_generation_id) canonicalDesigniqId = String(n.designiq_generation_id);
        }
      } catch { /* not a CV row / not linked — keep the passed id */ }
    }
    if (!isService && canonicalDesigniqId) {
      const [{ data: generationOwner }, { data: privileged }] = await Promise.all([
        db.from("designiq_generations").select("user_id")
          .eq("id", canonicalDesigniqId).maybeSingle(),
        db.from("user_roles").select("role").eq("user_id", callerUserId)
          .in("role", ["admin", "tester"]).limit(1).maybeSingle(),
      ]);
      const canonicalGenerationOwner = String(
        (generationOwner as any)?.user_id || "",
      );
      const ownsCanonicalGeneration =
        !!canonicalGenerationOwner &&
        canonicalGenerationOwner === callerUserId;
      // A visualization-email fallback is legacy-only and applies solely when
      // there is no canonical generation row. It can never override a real,
      // differently owned generation reached through mutable admin_notes.
      const ownsUnlinkedLegacyVisualization =
        !canonicalGenerationOwner &&
        !!callerEmail &&
        sourceVisualizationOwnerEmail === callerEmail;
      if (
        !privileged &&
        !ownsCanonicalGeneration &&
        !ownsUnlinkedLegacyVisualization
      ) {
        return new Response(
          JSON.stringify({ success: false, error: "Forbidden" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // artboardOnly (composer-win + mode-3 fix): the caller already has a
    // deterministic DISPLAY proof and only needs the CONTINUOUS clean + branded
    // artboards emitted + persisted. Skip the whole proof-sheet Gemini generation,
    // the GENIE size-band stamp, the proof upload, and the flat_proof_url persist
    // (a full proof gen here would also CLOBBER the caller's chosen deterministic
    // proof) — jump straight to the artboard emit. Also the lightest-memory route
    // (no 2K proof decode, no imagescript band), which further defuses the 546 OOM.
    let imgData: Uint8Array | null = null;
    // Exact rectangle of every tile on the composed sheet. The layout is code,
    // so these are known rather than detected — downstream extraction can read
    // a tile instead of guessing where one sits.
    let proofTileRects: Record<string, { x: number; y: number; w: number; h: number }> | null = null;
    let surfaceMasters: Array<Record<string, unknown>> | null = null;
    let proofTotalSqFt = 0;
    // CALL 7 SANITY GATE verdicts for the candidates that actually shipped,
    // keyed by canonical side label ("DRIVER SIDE", …). Null on idempotent
    // reuse — a replayed immutable manifest was gated when first authored, and
    // no fresh candidate exists to judge. `known:false` records a gate that
    // could not run (fail-open), so "not checked" never reads as "passed".
    let call7SanityBySide:
      | Record<string, { known: boolean; pass: boolean; candidates: number; reason: string }>
      | null = null;
    // Dimensions of the composed sheet. The GENIE size band is appended BELOW
    // the tiles afterwards, so the height here is grown by the band before the
    // tile boxes are normalized — normalizing against the pre-band height would
    // shift every box upward and hand the tile pre-crop wrong rectangles.
    let proofSheetSize: { w: number; h: number } | null = null;
    let publicUrl = normalProofIdempotency?.reused
      ? db.storage
          .from("wrap-files")
          .getPublicUrl(normalProofIdempotency.proofPath).data.publicUrl
      : "";
    if (normalProofIdempotency?.reused) {
      const { data: manifestBlob, error: manifestError } = await db.storage
        .from("wrap-files")
        .download(normalProofIdempotency.surfaceManifestPath);
      if (manifestError || !manifestBlob) {
        return new Response(JSON.stringify({
          success: false,
          error: "The immutable proof exists without its Call 7 surface manifest",
          code: "normal_proof_surface_manifest_missing",
          retryable: false,
        }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      let replay: Record<string, any> | null = null;
      try {
        replay = JSON.parse(await manifestBlob.text());
      } catch {
        replay = null;
      }
      if (
        replay?.contract !== "call7-surface-manifest.v1" ||
        replay?.materialHash !== normalProofIdempotency.materialHash ||
        !replay?.proofTileRects ||
        !Array.isArray(replay?.surfaceMasters) ||
        replay.surfaceMasters.length === 0
      ) {
        return new Response(JSON.stringify({
          success: false,
          error: "The immutable Call 7 surface manifest is invalid",
          code: "normal_proof_surface_manifest_invalid",
          retryable: false,
        }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      proofTileRects = replay.proofTileRects;
      proofSheetSize = replay.proofSheetSize;
      surfaceMasters = replay.surfaceMasters;
      proofTotalSqFt = Number(replay.totalSqFt || 0);
    }
    if (!artboardOnly && !publicUrl) {
      // ── PER-TILE FLAT ELEVATIONS, THEN A CODE-COMPOSED SHEET ──
      // One Gemini pass per view instead of one pass for the whole sheet. Each
      // view gets the full 1K canvas, so the wrap's lettering has ~6x the
      // pixels it had inside a ~250px shared tile — which is what stops the
      // phone number / domain / year from being invented. The sheet itself is
      // then assembled deterministically, so no large AI image is ever decoded
      // and the 2K OOM that forced the 1K revert cannot recur.
      let imageMime = "image/png";
      let lastErr = "";

      // TEXT LOCK — the literal strings the design carries, straight from the
      // customer's own brief, so lettering is copied rather than guessed.
      let textLock = "";
      // The SAME literals the lock is built from, kept for verification after
      // the tiles render. One source, so the check can never drift from the
      // instruction it is checking.
      let lockedLiterals: ReturnType<typeof proofTextLiterals> | null = null;
      const textFabrications: Array<{ label: string; issues: Array<{ kind: string; observed: string; expected: string[] }> }> = [];
      if (!stripBranding) {
        try {
          const lockSource = canonicalDesigniqId || designiqGenerationId || null;
          if (lockSource) {
            const { data: genRow } = await db
              .from("designiq_generations")
              .select("company_name, raw_prompt")
              .eq("id", lockSource)
              .maybeSingle();
            if (genRow) {
              const company = String(genRow.company_name || "");
              const brief = String(genRow.raw_prompt || "");
              textLock = buildProofTextLock(company, brief);
              lockedLiterals = proofTextLiterals(company, brief);
            }
          }
        } catch (e) {
          console.warn(`[2D-PROOF] TEXT LOCK lookup skipped: ${String(e)}`);
        }
      }
      if (textLock) console.log(`[2D-PROOF] TEXT LOCK active (${textLock.split("\n- ").length - 1} literals)`);

      // Per-tile GENIE callout — the SAME numbers the size band stamps, so the
      // per-tile caption and the band can never disagree.
      // The pair is exposed separately from the callout STRING because the
      // proof sheet now draws dimension RULES (arrowed lines with the figure
      // beside them, per the owner's approved reference) and needs the two
      // numbers apart, not a formatted "W x H".
      const dimPairFor = (key: string): [number, number] | null => {
        if (!dimensions) return null;
        const pair: Record<string, [any, any]> = {
          side: [dimensions.sideW, dimensions.sideH],
          passenger: [dimensions.sideW, dimensions.sideH],
          hood: [dimensions.hoodW, dimensions.hoodL],
          roof: [dimensions.roofW, dimensions.roofL],
          front: [dimensions.frontW, dimensions.frontH],
          rear: [dimensions.backW, dimensions.backH],
        };
        const [w, h] = pair[key] || [];
        return Number(w) > 0 && Number(h) > 0 ? [Number(w), Number(h)] : null;
      };

      const calloutFor = (key: string): string => {
        if (!dimensions) return "";
        const pair: Record<string, [any, any]> = {
          side: [dimensions.sideW, dimensions.sideH],
          passenger: [dimensions.sideW, dimensions.sideH],
          hood: [dimensions.hoodW, dimensions.hoodL],
          roof: [dimensions.roofW, dimensions.roofL],
          front: [dimensions.frontW, dimensions.frontH],
          rear: [dimensions.backW, dimensions.backH],
        };
        const [w, h] = pair[key] || [];
        if (!(Number(w) > 0 && Number(h) > 0)) return "";
        return `${fmtIn(w)}" x ${fmtIn(h)}"${key === "passenger" ? " (mirrored)" : ""}`;
      };

      const bucketOf = (t: string): string => {
        const lt = t.toLowerCase();
        if (lt.includes("passenger")) return "passenger";
        if (lt.includes("hood")) return "hood";
        if (lt.includes("roof") || lt.includes("top")) return "roof";
        if (lt.includes("front") || lt.includes("hero")) return "front";
        if (lt.includes("rear") || lt.includes("back")) return "rear";
        return "side";
      };
      const approvedAnchorView =
        views.find((view) => String(view.type) === String(designAnchorViewKey || "")) ||
        views.find((view) => bucketOf(String(view.type)) === "side") ||
        views[0];
      const approvedDesignAnchor = approvedAnchorView?.img?.b64
        ? {
            b64: String(approvedAnchorView.img.b64),
            mime: String(approvedAnchorView.img.mime || "image/png"),
          }
        : undefined;

      // RELEASE THE ENCODED VIEWS BEFORE GENERATING.
      // imageParts fed the old shared-sheet call and is dead once the material
      // hash is computed, but it holds references to the SAME base64 strings as
      // `views` — so clearing only `views[i].img.b64` frees nothing and every
      // view stays resident through composition. That is half of the 546 that
      // killed the first live per-tile run.
      imageParts.length = 0;
      previousProofImg = null;

      // ── CALL 7 SANITY GATE (worker-side deterministic checks) ──────────────
      // A candidate tile is refused when the branding locate finds a mirrored
      // duplicate of a located element or branding touching the trim edge —
      // the two defects Call 7 has authored live (designs 5714755c, 06e082d5)
      // and that Calls 8–11 then copy byte-faithfully. The vision half is the
      // SAME branding locate the Call 7 lift already uses; the verdict is
      // deterministic pixel math on the worker, never a model opinion.
      //
      // Fail-open contract: a gate that cannot run (worker down, upload
      // failed) passes the candidate with known:false so an outage can never
      // block Call 7 — but a real negative verdict regenerates the candidate.
      const SANITY_GATE_CONTRACT = "call7-sanity-gate.v1";
      const TILE_CANDIDATES = 3;
      const sanityRefusals: Array<{ label: string; key: string; reasons: Array<{ code: string; label?: string; detail?: string }> }> = [];
      call7SanityBySide = {};
      const sanityGateScope = String(trustedArtifactAttempt || packArtifactScope || Date.now());
      const call7SanityGate = async (
        candPng: Uint8Array,
        key: string,
        label: string,
        candidate: number,
      ): Promise<{ known: boolean; pass: boolean; reasons: Array<{ code: string; label?: string; detail?: string }> }> => {
        try {
          const GATE_WORKER_HOST = Deno.env.get("DESIGNPRO_WORKER_URL");
          const GATE_WORKER_SECRET = Deno.env.get("WORKER_SECRET") || "";
          if (!GATE_WORKER_HOST) throw new Error("DESIGNPRO_WORKER_URL is not configured");
          const bucket = db.storage.from("wrap-files");
          const tilePath = `proof-tiles/${sanityGateScope}/sanity/${key}-c${candidate}.png`;
          const { error: sanityUpErr } = await bucket.upload(tilePath, candPng, {
            contentType: "image/png",
            upsert: true,
          });
          if (sanityUpErr) throw new Error(`sanity candidate upload failed: ${sanityUpErr.message}`);
          const candidateUrl = bucket.getPublicUrl(tilePath).data.publicUrl;
          const resp = await fetch(`${GATE_WORKER_HOST.replace(/\/+$/, "")}/call7-sanity-check`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(GATE_WORKER_SECRET ? { Authorization: `Bearer ${GATE_WORKER_SECRET}` } : {}),
            },
            body: JSON.stringify({ imageUrl: candidateUrl, side: label }),
            signal: AbortSignal.timeout(90_000),
          });
          const out = await resp.json().catch(() => ({}));
          if (!resp.ok || out?.success !== true) {
            throw new Error(String(out?.error || `call7-sanity-check HTTP ${resp.status}`));
          }
          return {
            known: out.known === true,
            pass: out.pass !== false,
            reasons: Array.isArray(out.reasons) ? out.reasons : [],
          };
        } catch (e) {
          console.warn(`[2D-PROOF] call7-sanity "${label}" unavailable (passing open): ${String(e)}`);
          return {
            known: false,
            pass: true,
            reasons: [{ code: "sanity_unavailable", label, detail: String(e) }],
          };
        }
      };

      const tiles: Array<{ key: string; label: string; callout: string; png: Uint8Array; wIn?: number; hIn?: number }> = [];
      // BOUNDED-CONCURRENT TILES — the 546 was wall-clock, not memory.
      //
      // Per-tile generation is the right shape (it is what stopped the proof
      // fabricating the customer's phone number), but rendering the views in a
      // strictly sequential loop turned Call 8's ONE Gemini image call into
      // SIX, each up to 3 attempts behind a 120s timeout, and the artboard
      // passes still run afterwards in the SAME invocation. Six 1K generations
      // at ~25-40s each is 150-240s of wall-clock before composition even
      // starts — which is the 546 at 119s, and why 0 of 30 designs on
      // 2026-07-31 got a proof or an artboard. The #3934 memory work was real
      // but it was tuning the wrong axis; freeing bytes does not buy seconds.
      //
      // The Gemini key pool (GOOGLE_AI_API_KEY_2..5) exists precisely so
      // concurrent calls do not stack on one key's rate limit, so the tiles can
      // overlap. TILE_CONCURRENCY is deliberately not `views.length`: peak
      // memory is unchanged at loop start (every view's b64 is already
      // resident), but freeing in batches keeps the tail bounded rather than
      // holding all six encoded views AND all six responses at once.
      const TILE_CONCURRENCY = 3;
      const pending = views.map((v) => ({
        v,
        key: bucketOf(String(v.type)),
        label: PROOF_TILE_LABELS[bucketOf(String(v.type))] || String(v.type).toUpperCase(),
      }));
      for (let batch = 0; batch < pending.length; batch += TILE_CONCURRENCY) {
        const slice = pending.slice(batch, batch + TILE_CONCURRENCY);
        const rendered = await Promise.all(
          slice.map(async ({ v, key, label }) => {
            try {
              const dimPair = dimPairFor(key);
              if (!dimPair) {
                throw new Error(`GENIE dimensions missing for ${label}`);
              }
              const draw = () => renderFlatTile({
                label,
                vehicleName,
                view: v.img!,
                anchor: v === approvedAnchorView ? undefined : approvedDesignAnchor,
                textLock,
                stripBranding: !!stripBranding,
                widthIn: dimPair[0],
                heightIn: dimPair[1],
                apiKey: nextGeminiKey,
              });
              // ── 3-CANDIDATE QC RETRY ─────────────────────────────────────
              // Every candidate faces two gates before it can freeze into a
              // Call 7 master; a refused candidate is REGENERATED, never
              // shipped. Up to three candidates per tile.
              //
              // [A] GROUND-TRUTH TEXT GATE. The proof becomes the SOLE
              // authority for every gate below it: panel-pro-extract's judge
              // is told the proof is "the ONLY source of truth for design and
              // text… never correct [it] from an earlier vehicle render". So a
              // proof that INVENTED a phone number is then DEFENDED all the
              // way to vinyl. Live on Cascade Stoneworks the hero read
              // `555-0142` / `cascadestoneworks.com` / `SINCE 2009` and the
              // proof read `877-555-0000` / `stanewerks.com` / `2008`. The
              // TEXT LOCK carries the literals INTO generation; this reads
              // them back OUT against the customer's own brief. Only branded
              // tiles with a non-empty lock are judged; a reader failure
              // fails OPEN (a broken reader must never block a good proof).
              //
              // [B] CALL 7 SANITY GATE (see contract above the tile loop):
              // mirrored branding twins and edge-truncated text, judged
              // deterministically on the worker from the existing branding
              // locate. Branded tiles only — a stripBranding pass has no
              // branding to check.
              let png: Uint8Array | null = null;
              let finalBad: Array<{ kind: string; observed: string; expected: string[] }> = [];
              let finalSanity: { known: boolean; pass: boolean; reasons: Array<{ code: string; label?: string; detail?: string }> } | null = null;
              let shippedCandidate = 0;
              for (let candidate = 1; candidate <= TILE_CANDIDATES; candidate++) {
                const cand = await draw();
                // renderFlatTile exhausted its own attempts — no further
                // candidates are coming; keep the last refused one so the
                // refusal (not a silent gap) decides the outcome below.
                if (!cand) break;
                png = cand;
                shippedCandidate = candidate;
                let bad: Array<{ kind: string; observed: string; expected: string[] }> = [];
                if (textLock && !stripBranding && lockedLiterals) {
                  const observed = await readTileText(cand, nextGeminiKey(), label);
                  if (observed) bad = findFabricatedText(lockedLiterals, observed);
                }
                if (bad.length) {
                  finalBad = bad;
                  finalSanity = null;
                  console.warn(
                    `[2D-PROOF] tile "${label}" candidate ${candidate}/${TILE_CANDIDATES} fabricated ${bad.map((b) => `${b.kind} "${b.observed}"`).join(", ")} — regenerating`,
                  );
                  continue;
                }
                finalBad = [];
                finalSanity = stripBranding
                  ? null
                  : await call7SanityGate(cand, key, label, candidate);
                if (finalSanity && finalSanity.known && !finalSanity.pass) {
                  console.warn(
                    `[2D-PROOF] tile "${label}" candidate ${candidate}/${TILE_CANDIDATES} refused by the Call 7 sanity gate: ${finalSanity.reasons.map((r) => r.code).join(", ")} — regenerating`,
                  );
                  continue;
                }
                break; // candidate accepted
              }
              if (finalBad.length) {
                // Record, do not silently ship. Decided after the loop, so
                // one bad tile reports alongside every other.
                textFabrications.push({ label, issues: finalBad });
              }
              if (finalSanity && finalSanity.known && !finalSanity.pass) {
                sanityRefusals.push({ label, key, reasons: finalSanity.reasons });
              }
              if (png && call7SanityBySide) {
                const sideLabel = PROOF_TILE_SIDE_LABELS[key] || label;
                call7SanityBySide[sideLabel] = {
                  known: finalSanity ? finalSanity.known : true,
                  pass: finalSanity ? finalSanity.pass && !finalSanity.reasons.some((r) => r.code !== "sanity_unavailable") : true,
                  candidates: shippedCandidate,
                  reason: finalSanity
                    ? (finalSanity.reasons.map((r) => r.detail || r.code).join("; ") ||
                      `Call 7 sanity gate passed (candidate ${shippedCandidate}/${TILE_CANDIDATES})`)
                    : (stripBranding
                      ? "stripBranding pass — no branding to check"
                      : `text gate consumed every candidate (candidate ${shippedCandidate}/${TILE_CANDIDATES})`),
                };
              }
              return png;
            } catch (e) {
              // One tile must never reject the batch — a missing face is an
              // honest omission below, a rejected Promise.all is a dead proof.
              console.warn(`[2D-PROOF] tile "${label}" threw: ${String(e)}`);
              return null;
            }
          }),
        );
        for (let i = 0; i < slice.length; i++) {
          const { v, key, label } = slice[i];
          const tilePng = rendered[i];
          // Release this batch's encoded view bytes the moment its tile is done.
          (v as any).img = { b64: "", mime: v.img!.mime };
          if (tilePng) {
            const dimPair = dimPairFor(key);
            tiles.push({
              key,
              label,
              callout: calloutFor(key),
              png: tilePng,
              wIn: dimPair?.[0],
              hIn: dimPair?.[1],
            });
          } else {
            lastErr = `Could not render the ${label} elevation`;
            console.warn(`[2D-PROOF] ${lastErr} — tile omitted`);
          }
        }
      }

      const requiredSurfaceSides = Array.isArray(expectedSurfaceSides)
        ? [...new Set(expectedSurfaceSides.map((side: unknown) =>
            String(side || "").trim().toUpperCase()
          ).filter(Boolean))].sort()
        : [];
      const observedSurfaceSides = tiles.map((tile) =>
        PROOF_TILE_SIDE_LABELS[tile.key] || ""
      ).filter(Boolean).sort();
      const uniqueObservedSurfaceSides = [...new Set(observedSurfaceSides)];
      const exactSurfaceSet =
        requiredSurfaceSides.length > 0 &&
        uniqueObservedSurfaceSides.length === observedSurfaceSides.length &&
        uniqueObservedSurfaceSides.length === requiredSurfaceSides.length &&
        requiredSurfaceSides.every((side, index) =>
          side === uniqueObservedSurfaceSides[index]
        );
      if (!exactSurfaceSet) {
        return new Response(JSON.stringify({
          success: false,
          error: lastErr || "Call 7 did not produce exactly the required GENIE surfaces",
          code: "proof_required_surface_missing",
          requiredSurfaceSides,
          observedSurfaceSides,
          retryable: false,
        }), {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // A proof that invented a locked string must NOT be published. Everything
      // downstream treats this sheet as the source of truth and will defend
      // whatever it says, so shipping it means printing a wrong phone number on
      // vinyl and a QC judge rejecting the panels that got it right. Each tile
      // already had one redraw; a fabrication that survived that is real.
      //
      // 5xx, not 422: this is a retryable generation defect, not a bad request.
      if (textFabrications.length) {
        const detail = textFabrications
          .map((f) => `${f.label}: ${f.issues.map((i) => `${i.kind} "${i.observed}" (expected ${i.expected.map((e) => `"${e}"`).join(" or ")})`).join("; ")}`)
          .join(" | ");
        console.error(`[2D-PROOF] REFUSED — proof fabricated locked text. ${detail}`);
        return new Response(
          JSON.stringify({
            success: false,
            error: `The proof invented text the customer never supplied — ${detail}`,
            code: "proof_text_fabricated",
            fabrications: textFabrications,
          }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // A master that still carries a mirrored branding twin or edge-truncated
      // text after three candidates must NOT freeze: Calls 8–11 are
      // byte-deterministic and would copy the defect faithfully into every
      // panel, proof, and paid print file. 503, not 422 — a retry regenerates
      // fresh candidates. The verdict payload lands in
      // workflow_stage_runs.error_details via the callFn envelope capture
      // (upstreamCode/upstreamQc), so a refusal is legible in the database.
      if (sanityRefusals.length) {
        const detail = sanityRefusals
          .map((f) => `${f.label}: ${f.reasons.map((r) => r.detail || r.code).join("; ")}`)
          .join(" | ");
        console.error(`[2D-PROOF] REFUSED — Call 7 sanity gate. ${detail}`);
        return new Response(
          JSON.stringify({
            success: false,
            error: `Call 7 authored a defective master (${TILE_CANDIDATES} candidates refused) — ${detail}`,
            code: "call7_sanity_refused",
            stage: "call7-sanity",
            qc: { contract: SANITY_GATE_CONTRACT, refusals: sanityRefusals },
            retryable: true,
            retryAfterSeconds: 60,
          }),
          {
            status: 503,
            headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "60" },
          },
        );
      }

      // Canonical order, so the sheet always reads driver → passenger → faces.
      tiles.sort((a, b) => PROOF_TILE_ORDER.indexOf(a.key as any) - PROOF_TILE_ORDER.indexOf(b.key as any));

      // Coverage is the sum of exactly these selected trim rectangles, never a
      // stored aggregate. The header, TOTAL line, size band, response, and
      // panelizer receipt therefore all carry the same reproducible figure.
      const coverageSqFt = genieTotalSqFt(
        dimensions,
        requiredSurfaceSides,
      );
      proofTotalSqFt = coverageSqFt;
      const coverage = coverageSqFt > 0 ? `  |  Coverage: ${fmtIn(coverageSqFt)} sq ft` : "";
      const bandLines = buildGenieSizeBandLines(
        dimensions,
        requiredSurfaceSides,
      );
      const composed = await composeProofSheet({
        tiles,
        // Tiles are uploaded and handed to the worker as URLs (its body limit
        // is 1MB; six 1K PNGs are ~12MB). Scoped to the artifact attempt so
        // attempts never collide and the objects are trivially identifiable.
        tileUploadPrefix: `proof-tiles/${trustedArtifactAttempt || packArtifactScope || Date.now()}`,
        uploadTile: async (tilePath: string, bytes: Uint8Array) => {
          const bucket = db.storage.from("wrap-files");
          const { error: upErr } = await bucket.upload(tilePath, bytes, {
            contentType: "image/png",
            upsert: true,
          });
          if (upErr) throw new Error(`proof tile upload failed: ${upErr.message}`);
          return bucket.getPublicUrl(tilePath).data.publicUrl;
        },
        publicTileUrl: (tilePath: string) =>
          db.storage.from("wrap-files").getPublicUrl(tilePath).data.publicUrl,
        sizeBandLines: bandLines,
        bleedIn: BLEED_IN,
        // Draw each tile inside its flattened vehicle elevation — Call 8's
        // contract, and what the 2026-07-24 proofs showed. Trailers and unknown
        // types resolve to a rectangle inside the template module, so this is
        // safe to pass unconditionally.
        vehicleType: isTrailer ? "trailer" : (explicitVehicleType || undefined),
        totalCoverageLine: coverageSqFt > 0 ? `TOTAL COVERAGE: ${fmtIn(coverageSqFt)} sq ft` : "",
        brandTitle,
        metaLine: `Vehicle: ${vehicleName}  |  Design: ${designName || "Custom Design"}  |  Finish: ${finish || "Gloss"}${coverage}`,
        footerLine: `Approved By: ____________    Signature: ____________    Date: ____________    |    ${brandSite}`,
      });
      proofTileRects = composed.rects;
      proofSheetSize = { w: composed.width, h: composed.height };
      const canonicalProofBoxes = proofTileBoxes(
        proofTileRects,
        proofSheetSize.w,
        proofSheetSize.h,
      );
      surfaceMasters = composed.surfaceMasters.map((master) => {
        const side = PROOF_TILE_SIDE_LABELS[master.key];
        const box = canonicalProofBoxes[side];
        if (!side || !box) {
          throw new Error(`Call 7 surface ${master.key} has no proof region`);
        }
        return {
          side,
          brandedMaster: {
            url: master.url,
            sha256: master.sha256,
            bytes: master.bytes,
            pixelWidth: master.pixelWidth,
            pixelHeight: master.pixelHeight,
          },
          proofRegion: {
            box,
            sha256: master.regionSha256,
            sourceMasterSha256: master.sha256,
          },
          trim: {
            widthIn: master.trimWidthIn,
            heightIn: master.trimHeightIn,
          },
          print: {
            widthIn: master.printWidthIn,
            heightIn: master.printHeightIn,
          },
          bleedIn: master.bleedIn,
          transformReceipt: {
            contract: "call7-proof-region-transform.v1",
            sourceSha256: String(master.sourceCrop.sourceSha256 || ""),
            outputSha256: master.sha256,
            cropBox: master.sourceCrop.cropBox,
            scaleMode: master.sourceCrop.fit,
            stretched: master.sourceCrop.stretch,
            rotationDeg: master.sourceCrop.rotationDegrees,
            truncated: master.sourceCrop.truncated,
            containedPixelBox: master.sourceCrop.containedPixelBox,
          },
        };
      });
      console.log(`[2D-PROOF] composed sheet from ${tiles.length} tiles [${tiles.map((t) => t.key).join(", ")}] — deterministic, zero AI${bandLines.length ? " + GENIE band" : ""}`);
      // Free every tile's bytes now that they are composited.
      for (const t of tiles) (t as any).png = new Uint8Array(0);
      tiles.length = 0;
      imageMime = "image/png";
      // composed.height ALREADY includes the size band — it was drawn in the
      // same pass, so there is no second decode/encode and no height to adjust.
      imgData = composed.bytes;

      if (normalProofIdempotency) {
        const surfaceManifest = canonicalizeProofMaterial({
          contract: "call7-surface-manifest.v1",
          materialHash: normalProofIdempotency.materialHash,
          proofTileRects,
          proofSheetSize,
          proofTileBoxes: canonicalProofBoxes,
          surfaceMasters,
          dimensionsResolved: dimensions || null,
          totalSqFt: coverageSqFt,
          bleedIn: BLEED_IN,
        });
        const manifestBytes = new TextEncoder().encode(
          JSON.stringify(surfaceManifest),
        );
        const storage = db.storage.from("wrap-files");
        const { error: surfaceManifestUploadError } = await storage.upload(
          normalProofIdempotency.surfaceManifestPath,
          manifestBytes,
          { contentType: "application/json", upsert: false },
        );
        if (surfaceManifestUploadError) {
          const { data: existingManifest, error: existingManifestError } =
            await storage.download(normalProofIdempotency.surfaceManifestPath);
          if (existingManifestError || !existingManifest) {
            throw new Error("Could not verify the immutable Call 7 surface manifest");
          }
          const existingText = await existingManifest.text();
          if (existingText !== new TextDecoder().decode(manifestBytes)) {
            throw new Error("Concurrent Call 7 attempts produced different surface manifests");
          }
        }
      }

      const ext = imageMime.includes("jpeg") ? "jpg" : imageMime.includes("webp") ? "webp" : "png";
      const proofRole = stripBranding ? "proof-clean" : "proof-branded";
      const path =
        normalProofIdempotency?.proofPath ||
        `renders/${uid}/2d-proofs/${packArtifactScope}_${proofRole}.${ext}`;
      if (normalProofIdempotency && !normalProofIdempotency.reused) {
        const publishAuthorization =
          await renewDurableProofProducerFence(db, {
            workflowRunId: trustedWorkflowRunId,
            enticePackId: trustedEnticePackId,
            userId: trustedDurableUserId,
            artifactAttemptId: trustedArtifactAttempt,
            manifestHash: String(manifestHash).toLowerCase(),
          });
        if (!publishAuthorization.ok) {
          return new Response(
            JSON.stringify({
              success: false,
              error:
                `Proof publication lost its workflow fence: ${publishAuthorization.reason}`,
              code: "normal_proof_producer_fence_lost",
              retryable: true,
              retryAfterSeconds: 30,
            }),
            {
              status: 503,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
                "Retry-After": "30",
              },
            },
          );
        }
      }
      const { error: upErr } = await db.storage.from("wrap-files").upload(path, imgData, {
        contentType: imageMime,
        upsert: !immutablePackArtifact,
      });
      if (upErr) {
        if (normalProofIdempotency) {
          // Two attempts may finish Gemini together after a worker handoff. The
          // immutable upload winner is authoritative; the loser must reuse those
          // exact bytes instead of overwriting or returning a phantom failure.
          const { data: racedProof, error: racedProofError } =
            await db.storage.from("wrap-files").download(path);
          if (!racedProofError && racedProof && racedProof.size > 0) {
            normalProofIdempotency.reused = true;
          } else {
            return new Response(
              JSON.stringify({
                success: false,
                error:
                  "The immutable proof upload failed and no winning artifact could be verified",
                code: "normal_proof_idempotency_upload_unavailable",
                retryable: true,
              }),
              {
                status: 503,
                headers: {
                  ...corsHeaders,
                  "Content-Type": "application/json",
                  "Retry-After": "15",
                },
              },
            );
          }
        } else {
          return new Response(
            JSON.stringify({ success: false, error: "Upload failed" }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
      }

      publicUrl = db.storage.from("wrap-files").getPublicUrl(path).data.publicUrl;

      // Self-persist flat_proof_url on the generation row (service-role, race-free).
      // The browser used to set this AFTER the call, keyed on a genId resolved from
      // color_visualizations.admin_notes — but that read often raced the viz-row
      // write and silently no-op'd, leaving flat_proof_url NULL on every job. When
      // the caller passes designiqGenerationId we write it here directly, so the 2D
      // proof is reliably attached to the design (the source the panel slicer feeds
      // back). Skipped for the stripped clean-background variant (not the master
      // proof). Non-fatal — a failed write never fails the proof response.
      if (designiqGenerationId && !stripBranding && persistCanonical !== false) {
        try {
          const { error: pErr } = await db.from("designiq_generations").update({ flat_proof_url: publicUrl }).eq("id", canonicalDesigniqId);
          if (pErr) console.warn(`[2D-PROOF] flat_proof_url persist warn: ${pErr.message}`);
          else console.log(`[2D-PROOF] flat_proof_url persisted on ${designiqGenerationId}`);
        } catch (e) { console.warn(`[2D-PROOF] flat_proof_url persist threw: ${String(e)}`); }

        // ── GENIE DIMS → panelizer_jobs (the customer-facing progress page) ──
        //
        // /productionflow renders its inch figures from panelizer_jobs.panels,
        // and NOTHING wrote them. A live 2024 F-250's row carried `panels: []`
        // with no validate result, so the overlay fell through to the generic
        // tier table and told the customer 172" x 59.5" while this very proof
        // stamped 214" x 56". Two numbers, one truck (fixed on the display side
        // 2026-08-04; this is the other half — giving the page the real ones).
        //
        // Written HERE because this is the one place that holds both halves: the
        // GENIE dimensions this proof just stamped AND the canonical design id
        // the job is keyed to. panelizer-step-validate itself is a pure
        // stateless calculator ("No AI, no images — pure math") with no job id
        // and no DB access; giving it one would be a bigger change than the
        // defect. Sourcing the page from the same `dimensions` object the proof
        // stamps makes proof and progress page agree BY CONSTRUCTION rather
        // than by two lookups that can drift apart again.
        //
        // FILL, NEVER OVERWRITE. Only a job whose panels are still empty is
        // touched, so a real production run's panels — QC-approved sizes,
        // upscale targets, anything a later stage wrote — can never be clobbered
        // by a proof regenerate.
        if (dimensions?.sideW) {
          try {
            const genieP = [
              ["driver-side", "Driver Side", dimensions.sideW, dimensions.sideH, false],
              ["passenger-side", "Passenger Side", dimensions.sideW, dimensions.sideH, true],
              ["hood", "Hood", dimensions.hoodW, dimensions.hoodL, false],
              ["roof", "Roof", dimensions.roofW, dimensions.roofL, false],
              ["front", "Front", dimensions.frontW, dimensions.frontH, false],
              ["rear", "Rear", dimensions.backW, dimensions.backH, false],
            ]
              .filter(([, , w, h]) => Number(w) > 0 && Number(h) > 0)
              .map(([panelKey, label, w, h, mirrored]) => ({
                panelKey,
                id: panelKey,
                label,
                widthInches: Number(w),
                heightInches: Number(h),
                mirrored: Boolean(mirrored),
              }));
            if (genieP.length) {
              const { data: pjs } = await db
                .from("panelizer_jobs")
                .select("id, panels, stage_progress")
                .eq("generation_id", canonicalDesigniqId);
              for (const pj of pjs || []) {
                const existing = Array.isArray(pj.panels) ? pj.panels : [];
                if (existing.length) continue; // already has real panels — leave them
                const sp = (pj.stage_progress && typeof pj.stage_progress === "object")
                  ? pj.stage_progress as Record<string, any>
                  : {};
                const stepData = { ...(sp.panelizer_step_data || {}) };
                stepData.validate = {
                  ...(stepData.validate || {}),
                  result: {
                    ...((stepData.validate || {}).result || {}),
                    panels: genieP,
                    totalSqFt:
                      genieTotalSqFt(dimensions, requiredSurfaceSides) ||
                      undefined,
                    bleedInches: BLEED_IN,
                    source: "generate-2d-proof",
                  },
                };
                const { error: pjErr } = await db
                  .from("panelizer_jobs")
                  .update({ panels: genieP, stage_progress: { ...sp, panelizer_step_data: stepData } })
                  .eq("id", pj.id);
                if (pjErr) console.warn(`[2D-PROOF] panelizer_jobs dims warn (${pj.id}): ${pjErr.message}`);
                else console.log(`[2D-PROOF] GENIE dims written to panelizer_jobs ${pj.id} (${genieP.length} panels)`);
              }
            }
          } catch (e) {
            console.warn(`[2D-PROOF] panelizer_jobs dims threw: ${String(e)}`);
          }
        }
        // Most designs live in color_visualizations (not designiq_generations) —
        // the update above no-ops for them and the proof never "saved". Merge
        // flat_proof_url into admin_notes too: that is the FIRST place the panel
        // slicer's resolveFlatProofUrl looks. Non-fatal, never fails the response.
        try {
          // The viz row's own id often differs from the canonical designiq id —
          // DesignPro jobs key the viz row by its own uuid and carry the canonical
          // id only as the admin_notes.designiq_generation_id back-link. Resolve
          // by id first, then through the back-link, or this write silently no-ops
          // and RevisionStudio keeps preloading the stale proof.
          let vizId: string = designiqGenerationId;
          let { data: viz } = await db.from("color_visualizations").select("id, admin_notes").eq("id", designiqGenerationId).maybeSingle();
          if (!viz) {
            const { data: linked } = await db.from("color_visualizations")
              .select("id, admin_notes")
              .like("admin_notes", `%${designiqGenerationId}%`)
              .order("created_at", { ascending: false })
              .limit(1);
            if (linked && linked.length) { viz = linked[0]; vizId = linked[0].id; }
          }
          if (viz) {
            let notes: Record<string, unknown> = {};
            try { notes = typeof viz.admin_notes === "string" ? JSON.parse(viz.admin_notes) : (viz.admin_notes || {}); } catch { notes = {}; }
            notes.flat_proof_url = publicUrl;
            if (dimensions) notes.proof_stamped_dims = dimensions;
            notes.vehicle_type = isTrailer ? "trailer" : (vehicleType || notes.vehicle_type || null);
            if (bodyText) notes.proof_body_text = bodyText;
            const vizUpdate: Record<string, unknown> = { admin_notes: JSON.stringify(notes) };
            if (isTrailer || vehicleType) vizUpdate.vehicle_type = isTrailer ? "trailer" : String(vehicleType).trim().toLowerCase();
            const { error: vErr } = await db.from("color_visualizations").update(vizUpdate).eq("id", vizId);
            if (vErr) console.warn(`[2D-PROOF] viz admin_notes persist warn: ${vErr.message}`);
            else console.log(`[2D-PROOF] flat_proof_url persisted on color_visualizations ${vizId}`);
          }
        } catch (e) { console.warn(`[2D-PROOF] viz persist threw: ${String(e)}`); }
      }
    }

    // ── MEMORY SPLIT: return the proof NOW; defer the artboards to a 2nd call ──
    // Three sequential 2K Gemini image generations (proof + clean + branded) in a
    // single invocation exceeded the 256MB / compute budget and the whole worker
    // was killed (WORKER_RESOURCE_LIMIT / 546) — so the PROOF response itself was
    // lost and the client saw "no 2D proof". A normal proof call now finishes at
    // the proof and returns; the caller re-invokes with artboardOnly:true (one
    // image pass per call via artboardVariant) to emit the continuous artboards.
    // stripBranding is already a single cheap pass (it just surfaces the proof as
    // the clean variant below), so it falls through unchanged.
    if (deferArtboards && !artboardOnly && !stripBranding) {
      if (normalProofIdempotency) {
        const returnAuthorization =
          await authorizeDurableProofProducer(db, {
            workflowRunId: trustedWorkflowRunId,
            enticePackId: trustedEnticePackId,
            userId: trustedDurableUserId,
            artifactAttemptId: trustedArtifactAttempt,
            manifestHash: String(manifestHash).toLowerCase(),
          });
        if (!returnAuthorization.ok) {
          return new Response(
            JSON.stringify({
              success: false,
              error:
                `Proof return lost its workflow fence: ${returnAuthorization.reason}`,
              code: "normal_proof_producer_fence_lost",
              retryable: true,
              retryAfterSeconds: 30,
            }),
            {
              status: 503,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
                "Retry-After": "30",
              },
            },
          );
        }
      }
      console.log(`[2D-PROOF] proof emitted; artboards deferred to follow-up artboardOnly call`);
      return new Response(JSON.stringify({
        success: true,
        proofUrl: publicUrl,
        artboardCleanUrl: "",
        artboardBrandedUrl: "",
        surfaceMastersContract: "call7-surface-manifest.v1",
        surfaceMasters: surfaceMasters || [],
        // Sanity-gate verdicts for the shipped candidates (null on idempotent
        // reuse — the replayed masters were gated when first authored).
        call7Sanity: call7SanityBySide
          ? { contract: "call7-sanity-gate.v1", sides: call7SanityBySide }
          : null,
        totalSqFt: proofTotalSqFt,
        // EXACT TILE GEOMETRY — the same additive spread as the tail return.
        // This early return is the path the durable workflow ALWAYS takes
        // (proof.build sends deferArtboards:true), and it was added without
        // these fields — so the per-tile compose at `proofTileRects =
        // composed.rects` above computed exact rectangles on every run and
        // this return dropped them on the floor. Live: 8 of 8 proof.build
        // checkpoints over 4 days carried tileBoxes:null, the tile pre-crop
        // never once activated, and every side's reference crop — HOOD most
        // of all — fell back to the Gemini box detection that "varies
        // run-to-run". Same condition as the tail return: a proof without
        // rects (idempotent reuse) omits the fields and detection remains
        // the fallback, exactly as designed.
        ...(proofTileRects
          ? {
              proofTileRects,
              proofSheetWidth: proofSheetSize?.w ?? PROOF_SHEET_W,
              proofSheetHeight: proofSheetSize?.h ?? null,
              proofTileBoxes: proofSheetSize
                ? proofTileBoxes(proofTileRects, proofSheetSize.w, proofSheetSize.h)
                : {},
            }
          : {}),
        dimensionsResolved: dimensions || null,
        hasResolvedDimensions: dimsResolved,
        vehicleType: isTrailer ? "trailer" : (explicitVehicleType || "standard"),
        artboardsDeferred: true,
        ...(normalProofIdempotency ? {
          artifactAttemptId: trustedArtifactAttempt,
          idempotencyContract: NORMAL_PROOF_IDEMPOTENCY_CONTRACT,
          idempotencyKeyHash: normalProofIdempotency.keyHash,
          idempotencyMaterialHash: normalProofIdempotency.materialHash,
          sourceEvidenceContract:
            NORMAL_PROOF_SOURCE_EVIDENCE_CONTRACT,
          sourceEvidenceHash:
            normalProofIdempotency.sourceEvidenceHash,
          idempotentReuse: normalProofIdempotency.reused,
        } : {}),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── EMIT artboardClean — the text-free CONTINUOUS clean BACKGROUND layer ──
    // The 8th call emits TWO assets: the branded proof above + this clean,
    // typography-free background. artboardClean is the deterministic source the
    // 9th-call slicer (panel-artboard-generator step:"panel" pixelExact) crops
    // 1:1 per side — so it MUST be ONE continuous full-bleed artwork, never a
    // labeled multi-panel sheet. Stays at 2K (same 256MB worker budget that
    // eliminated the 546 OOM crashes). Reuses the render parts already encoded in
    // `imageParts` — no re-fetch, no extra memory. Non-fatal: a failed clean pass
    // never fails the branded proof.
    let artboardCleanUrl = "";
    // artboardBranded — the FULL-DESIGN continuous flat artboard with logos/text
    // KEPT. This is the PRE-PURCHASE "entice" source: the deterministic slicer
    // crops THIS (not the stripped clean one) so Revision Studio shows branded
    // panels with the logos/graphics intact. The clean/separated pipeline stays
    // for the POST-PURCHASE production pack only.
    let artboardBrandedUrl = "";
    // Per-attempt failure reasons from the artboard passes, surfaced in the
    // surface-master 503 below. Declared out here so the caller sees WHY the
    // emit produced nothing — "no image (non-fatal)" told nobody anything.
    const artboardDiagnostics: string[] = [];
    if (stripBranding) {
      // The main output IS already the clean variant — surface it as artboardClean.
      artboardCleanUrl = publicUrl;
    } else {
      imgData = new Uint8Array(0); // release the branded bytes before the clean pass
      // ── 546 OOM FIX (mode 3) ──────────────────────────────────────────────
      // The clean + branded artboard passes need only ONE image: the driver-side
      // view. Holding all 6 view base64 strings + the assembled proof `imageParts`
      // + the layout example through two more Gemini round-trips is what tipped the
      // 256MB worker over (status 546 → the whole invocation is killed and
      // artboardCleanUrl comes back empty). Free every encoded image except the one
      // side view the artboard passes actually reference, so the emit runs at
      // minimal peak memory. Same "shed weight before the heavy step" pattern the
      // gridslice uses when it retries at a lower canvas cap.
      const _sideKeep = views.find((v) => /(driver|left|(^|[^a-z])side)/.test(v.type.toLowerCase()) && !/passenger/.test(v.type.toLowerCase())) || views[0];
      const _keepB64 = _sideKeep?.img?.b64;
      imageParts.length = 0;
      if (_keepB64) for (const v of views) { if (v.img && v.img.b64 !== _keepB64) v.img.b64 = ""; }
      // One pass per invocation when a variant is named (the memory-split follow-up
      // fires clean + branded as two separate workers). No variant → both (legacy).
      const wantClean = _artboardVariant !== "branded";
      const wantBranded = _artboardVariant !== "clean";
      try {
        // True physical aspect from the raw GENIE side tokens (e.g. Ram 2500
        // 243.5" x 59.4" ≈ 4.1:1) — pick the NEAREST Gemini-supported ratio and
        // disable the default 16:9 so the clean template is a wide flat strip at
        // the vehicle's real proportions, not a square-ish 16:9 box.
        const surfaceDimensionPair: [number, number] =
          requestedSurface === "hood" ? [Number(dimensions?.hoodW), Number(dimensions?.hoodL)] :
          requestedSurface === "roof" ? [Number(dimensions?.roofW), Number(dimensions?.roofL)] :
          requestedSurface === "front" ? [Number(dimensions?.frontW), Number(dimensions?.frontH)] :
          requestedSurface === "rear" ? [Number(dimensions?.backW), Number(dimensions?.backH)] :
          [Number(dimensions?.sideW), Number(dimensions?.sideH)];
        const sideRatioVal = (Number(surfaceDimensionPair[0]) > 0 && Number(surfaceDimensionPair[1]) > 0)
          ? Number(surfaceDimensionPair[0]) / Number(surfaceDimensionPair[1]) : 0;
        const CLEAN_ASPECTS: Array<[string, number]> = [["21:9", 21 / 9], ["16:9", 16 / 9], ["3:2", 1.5], ["4:3", 4 / 3], ["1:1", 1], ["3:4", 0.75], ["9:16", 9 / 16]];
        let cleanAspect = "16:9";
        if (sideRatioVal > 0) { let best = Infinity; for (const [l, rr] of CLEAN_ASPECTS) { const e = Math.abs(rr - sideRatioVal); if (e < best) { best = e; cleanAspect = l; } } }
        const dimToken = sideRatioVal > 0
          ? `${fmtIn(surfaceDimensionPair[0])}" x ${fmtIn(surfaceDimensionPair[1])}" (width:height ${Math.round(sideRatioVal * 100) / 100}:1)`
          : "the surface's true panel proportions";

        // EDIT framing (not "produce/reproduce" — that makes Gemini redraw and
        // reinvent the pattern). "Take THIS image, remove the vehicle, keep the
        // EXACT design, fill to the edges" preserves the real pixels. Proven in
        // AI Studio: a one-line edit instruction returns the exact wrap design,
        // de-vehicled and edge-filled, in seconds.
        // STRENGTHENED (2026-07-27, live failure on Elite Volt Electric): the
        // original tier-0 wording produced a HALF-DONE edit — the van body,
        // wheels, mirror, and window were still fully visible, and the logo/
        // text area came back as a faded, semi-transparent ghost instead of a
        // solid fill. Gemini was treating this as a soft blend/inpaint rather
        // than a hard, complete replace. Added an explicit "0% opacity, no
        // ghosting, no partial removal" instruction and a concrete failure
        // description so the model has something unambiguous to avoid.
        const cleanTiers = [
          `Take the attached image and EDIT it — do NOT redraw, restyle, or reinvent anything. COMPLETELY remove every vehicle part: body, cab, windows and glass, wheels, tires, bumpers, mirrors, lights, the ground, and the studio background — 100% gone, zero remaining outline or shadow of any vehicle part. KEEP the wrap design EXACTLY as shown — identical colors, shards, gradients, and flow. If it is or contains a flag, preserve that EXACT flag — its specific colors, ripple, flames, distressing, and star field — NEVER replace it with a standard, clean, or canonical stock flag. COMPLETELY remove every logo, company name, phone number, website, and line of lettering — replace that area with a SOLID, FULLY OPAQUE continuation of the surrounding design pattern, not a faded, blurred, or semi-transparent patch. The result must be flat, solid, and fully opaque everywhere — no ghosting, no partial transparency, no visible remnant of anything removed. Fill and extend the real design seamlessly out to all four edges, so the result is ONE continuous flat rectangle of pure background artwork — no vehicle, no text, no empty space, no faded areas.`,
          `Edit the attached image: delete all vehicle parts (body, glass, wheels, bumpers, ground, background) and all text/logos — completely, with zero outline or ghosting left behind. Replace the removed logo/text area with a solid, fully opaque continuation of the surrounding design, not a blurred or faded patch. KEEP the wrap design EXACTLY as-is — do not redraw it. Extend the real design seamlessly to fill the whole rectangle edge to edge. Background artwork only, fully opaque, no transparency.`,
          `Remove the vehicle and all lettering from the attached image completely, with no ghosting or faded remnants; keep the exact design pixels, fill any gap with a solid opaque continuation of the pattern, and fill the design out to every edge as one flat continuous rectangle.`,
        ];
        // Feed ONLY the side view as the continuous design reference — never the
        // multi-view layout example or all 6 panels (those make Gemini reproduce
        // SEPARATE panel boxes with gaps instead of one seamless full-canvas field).
        const cleanSideView = isSurfaceMasterRequest
          ? views[0]
          : (views.find((v) => /(driver|left|(^|[^a-z])side)/.test(v.type.toLowerCase()) && !/passenger/.test(v.type.toLowerCase())) || views[0]);
        // The image label must AGREE with the EDIT framing above. It used to read
        // "SIDE REFERENCE — reproduce this exact wrap design…", which (a) used the
        // exact word the comment at the top of this block warns against
        // ("reproduce … makes Gemini redraw and reinvent the pattern") directly
        // after a tier prompt saying "do NOT redraw, restyle, or reinvent
        // anything", and (b) called every surface a SIDE even when the request was
        // for the hood, roof, front, or rear. A contradictory instruction is a
        // known way to get text-instead-of-image (NO_IMAGE) or a reinvented design.
        const surfaceLabel = isSurfaceMasterRequest && requestedSurface
          ? requestedSurface.toUpperCase().replace(/-/g, " ")
          : "SIDE";
        const cleanImageParts = cleanSideView
          ? [{ text: `${surfaceLabel} SOURCE IMAGE — edit THIS image and keep its exact pixels:` }, { inlineData: { mimeType: cleanSideView.img!.mime, data: cleanSideView.img!.b64 } }]
          : imageParts;
        // ── ARTBOARD PASS RUNNER ────────────────────────────────────────────
        // MEASURED FAILURE (2026-07-30): of 148 designs that produced a 2D proof
        // in the prior 90 days, only 72 (48.6%) also emitted a branded artboard
        // and 36 (24.3%) a clean one. That ~49% pass rate is why 94% of designs
        // have no Layer 0 (RevisionStudio's layered logo edit silently falls back
        // to a full re-render), why panel producers have no artboard to crop, and
        // why the v2 surface-master proof.build — which needs SIX of these to all
        // succeed in one run (0.486^6 ≈ 1.3%) — essentially never completed.
        //
        // The old loop made that failure both INVISIBLE and CORRELATED:
        //   1. `if (!resp.ok) { …continue }` DISCARDED the HTTP status, so a 400
        //      on a rejected imageConfig, a 429 rate-limit (six surfaces × three
        //      attempts across five keys), and a 503 were indistinguishable — and
        //      `finishReason` (NO_IMAGE — per Google the most common image-gen
        //      outcome to retry, NOT a safety refusal) was never read at all.
        //      Every failure surfaced as one bare "(non-fatal)" warn.
        //   2. Every attempt re-sent the SAME imageConfig, so three "retries" of
        //      a config-level rejection are one failure counted three times.
        //
        // This mirrors the PROVEN main-proof loop above (4 attempts, status and
        // finishReason captured, per-attempt logging) and ladders BOTH knobs so
        // every attempt varies a real parameter. Model, prompt tiers, and the
        // response contract are untouched.
        const ARTBOARD_ATTEMPTS = 4;
        const runArtboardPass = async (
          label: string,
          tiers: string[],
        ): Promise<string> => {
          for (let attempt = 1; attempt <= ARTBOARD_ATTEMPTS; attempt++) {
            // The computed GENIE aspect (e.g. 21:9 for a 227"x76" side) goes
            // first — it gives the correctly-proportioned strip. It then falls
            // back to 16:9, the ratio the main proof loop has always used
            // successfully, instead of hammering a ratio the API may reject.
            // Size drops to 1K after the first try: it halves the response parse
            // (the 546 OOM guard) and the upscaler reaches print resolution
            // downstream anyway, so a 1K artboard beats no artboard.
            const aspectRatio = attempt <= 2 ? cleanAspect : "16:9";
            const imageSize = attempt === 1 ? "2K" : "1K";
            const tier = Math.min(attempt - 1, tiers.length - 1);
            const parts = [{ text: tiers[tier] }, ...cleanImageParts];
            const cfg = `${aspectRatio}/${imageSize}/tier${tier}`;
            try {
              const resp = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${nextGeminiKey()}`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    contents: [{ parts }],
                    generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio, imageSize } },
                  }),
                  signal: AbortSignal.timeout(120000),
                }
              );
              if (!resp.ok) {
                // Capture WHY. The silent `continue` here is what hid this for weeks.
                let detail = "";
                try { detail = (await resp.text()).slice(0, 300); } catch { /* body empty/unreadable */ }
                const err = `${label} attempt ${attempt}/${ARTBOARD_ATTEMPTS} [${cfg}] → HTTP ${resp.status}${detail ? `: ${detail}` : ""}`;
                artboardDiagnostics.push(err);
                console.warn(`[2D-PROOF] ${err}`);
                // 429/503 are load, not a bad request — back off harder.
                const backoff = (resp.status === 429 || resp.status === 503 ? 4000 : 1500) * attempt;
                if (attempt < ARTBOARD_ATTEMPTS) { await new Promise((r) => setTimeout(r, backoff)); continue; }
                break;
              }
              const json = await resp.json();
              const respParts = json.candidates?.[0]?.content?.parts;
              let b64 = "";
              if (respParts) for (const p of respParts) { if (p.inlineData) { b64 = p.inlineData.data; break; } }
              if (b64) {
                if (attempt > 1) console.log(`[2D-PROOF] ${label} recovered on attempt ${attempt} [${cfg}]`);
                return b64;
              }
              const reason = json.candidates?.[0]?.finishReason || "unknown";
              const blocked = json.promptFeedback?.blockReason || "";
              const err = `${label} attempt ${attempt}/${ARTBOARD_ATTEMPTS} [${cfg}] → no image (finishReason: ${reason}${blocked ? `, blockReason: ${blocked}` : ""})`;
              artboardDiagnostics.push(err);
              console.warn(`[2D-PROOF] ${err}`);
              if (attempt < ARTBOARD_ATTEMPTS) await new Promise((r) => setTimeout(r, 1500 * attempt));
            } catch (e) {
              const err = `${label} attempt ${attempt}/${ARTBOARD_ATTEMPTS} [${cfg}] → threw: ${String(e)}`;
              artboardDiagnostics.push(err);
              console.warn(`[2D-PROOF] ${err}`);
              if (attempt < ARTBOARD_ATTEMPTS) await new Promise((r) => setTimeout(r, 2000 * attempt));
            }
          }
          return "";
        };

        let cleanB64 = "";
        if (wantClean) {
        cleanB64 = await runArtboardPass("artboardClean", cleanTiers);
        if (cleanB64) {
          const cbin = atob(cleanB64);
          cleanB64 = "";
          const cleanBytes = Uint8Array.from(cbin, (c) => c.charCodeAt(0));
          const cleanPath = `renders/${uid}/2d-proofs/${packArtifactScope}_artboard-clean.png`;
          const { error: cErr } = await db.storage.from("wrap-files").upload(cleanPath, cleanBytes, {
            contentType: "image/png",
            upsert: !immutablePackArtifact,
          });
          if (!cErr) {
            artboardCleanUrl = db.storage.from("wrap-files").getPublicUrl(cleanPath).data.publicUrl;
            console.log(`[2D-PROOF] artboardClean emitted: ${artboardCleanUrl}`);
            // Best-effort durability — stash alongside flat_proof_url so a later
            // Build Assets can find it without re-generating.
            if (designiqGenerationId && persistCanonical !== false) {
              // Persist to the CANONICAL column too. designiq-keyed jobs
              // (RecreatePro) live in designiq_generations, where the CV update
              // below no-ops — so without this the clean base (Layer 0) was
              // generated and then silently dropped, leaving move-logo/remove-logo
              // nothing clean to sit on. Mirrors flat_proof_url's dual-write.
              try {
                await db.from("designiq_generations").update({ master_artboard_clean_url: artboardCleanUrl }).eq("id", canonicalDesigniqId);
              } catch (e) { console.warn(`[2D-PROOF] master_artboard_clean_url persist threw: ${String(e)}`); }
              try {
                const { data: viz } = await db.from("color_visualizations").select("admin_notes").eq("id", designiqGenerationId).maybeSingle();
                if (viz) {
                  let notes: Record<string, unknown> = {};
                  try { notes = typeof viz.admin_notes === "string" ? JSON.parse(viz.admin_notes) : (viz.admin_notes || {}); } catch { notes = {}; }
                  notes.artboard_clean_url = artboardCleanUrl;
                  await db.from("color_visualizations").update({ admin_notes: JSON.stringify(notes) }).eq("id", designiqGenerationId);
                }
              } catch (e) { console.warn(`[2D-PROOF] artboardClean persist threw: ${String(e)}`); }
            }
          } else {
            console.warn(`[2D-PROOF] artboardClean upload failed: ${cErr.message}`);
          }
        } else {
          console.warn(`[2D-PROOF] artboardClean pass returned no image (non-fatal)`);
        }
        } // end if (wantClean)

        // ── EMIT artboardBranded — the FULL branded flat artboard (logos + text KEPT) ──
        // Same faithful EDIT framing (de-vehicle + edge-fill, keep the exact
        // pixels) as the clean pass above — but it KEEPS every logo, company
        // name, phone number, and line of text. This is what the pre-purchase
        // entice slicer crops so the panels show the complete branded design.
        if (wantBranded) try {
          // STRENGTHENED (2026-07-27, same live failure as the clean pass): the
          // vehicle body/wheels/mirror/glass must be 100% gone, not partially
          // visible — the failure mode was a half-erased van with ghosting.
          const brandedTiers = [
            `Take the attached image and EDIT it — do NOT redraw, restyle, or reinvent anything. COMPLETELY remove every vehicle part: body, cab, windows and glass, wheels, tires, bumpers, mirrors, lights, the ground, and the studio background — 100% gone, zero remaining outline or shadow of any vehicle part. KEEP the ENTIRE wrap design EXACTLY as shown — identical colors, shards, gradients, and flow, AND every logo, company name, phone number, website, and line of text in its exact position, size, and style, fully opaque and legible. If it contains a flag, preserve that EXACT flag. The result must be flat, solid, and fully opaque everywhere the vehicle used to be — no ghosting, no partial transparency, no visible remnant of the vehicle. Fill and extend the real design seamlessly out to all four edges, so the result is ONE continuous flat rectangle of the COMPLETE branded artwork — no vehicle, no empty space, and nothing removed from the design itself.`,
            `Edit the attached image: delete all vehicle parts (body, glass, wheels, bumpers, ground, background) completely, with zero outline or ghosting left behind, but KEEP the entire wrap design INCLUDING all logos and text exactly as-is, fully opaque — do not redraw it. Extend the real design seamlessly to fill the whole rectangle edge to edge. Complete branded artwork only, no vehicle, no transparency.`,
            `Remove only the vehicle from the attached image completely, with no ghosting or faded remnants; keep the exact design pixels including all logos and text, and fill the design out to every edge as one flat continuous rectangle.`,
          ];
          // Same 4-attempt, fully-instrumented runner as the clean pass. This is
          // the pass the v2 surface master depends on, so its failures must be
          // legible — see the runner's note above for the measured 48.6% baseline.
          let brandedB64 = await runArtboardPass("artboardBranded", brandedTiers);
          if (brandedB64) {
            const bbin = atob(brandedB64);
            brandedB64 = "";
            const brandedBytes = Uint8Array.from(bbin, (c) => c.charCodeAt(0));
            const brandedRole = isSurfaceMasterRequest
              ? `surface-${requestedSurface}-branded`
              : "artboard-branded";
            const brandedPath = `renders/${uid}/2d-proofs/${surfaceArtifactScope}_${brandedRole}.png`;
            const { error: bErr } = await db.storage.from("wrap-files").upload(brandedPath, brandedBytes, {
              contentType: "image/png",
              upsert: !immutablePackArtifact,
            });
            if (!bErr || (
              immutablePackArtifact &&
              /exist|duplicate/i.test(String(bErr?.message || ""))
            )) {
              // A repeated request under the same fenced attempt reuses the
              // already-accepted immutable object. It never overwrites it with
              // a fresh generative result.
              artboardBrandedUrl = db.storage.from("wrap-files").getPublicUrl(brandedPath).data.publicUrl;
              console.log(`[2D-PROOF] artboardBranded ${bErr ? "reused" : "emitted"}: ${artboardBrandedUrl}`);
              if (designiqGenerationId && persistCanonical !== false) {
                // Canonical column for designiq-keyed jobs (see clean-artboard note).
                try {
                  await db.from("designiq_generations").update({ master_artboard_url: artboardBrandedUrl }).eq("id", canonicalDesigniqId);
                } catch (e) { console.warn(`[2D-PROOF] master_artboard_url persist threw: ${String(e)}`); }
                try {
                  const { data: viz } = await db.from("color_visualizations").select("admin_notes").eq("id", designiqGenerationId).maybeSingle();
                  if (viz) {
                    let notes: Record<string, unknown> = {};
                    try { notes = typeof viz.admin_notes === "string" ? JSON.parse(viz.admin_notes) : (viz.admin_notes || {}); } catch { notes = {}; }
                    notes.artboard_branded_url = artboardBrandedUrl;
                    await db.from("color_visualizations").update({ admin_notes: JSON.stringify(notes) }).eq("id", designiqGenerationId);
                  }
                } catch (e) { console.warn(`[2D-PROOF] artboardBranded persist threw: ${String(e)}`); }
              }
            } else {
              console.warn(`[2D-PROOF] artboardBranded upload failed: ${bErr.message}`);
            }
          } else {
            console.warn(`[2D-PROOF] artboardBranded pass returned no image (non-fatal)`);
          }
        } catch (e) {
          console.warn(`[2D-PROOF] artboardBranded generation threw (non-fatal): ${String(e)}`);
        }
      } catch (e) {
        console.warn(`[2D-PROOF] artboardClean generation threw (non-fatal): ${String(e)}`);
      }
    }

    if (isSurfaceMasterRequest && !artboardBrandedUrl) {
      // Report the per-attempt reasons, not just the absence. "Call 8 returned
      // nothing" sent three reviewers after an auth/fence bug that did not exist.
      const why = artboardDiagnostics.length
        ? artboardDiagnostics.join(" | ")
        : "no attempts recorded";
      console.error(
        `[2D-PROOF] Surface master missing for ${requestedSurface}; fenced attempt will retry. Attempts: ${why}`,
      );
      return new Response(JSON.stringify({
        success: false,
        error: `Call 8 did not emit a surface master for ${requestedSurface}: ${why}`,
        code: "surface_master_missing",
        attempts: artboardDiagnostics,
        retryable: true,
        retryAfterSeconds: 30,
        surfaceSide: requestedSurface,
        artifactAttemptId: trustedArtifactAttempt,
        manifestHash: String(manifestHash || "").toLowerCase(),
        enticePackId: trustedEnticePackId,
        surfaceMasterContractVersion: SURFACE_MASTER_CONTRACT,
      }), {
        status: 503,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Retry-After": "30",
        },
      });
    }

    console.log(`[2D-PROOF] Done: ${publicUrl}${artboardCleanUrl ? ` | artboardClean: ${artboardCleanUrl}` : ""}${artboardBrandedUrl ? ` | artboardBranded: ${artboardBrandedUrl}` : ""}`);
    return new Response(JSON.stringify({
      success: true,
      proofUrl: publicUrl,
      artboardCleanUrl,
      artboardBrandedUrl,
      surfaceMastersContract: "call7-surface-manifest.v1",
      surfaceMasters: surfaceMasters || [],
      // Sanity-gate verdicts for the shipped candidates (null on idempotent
      // reuse — the replayed masters were gated when first authored).
      call7Sanity: call7SanityBySide
        ? { contract: "call7-sanity-gate.v1", sides: call7SanityBySide }
        : null,
      totalSqFt: proofTotalSqFt,
      // Additive: exact per-tile geometry on the composed sheet. Present only
      // when this call actually composed one (an idempotent reuse returns the
      // stored artifact and no rects).
      //
      // `proofTileBoxes` is the load-bearing one: the tile pre-crop that feeds
      // per-side extraction (panelize-artboard) otherwise locates each view with
      // a Gemini vision pass that its own code notes "varies run-to-run" and
      // retries up to 3 times. The sheet layout is code now, so those positions
      // are known exactly — handing them over makes the pre-crop pure geometry.
      // Already in panelize-artboard's convention: 0-1000 normalized
      // [ymin, xmin, ymax, xmax], keyed by its canonical side labels.
      ...(proofTileRects
        ? {
            proofTileRects,
            proofSheetWidth: proofSheetSize?.w ?? PROOF_SHEET_W,
            proofSheetHeight: proofSheetSize?.h ?? null,
            proofTileBoxes: proofSheetSize
              ? proofTileBoxes(proofTileRects, proofSheetSize.w, proofSheetSize.h)
              : {},
          }
        : {}),
      ...(isSurfaceMasterRequest ? {
        surfaceSide: requestedSurface,
        surfaceMasterUrl: artboardBrandedUrl,
        artifactAttemptId: trustedArtifactAttempt,
        manifestHash: String(manifestHash || "").toLowerCase(),
        enticePackId: trustedEnticePackId,
        surfaceMasterContractVersion: SURFACE_MASTER_CONTRACT,
        surfaceInputFingerprint,
      } : {}),
      ...(normalProofIdempotency ? {
        artifactAttemptId: trustedArtifactAttempt,
        idempotencyContract: NORMAL_PROOF_IDEMPOTENCY_CONTRACT,
        idempotencyKeyHash: normalProofIdempotency.keyHash,
        idempotencyMaterialHash: normalProofIdempotency.materialHash,
        sourceEvidenceContract:
          NORMAL_PROOF_SOURCE_EVIDENCE_CONTRACT,
        sourceEvidenceHash:
          normalProofIdempotency.sourceEvidenceHash,
        idempotentReuse: normalProofIdempotency.reused,
      } : {}),
      // Downstream deterministic extraction needs the exact Call 8 tokens, not
      // merely a boolean saying that some dimensions existed.
      dimensionsResolved: dimensions || null,
      hasResolvedDimensions: dimsResolved,
      vehicleType: isTrailer ? "trailer" : (explicitVehicleType || "standard"),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[2D-PROOF] Error:", err);
    return new Response(JSON.stringify({ success: false, error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
