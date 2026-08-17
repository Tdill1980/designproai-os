// ============================================================
// PRODUCTIONFLOW™ ORCHESTRATOR V2 — STATE MACHINE
// Edge Function: run-production-flow
//
// RUNS ONE STEP PER INVOCATION. Saves state. Self-invokes for next.
// This prevents the 60-second edge function timeout.
//
// THREE MODES:
//   project    — Step-chain panelizer + QA + upsells
//   quick_prep — Token-based RIP-adjacent production accelerators
//   analyze    — Pre-purchase file analysis (walk-in diagnosis)
//
// Deploy: supabase functions deploy run-production-flow
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { lookupVehicle } from '../_shared/panelizer-os/constants.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── SIMPLIFIED PIPELINE — Single Artboard Output ────────────
// v3: No panel extraction. One artboard TIFF.
// Step 1: Validate inputs + resolve vehicle specs
// Step 2: Generate master artboard via Gemini (generate-artboard-simple)
// Step 3: Upscale artboard to production TIFF (panelizer-step-upscale in artboardMode)
const PANELIZER_STEPS = [
  { key: 'validate',       fn: 'panelizer-step-validate',     label: 'Validating inputs',              pfStage: 1, perPanel: false },
  { key: 'artboard',       fn: 'generate-artboard-simple',    label: 'Generating master artboard',     pfStage: 1, perPanel: false, timeoutMs: 120000 },
  { key: 'upscale-tiff',   fn: 'panelizer-step-upscale',      label: 'Upscaling artboard to TIFF',     pfStage: 2, perPanel: false, timeoutMs: 120000 },
]

// Customer-facing stage labels
const PF_STAGES: Record<number, { status: string; label: string }> = {
  1: { status: 'panelizing',          label: 'Generating Master Artboard' },
  2: { status: 'optimizing',          label: 'Upscaling to Production TIFF' },
  3: { status: 'qa_checking',         label: 'Quality Validation' },
  4: { status: 'packaging',           label: 'Building Production Files' },
}

// ── QUICK PREP PACKAGES ──────────────────────────────────────
// RIP-adjacent production accelerators. Min 5 tokens. Premium.
const QUICK_PREP_PACKAGES: Record<string, any> = {
  basic_cut_prep: {
    id: 'basic_cut_prep', name: 'Basic Cut Prep', tokens: 5,
    description: 'Background removal → Silhouette contour → Spot layer injection',
    steps: ['bg_remove', 'trace_silhouette', 'spot_layer_inject'],
    estimated_time_saved_min: 20,
    output_format: 'PDF with CutContour spot color',
    rip_compatible: ['VersaWorks', 'Onyx', 'Flexi', 'SAi'],
  },
  pro_cut_prep: {
    id: 'pro_cut_prep', name: 'Pro Cut Prep', tokens: 8,
    description: 'Vector rebuild → Offset contour → Node cleanup → Spot layer → CMYK',
    steps: ['bg_remove', 'vector_rebuild', 'offset_contour', 'node_cleanup', 'spot_layer_inject', 'cmyk_convert'],
    estimated_time_saved_min: 42,
    output_format: 'Production PDF (CMYK + CutContour)',
    rip_compatible: ['VersaWorks', 'Onyx', 'Caldera', 'Flexi', 'SAi', 'EFI Fiery'],
  },
  advanced_output_prep: {
    id: 'advanced_output_prep', name: 'Advanced Output Prep', tokens: 10,
    description: 'Full pipeline: vector → contour → bleed → spot validate → layers → production PDF',
    steps: ['bg_remove', 'vector_rebuild', 'offset_contour', 'node_cleanup', 'bleed_extend', 'spot_color_validate', 'layer_cleanup', 'cmyk_convert', 'production_pdf'],
    estimated_time_saved_min: 58,
    output_format: 'Production PDF (CMYK + CutContour + Bleed + Layers)',
    rip_compatible: ['VersaWorks', 'Onyx', 'Caldera', 'Flexi', 'SAi', 'EFI Fiery'],
  },
}

const PREP_STEPS: Record<string, any> = {
  bg_remove:           { label: 'Background Removal',    fn: 'quick-prep-bg-remove',     tokens: 2 },
  trace_silhouette:    { label: 'Silhouette Trace',      fn: 'quick-prep-vector-trace',  tokens: 2 },
  vector_rebuild:      { label: 'Vector Rebuild',        fn: 'quick-prep-vector-trace',  tokens: 3 },
  offset_contour:      { label: 'Offset Contour Path',   fn: 'quick-prep-cut-contour',   tokens: 2 },
  node_cleanup:        { label: 'Node Optimization',     fn: 'quick-prep-node-optimize', tokens: 1 },
  spot_layer_inject:   { label: 'CutContour Spot Layer', fn: 'quick-prep-spot-inject',   tokens: 1 },
  spot_color_validate: { label: 'Spot Color Validation', fn: 'quick-prep-spot-validate', tokens: 1 },
  cmyk_convert:        { label: 'CMYK Conversion',       fn: 'quick-prep-color-sep',     tokens: 2 },
  bleed_extend:        { label: 'Bleed Extension',       fn: 'quick-prep-bleed',         tokens: 2 },
  layer_cleanup:       { label: 'Layer Cleanup',          fn: 'quick-prep-layer-cleanup', tokens: 1 },
  production_pdf:      { label: 'Production PDF Export', fn: 'quick-prep-pdf-export',    tokens: 2 },
  upscale_4x:          { label: 'AI Upscale (4x)',       fn: 'quick-prep-upscale',       tokens: 3 },
}

// ══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    const body = await req.json()
    const principal = await resolvePrincipal(req, supabase, serviceKey)
    const mode = String(body.mode || 'project')
    console.log('[ORCH] Request received:', JSON.stringify({ mode, trigger: body.trigger, job_id: body.job_id, step_key: body.step_key }))
    // Package metadata is the only public/read-only mode. Every mode that reads
    // tenant data, spends tokens, mutates a job, or invokes a paid tool must be
    // bound to either a verified user JWT or the service principal.
    if (principal.kind === 'anonymous' && mode !== 'get_packages') {
      return designproJson({ error: 'Authentication required' }, 401)
    }
    switch (mode) {
      case 'designpro_job':     return await handleDesignProJob(body, principal, supabase, supabaseUrl, serviceKey)
      case 'designpro_revision': return await handleDesignProRevision(body, principal, supabase)
      case 'project':           return await handleProject(body, principal, supabase, supabaseUrl, serviceKey)
      case 'quick_prep':        return await handleQuickPrep(body, principal, supabase, supabaseUrl, serviceKey)
      case 'standalone_service': return await handleStandaloneService(body, principal, supabase, supabaseUrl, serviceKey)
      case 'analyze':           return await handleAnalyze(body, supabase, supabaseUrl, serviceKey)
      case 'get_packages':      return ok({ packages: QUICK_PREP_PACKAGES, steps: PREP_STEPS })
      case 'get_history':       return await handleGetHistory(body, principal, supabase)
      case 'get_notifications': return await handleGetNotifications(body, principal, supabase)
      case 'mark_read':         return await handleMarkRead(body, principal, supabase)
      default: return fail(`Invalid mode: ${body.mode}`)
    }
  } catch (err) {
    console.error('Orchestrator error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})

type RequestPrincipal = { kind: 'service' } | { kind: 'user'; userId: string } | { kind: 'anonymous' }

async function resolvePrincipal(req: Request, db: any, serviceKey: string): Promise<RequestPrincipal> {
  // The droplet workflow runner authenticates every callFn with the shared
  // WORKER_SECRET header, exactly as generate-2d-proof, save-production-panels
  // and panel-artboard-generator already accept it. This function only honored
  // the exact env service key — and the runner's env carries the LEGACY JWT
  // service_role key (the Management API's api-keys reveal), which this
  // project's functions no longer receive as their own SUPABASE_SERVICE_ROLE_KEY.
  // Live: the first activate_print_worker stage ever to run (run 6366dddd,
  // 2026-08-11 20:35 UTC) died on `run-production-flow_failed: Authentication
  // required` because advance_domain resolved the runner as anonymous.
  const workerSecret = (Deno.env.get('WORKER_SECRET') || '').trim()
  const suppliedWorkerSecret = String(req.headers.get('x-worker-secret') || '').trim()
  if (workerSecret && suppliedWorkerSecret === workerSecret) return { kind: 'service' }
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!bearer) return { kind: 'anonymous' }
  if (bearer === serviceKey) return { kind: 'service' }
  const { data, error } = await db.auth.getUser(bearer)
  if (error || !data?.user?.id) return { kind: 'anonymous' }
  return { kind: 'user', userId: data.user.id }
}

function bindLegacyUserId(body: any, principal: RequestPrincipal): string | Response {
  const requestedUserId = String(body.user_id || body.userId || '').trim()
  if (principal.kind === 'anonymous') {
    return designproJson({ error: 'Authentication required' }, 401)
  }
  if (principal.kind === 'user') {
    if (requestedUserId && requestedUserId !== principal.userId) {
      return designproJson(
        { error: 'Request does not match the authenticated user' },
        403,
      )
    }
    return principal.userId
  }
  if (!requestedUserId) {
    return designproJson(
      { error: 'user_id is required for service-authorized requests' },
      400,
    )
  }
  return requestedUserId
}

// ══════════════════════════════════════════════════════════════
// DESIGNPRO JOB API — DURABLE, IDEMPOTENT SERVER OWNERSHIP
// ══════════════════════════════════════════════════════════════

const DESIGNPRO_WORKFLOW_TYPE = "designpro.production_pack";
const DESIGNPRO_WORKFLOW_VERSION = "designpro.production_pack.v1";
const DESIGNPRO_ENTICE_WORKFLOW_TYPE = "designpro.entice_pack";
const DESIGNPRO_ENTICE_WORKFLOW_VERSION = "designpro.entice_pack.v2";

// ── SURFACE MANIFEST ──────────────────────────────────────────
//
// `enqueue_designpro_entice_pack` hard-requires
// `admin_notes.surface_options.expectedPanelSides` to be a non-empty array
// and raises `revision_surface_manifest_required` otherwise. It is also
// called transitively by `save_and_enqueue_designpro_revision`, so a missing
// manifest breaks BOTH the workflow start AND the view save (the whole save
// transaction rolls back, silently discarding rendered views).
//
// Only DesignPro's generate flow ever wrote the manifest. As of 2026-07-30
// just 4 of the last 177 jobs satisfied the guard — 0 of 37 RecreatePro jobs
// and 4 of 140 DesignPro jobs — so ~98% of jobs could neither persist their
// views nor start a production proof.
//
// The guard is correct: the workflow genuinely needs to know which sides to
// produce. These helpers SATISFY it rather than weakening it, deriving the
// default deterministically from vehicle type and mirroring DesignPro's own
// `resolveSelectedPanelSides` (src/hooks/useDesignPanelProLogic.ts) so a
// backfilled job produces the exact same panel set an explicitly-configured
// one would. An existing manifest is never overwritten — a real customer
// selection always wins.

function readDesignProNotes(raw: unknown): Record<string, any> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, any>;
  }
  if (typeof raw === "string" && raw.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, any>;
      }
    } catch {
      // Non-JSON admin_notes is legacy free text; treat as empty.
    }
  }
  return {};
}

function existingSurfaceOptions(
  notes: Record<string, any>,
): Record<string, any> | null {
  for (const key of ["surface_options", "production_options"]) {
    const value = notes[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, any>;
    }
  }
  return null;
}

function hasSurfaceManifest(notes: Record<string, any>): boolean {
  const sides = existingSurfaceOptions(notes)?.expectedPanelSides;
  return Array.isArray(sides) && sides.length > 0;
}

// Mirrors resolveSelectedPanelSides in useDesignPanelProLogic.ts. Jobs with no
// recorded selection default to full coverage, which is DesignPro's own
// default and the six panels the product north star specifies.
function deriveSurfaceOptions(
  vehicleType: string,
  previous: Record<string, any> | null,
): Record<string, any> {
  const normalized = String(vehicleType || "").trim().toLowerCase();
  const sides =
    normalized === "trailer"
      ? ["DRIVER SIDE", "PASSENGER SIDE", "FRONT", "REAR"]
      : ["DRIVER SIDE", "PASSENGER SIDE", "HOOD", "ROOF", "FRONT", "REAR"];
  return {
    ...(previous || {}),
    productType: "vehicle_wrap",
    coverage: "full",
    expectedPanelSides: sides,
    addHood: sides.includes("HOOD"),
    addRoof: sides.includes("ROOF"),
    roofSize: sides.includes("ROOF") ? "medium" : "none",
    addFrontBumper: sides.includes("FRONT"),
    addRearBumper: sides.includes("REAR"),
    // Marks this as a server-derived default rather than a customer choice,
    // so a later explicit selection stays distinguishable.
    derivedBy: "run-production-flow",
    derivedFromVehicleType: normalized || "unknown",
  };
}

function designproJson(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function designProTiming(workflowRun: any, stages: any[]) {
  const now = Date.now();
  const timestamp = (value: unknown): number | null => {
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const acceptedAt =
    timestamp(workflowRun?.created_at) ||
    timestamp(workflowRun?.started_at);
  const finishedAt =
    timestamp(workflowRun?.finished_at) ||
    timestamp(workflowRun?.completed_at);
  return {
    acceptedAt: acceptedAt ? new Date(acceptedAt).toISOString() : null,
    elapsedMs: acceptedAt
      ? Math.max(0, (finishedAt || now) - acceptedAt)
      : null,
    stages: (stages || []).map((stage) => {
      const startedAt = timestamp(stage?.started_at);
      const completedAt = timestamp(stage?.completed_at);
      return {
        stageKey: stage?.stage_key,
        scopeKey: stage?.scope_key || "",
        status: stage?.status,
        attempt: stage?.attempt,
        durationMs: startedAt
          ? Math.max(
              0,
              (completedAt ||
                timestamp(stage?.updated_at) ||
                now) - startedAt,
            )
          : null,
      };
    }),
  };
}

function canonicalizeDesignPro(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeDesignPro);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalizeDesignPro(item)]),
    );
  }
  return value;
}

async function designproHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify(canonicalizeDesignPro(value)),
  );
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function stabilizeDesignProInput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stabilizeDesignProInput);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stabilizeDesignProInput(item)]),
    );
  }
  if (typeof value === "string") {
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        return `${parsed.origin}${parsed.pathname}`;
      }
    } catch {
      // Ordinary concept copy is not a URL and remains byte-for-byte material.
    }
  }
  return value;
}

const DESIGNPRO_REVISION_VIEW_KEYS = [
  "side",
  "passenger-side",
  "hood_detail",
  "front",
  "rear",
  "close-up",
  "roof",
] as const;

function canonicalChangedRevisionViews(
  previous: unknown,
  current: unknown,
): string[] {
  const before = previous && typeof previous === "object" && !Array.isArray(previous)
    ? previous as Record<string, unknown>
    : {};
  const after = current && typeof current === "object" && !Array.isArray(current)
    ? current as Record<string, unknown>
    : {};
  return DESIGNPRO_REVISION_VIEW_KEYS.filter((key) =>
    (stabilizeDesignProInput(before[key]) || null) !==
    (stabilizeDesignProInput(after[key]) || null)
  );
}

function designProSafeMaterialUrl(raw: unknown): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    const configuredHosts = String(
      Deno.env.get("DESIGNPRO_PRODUCTION_ASSET_HOSTS") || "",
    )
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    const supabaseHost = (() => {
      try {
        return new URL(Deno.env.get("SUPABASE_URL") || "").hostname.toLowerCase();
      } catch {
        return "";
      }
    })();
    const allowedHosts = new Set(
      [supabaseHost, ...configuredHosts].filter(Boolean),
    );
    const blockedHost =
      hostname === "localhost" ||
      hostname === "::1" ||
      hostname.startsWith("127.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("169.254.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
    return parsed.protocol === "https:" &&
        !blockedHost &&
        allowedHosts.has(hostname)
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

async function fingerprintDesignProMaterial(
  rawUrl: unknown,
): Promise<Record<string, unknown>> {
  const url = designProSafeMaterialUrl(rawUrl);
  if (!url) throw new Error("Production material URL is missing or unsafe");

  // The enqueue and worker contracts must compare the same immutable evidence.
  // Object-store ETags are not portable content hashes (and can be multipart or
  // weak validators), so always hash the bytes rather than accepting HEAD as a
  // shortcut. The source set is fetched concurrently below to keep this bounded.
  const response = await fetch(url, {
    redirect: "manual",
    cache: "no-store",
    headers: {
      "Accept-Encoding": "identity",
      "Cache-Control": "no-cache",
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Production material fingerprint returned HTTP ${response.status}`);
  }
  const declaredBytes = Number(response.headers.get("content-length") || 0);
  const maxBytes = 32 * 1024 * 1024;
  if (declaredBytes > maxBytes) {
    throw new Error("Production material exceeds the fingerprint size limit");
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    if (!chunk?.byteLength) continue;
    totalBytes += chunk.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel("fingerprint size limit exceeded");
      throw new Error("Production material exceeds the fingerprint size limit");
    }
    chunks.push(chunk);
  }
  if (totalBytes === 0) {
    throw new Error("Production material is empty or exceeds the fingerprint size limit");
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const objectVersion = String(
    response.headers.get("x-goog-generation") ||
      response.headers.get("x-amz-version-id") ||
      response.headers.get("x-ms-version-id") ||
      "",
  ).trim();
  const etag = String(response.headers.get("etag") || "").trim();
  const strongEtag = etag && !/^W\//i.test(etag) ? etag : "";
  return {
    sha256: Array.from(digest, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
    bytes: bytes.byteLength,
    contentLength: bytes.byteLength,
    contentType: response.headers.get("content-type") || null,
    ...(objectVersion
      ? {
          validatorKind: "object-version",
          validator: objectVersion,
        }
      : strongEtag
        ? {
            validatorKind: "etag",
            validator: strongEtag,
          }
        : {}),
  };
}

function designProRevisionSourceUrls(
  renderUrls: unknown,
): Record<string, string> {
  if (
    !renderUrls ||
    typeof renderUrls !== "object" ||
    Array.isArray(renderUrls)
  ) {
    return {};
  }
  const derivedKey =
    /(^|[_\s-])(proof|panel|artboard|logo|overlay|master|pack|zip|tiff|eps|production|clean|background)($|[_\s-])/i;
  const derivedPath =
    /\/(?:2d-proofs|panels|graphics-pack|production-packs|artboards)\//i;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(
    renderUrls as Record<string, unknown>,
  ).sort(([left], [right]) => left.localeCompare(right))) {
    const normalizedKey = String(key)
      .trim()
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase();
    if (
      !normalizedKey ||
      derivedKey.test(normalizedKey) ||
      /(proof2?_?d|2d_?proof|master_?artboard|logo_?pack)/.test(normalizedKey) ||
      /(^|[_\s-])(close|macro|zoom)($|[_\s-])/.test(normalizedKey)
    ) {
      continue;
    }
    const safe = designProSafeMaterialUrl(value);
    if (safe && !derivedPath.test(safe)) result[key] = safe;
  }
  return result;
}

async function fingerprintDesignProRevisionSources(
  renderUrls: unknown,
): Promise<Record<string, unknown>> {
  const sourceUrls = designProRevisionSourceUrls(renderUrls);
  if (!Object.keys(sourceUrls).length) {
    throw new Error("No saved revision views could be fingerprinted");
  }
  const byUrl = new Map<string, Promise<Record<string, unknown>>>();
  const queue = Object.entries(sourceUrls);
  const result: Record<string, unknown> = {};
  const worker = async () => {
    while (queue.length) {
      const next = queue.shift();
      if (!next) return;
      const [key, sourceUrl] = next;
      let pending = byUrl.get(sourceUrl);
      if (!pending) {
        pending = fingerprintDesignProMaterial(sourceUrl);
        byUrl.set(sourceUrl, pending);
      }
      result[key] = await pending;
    }
  };
  // Web Crypto needs each full input in memory. Two workers overlap network
  // latency without risking six simultaneous 32 MB buffers in an edge isolate.
  await Promise.all(
    Array.from(
      { length: Math.min(2, queue.length) },
      () => worker(),
    ),
  );
  return result;
}

async function resolveDesignProSubmissionMaterial(
  db: any,
  panelizerJob: any,
): Promise<Record<string, unknown>> {
  const generationId = String(panelizerJob.generation_id || "");
  const materialUrls: Record<string, string> = {};
  const add = (key: string, raw: unknown) => {
    const url = designProSafeMaterialUrl(raw);
    if (url) materialUrls[key] = url;
  };
  add("approvedRender", panelizerJob.approved_render_url);
  const jobViews =
    panelizerJob.all_view_urls &&
    typeof panelizerJob.all_view_urls === "object" &&
    !Array.isArray(panelizerJob.all_view_urls)
      ? panelizerJob.all_view_urls
      : {};
  for (const [key, value] of Object.entries(jobViews).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    add(`jobView:${key}`, value);
  }

  let canonicalId = generationId;
  const { data: visualization, error: visualizationError } = await db
    .from("color_visualizations")
    .select("admin_notes,render_urls")
    .eq("id", generationId)
    .maybeSingle();
  if (visualizationError) {
    throw new Error(
      `Unable to resolve visualization material: ${visualizationError.message}`,
    );
  }
  try {
    const notes =
      typeof visualization?.admin_notes === "string"
        ? JSON.parse(visualization.admin_notes)
        : visualization?.admin_notes || {};
    canonicalId = String(notes?.designiq_generation_id || generationId);
    add("visualizationProof", notes?.flat_proof_url);
  } catch {
    canonicalId = generationId;
  }
  const visualizationViews =
    visualization?.render_urls &&
    typeof visualization.render_urls === "object" &&
    !Array.isArray(visualization.render_urls)
      ? visualization.render_urls
      : {};
  for (const [key, value] of Object.entries(visualizationViews).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    add(`visualizationView:${key}`, value);
  }

  const generationIds = Array.from(
    new Set([generationId, canonicalId].filter(Boolean)),
  );
  if (generationIds.length) {
    const { data: generations, error: generationsError } = await db
      .from("designiq_generations")
      .select(
        "id,flat_proof_url,master_artboard_url,master_artboard_clean_url,render_urls",
      )
      .in("id", generationIds);
    if (generationsError) {
      throw new Error(
        `Unable to resolve generation material: ${generationsError.message}`,
      );
    }
    for (const generation of generations || []) {
      const prefix = `generation:${generation.id}`;
      add(`${prefix}:proof`, generation.flat_proof_url);
      add(`${prefix}:master`, generation.master_artboard_url);
      add(`${prefix}:cleanMaster`, generation.master_artboard_clean_url);
      const renders =
        generation.render_urls &&
        typeof generation.render_urls === "object" &&
        !Array.isArray(generation.render_urls)
          ? generation.render_urls
          : {};
      for (const [key, value] of Object.entries(renders).sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        add(`${prefix}:view:${key}`, value);
      }
    }

  }

  const unique = new Map<string, Promise<Record<string, unknown>>>();
  const fingerprints: Record<string, unknown> = {};
  for (const [key, url] of Object.entries(materialUrls).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    let fingerprint = unique.get(url);
    if (!fingerprint) {
      fingerprint = fingerprintDesignProMaterial(url);
      unique.set(url, fingerprint);
    }
    fingerprints[key] = await fingerprint;
  }
  if (!Object.keys(fingerprints).length) {
    throw new Error("No production material could be fingerprinted");
  }
  return fingerprints;
}

async function handleDesignProRevision(
  body: any,
  principal: RequestPrincipal,
  db: any,
) {
  if (principal.kind === "anonymous") {
    return designproJson({ error: "Authentication required" }, 401);
  }
  const boundUserId = bindLegacyUserId(body, principal);
  if (boundUserId instanceof Response) return boundUserId;
  const action = String(body.action || "status");

  if (action === "save_revision") {
    const visualizationId = String(
      body.visualizationId || body.visualization_id || "",
    ).trim();
    const expectedUpdatedAt = String(
      body.expectedUpdatedAt || body.expected_updated_at || "",
    ).trim();
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!visualizationId || !uuid.test(visualizationId)) {
      return designproJson(
        {
          error: "visualizationId must be a valid UUID",
          code: "visualization_id_required",
        },
        400,
      );
    }
    if (
      !expectedUpdatedAt ||
      !Number.isFinite(Date.parse(expectedUpdatedAt))
    ) {
      return designproJson(
        {
          error: "expectedUpdatedAt required",
          code: "expected_updated_at_required",
        },
        400,
      );
    }

    const rawRenderUrls = body.renderUrls || body.render_urls;
    if (
      !rawRenderUrls ||
      typeof rawRenderUrls !== "object" ||
      Array.isArray(rawRenderUrls)
    ) {
      return designproJson(
        {
          error: "renderUrls must be a JSON object",
          code: "invalid_revision_render_urls",
        },
        400,
      );
    }
    const renderEntries = Object.entries(
      rawRenderUrls as Record<string, unknown>,
    );
    if (!renderEntries.length || renderEntries.length > 32) {
      return designproJson(
        {
          error: "renderUrls must contain one to 32 saved views",
          code: "invalid_revision_render_urls",
        },
        400,
      );
    }
    const renderUrls: Record<string, string> = {};
    for (const [rawKey, rawUrl] of renderEntries) {
      const key = String(rawKey || "").trim();
      const url = designProSafeMaterialUrl(rawUrl);
      if (
        !key ||
        key.length > 80 ||
        Object.prototype.hasOwnProperty.call(renderUrls, key) ||
        !url
      ) {
        return designproJson(
          {
            error: `The saved URL for "${key || "unnamed view"}" is invalid`,
            code: "invalid_revision_render_urls",
          },
          400,
        );
      }
      renderUrls[key] = url;
    }

    const rawAdminNotesPatch =
      body.adminNotesPatch || body.admin_notes_patch || {};
    if (
      !rawAdminNotesPatch ||
      typeof rawAdminNotesPatch !== "object" ||
      Array.isArray(rawAdminNotesPatch)
    ) {
      return designproJson(
        {
          error: "adminNotesPatch must be a JSON object",
          code: "invalid_admin_notes_patch",
        },
        400,
      );
    }
    const adminNotesPatch = rawAdminNotesPatch as Record<string, unknown>;
    const serializedAdminPatch = JSON.stringify(adminNotesPatch);
    if (serializedAdminPatch.length > 256_000) {
      return designproJson(
        {
          error: "adminNotesPatch is too large",
          code: "invalid_admin_notes_patch",
        },
        400,
      );
    }
    if (
      adminNotesPatch.surface_options !== undefined &&
      (!adminNotesPatch.surface_options ||
        typeof adminNotesPatch.surface_options !== "object" ||
        Array.isArray(adminNotesPatch.surface_options))
    ) {
      return designproJson(
        {
          error: "surface_options must be a JSON object",
          code: "invalid_surface_options",
        },
        400,
      );
    }

    const trigger = String(body.trigger || "revision_saved").trim();
    const allowedTriggers = new Set([
      "initial_generation",
      "revision_saved",
      "precise_edit",
      "missing_views_completed",
      "view_regenerated",
      "view_deleted",
      "finish_fixed",
      "passenger_mirrored",
      // RevisionStudio's "Build 2D Production Proof" button has always sent
      // this: the design is unchanged and the operator wants a proof built for
      // it. The start path below never validated the trigger, so it worked
      // there while save_revision would have refused it as invalid_trigger.
      "proof_requested",
    ]);
    if (!allowedTriggers.has(trigger)) {
      return designproJson(
        { error: "Unsupported revision trigger", code: "invalid_trigger" },
        400,
      );
    }
    const change =
      body.change && typeof body.change === "object" && !Array.isArray(body.change)
        ? body.change as Record<string, unknown>
        : {};
    if (
      change.type !== undefined &&
      !["generate", "edit", "revision"].includes(String(change.type))
    ) {
      return designproJson(
        { error: "Unsupported revision change type", code: "invalid_change" },
        400,
      );
    }
    if (
      change.viewKeys !== undefined &&
      (!Array.isArray(change.viewKeys) ||
        change.viewKeys.some(
          (key: unknown) =>
            !String(key || "").trim() || String(key).length > 80,
        ))
    ) {
      return designproJson(
        { error: "change.viewKeys is invalid", code: "invalid_change" },
        400,
      );
    }

    const vehicleTypeValue = String(
      body.vehicleType || body.vehicle_type || "",
    ).trim().toLowerCase();
    const allowedVehicleTypes = new Set([
      "car",
      "truck",
      "van",
      "suv",
      "crossover",
      "standard",
      "trailer",
      "bus",
      "rv",
      "boat",
      "motorcycle",
      "specialty",
    ]);
    if (
      vehicleTypeValue &&
      !allowedVehicleTypes.has(vehicleTypeValue)
    ) {
      return designproJson(
        { error: "Unsupported vehicleType", code: "invalid_vehicle_type" },
        400,
      );
    }
    const finishValue = String(
      body.finishType || body.finish_type || "",
    ).trim().toLowerCase();
    const normalizedFinish =
      finishValue === "gloss"
        ? "Gloss"
        : finishValue === "satin"
          ? "Satin"
          : finishValue === "matte"
            ? "Matte"
            : "";
    if (finishValue && !normalizedFinish) {
      return designproJson(
        { error: "Unsupported finishType", code: "invalid_finish_type" },
        400,
      );
    }

    const assertedGenerationId = String(
      body.generationId || body.generation_id || "",
    ).trim();
    if (assertedGenerationId && !uuid.test(assertedGenerationId)) {
      return designproJson(
        { error: "generationId must be a valid UUID", code: "invalid_generation_id" },
        400,
      );
    }
    // Resolve the exact pre-save pixels once. The server, not the browser,
    // decides which canonical surfaces changed before hashing and freezing the
    // revision snapshot.
    const { data: revisionSourceRow, error: revisionSourceError } = await db
      .from("color_visualizations")
      .select("admin_notes,vehicle_type,render_urls")
      .eq("id", visualizationId)
      .maybeSingle();
    if (revisionSourceError) {
      return designproJson({ error: revisionSourceError.message }, 503);
    }
    if (!revisionSourceRow) {
      return designproJson(
        { error: "Visualization not found", code: "revision_visualization_not_found" },
        404,
      );
    }
    change.viewKeys = canonicalChangedRevisionViews(
      revisionSourceRow.render_urls,
      renderUrls,
    );

    // SURFACE MANIFEST BACKFILL (save path).
    //
    // This RPC calls `enqueue_designpro_entice_pack` inside its transaction,
    // so a missing manifest raises `revision_surface_manifest_required` and
    // rolls back the ENTIRE save — the caller's rendered views are silently
    // discarded. That is the "it had all 7 angles yet the job is missing 6"
    // report: the views were rendered and paid for, then thrown away.
    //
    // Unlike the `start` path this needs no separate write: the RPC merges
    // adminNotesPatch into admin_notes in the same transaction, before the
    // enqueue reads it back. Injecting here is therefore atomic and does not
    // disturb the caller's expectedUpdatedAt. Must happen BEFORE the hash
    // below, which covers adminNotesPatch.
    if (adminNotesPatch.surface_options === undefined) {
      if (revisionSourceRow) {
        const currentNotes = readDesignProNotes(revisionSourceRow.admin_notes);
        if (!hasSurfaceManifest(currentNotes)) {
          const surfaceOptions = deriveSurfaceOptions(
            vehicleTypeValue ||
              String(revisionSourceRow.vehicle_type || currentNotes.vehicle_type || ""),
            existingSurfaceOptions(currentNotes),
          );
          adminNotesPatch.surface_options = surfaceOptions;
          console.log(
            `[run-production-flow] surface manifest backfilled (save_revision): viz=${visualizationId} sides=${surfaceOptions.expectedPanelSides.join("/")} vehicle_type=${surfaceOptions.derivedFromVehicleType} trigger=${trigger}`,
          );
        }
      }
    }

    const submissionHash = await designproHash({
      definitionVersion: DESIGNPRO_ENTICE_WORKFLOW_VERSION,
      visualizationId,
      expectedUpdatedAt,
      renderUrls: stabilizeDesignProInput(renderUrls),
      adminNotesPatch: stabilizeDesignProInput(adminNotesPatch),
      vehicleType: vehicleTypeValue || null,
      finishType: normalizedFinish || null,
      assertedGenerationId: assertedGenerationId || null,
      trigger,
      change: stabilizeDesignProInput(change),
    });
    const callerKey = String(
      body.idempotencyKey || body.idempotency_key || "",
    ).trim();
    if (callerKey.length > 240) {
      return designproJson(
        { error: "idempotencyKey is too long", code: "invalid_idempotency_key" },
        400,
      );
    }
    const idempotencyKey = callerKey
      ? `designpro-entice-save:${boundUserId}:${callerKey}`
      : `designpro-entice-save:${boundUserId}:${visualizationId}:${expectedUpdatedAt}:${submissionHash}`;

    const { data: savedAndEnqueued, error: saveError } = await db.rpc(
      "save_and_enqueue_designpro_revision",
      {
        p_visualization_id: visualizationId,
        p_expected_updated_at: expectedUpdatedAt,
        p_requested_by: boundUserId,
        p_render_urls: renderUrls,
        p_admin_notes_patch: adminNotesPatch,
        p_vehicle_type: vehicleTypeValue || null,
        p_finish_type: normalizedFinish || null,
        p_idempotency_key: idempotencyKey,
        p_submission_hash: submissionHash,
        p_trigger: trigger,
        p_change: change,
        p_asserted_generation_id: assertedGenerationId || null,
        p_definition_version: DESIGNPRO_ENTICE_WORKFLOW_VERSION,
      },
    );
    if (saveError) {
      const message = String(saveError.message || "");
      // The RPC's exception name is the ONLY thing that identifies which of the
      // seven guards in save_and_enqueue_designpro_revision /
      // enqueue_designpro_entice_pack refused this submit. It was read here and
      // never logged, so every failure reached the edge logs as a bare 404/409/
      // 503 with no cause — three separate debugging sessions on 2026-07-30
      // guessed at it instead of reading it. Log it.
      console.error(
        `[run-production-flow] save_revision refused: ${message} | viz=${visualizationId} expected_updated_at=${expectedUpdatedAt} asserted_generation=${assertedGenerationId || "(none)"} render_url_keys=${Object.keys(renderUrls || {}).length} submission_hash_len=${String(submissionHash || "").length} definition=${DESIGNPRO_ENTICE_WORKFLOW_VERSION}`,
      );
      const conflict =
        message.includes("revision_source_changed") ||
        message.includes("revision_generation_identity_conflict") ||
        message.includes("idempotency_identity_conflict");
      const forbidden =
        message.includes("revision_source_not_owned") ||
        message.includes("revision_generation_owner_missing");
      return designproJson(
        {
          error: conflict
            ? "The saved revision changed before this edit could be committed"
            : forbidden
              ? "Visualization not found"
              : `Unable to save and enqueue revision: ${message}`,
          code: conflict
            ? "revision_source_changed"
            : "revision_save_enqueue_failed",
        },
        conflict ? 409 : forbidden ? 404 : 503,
      );
    }

    const result = Array.isArray(savedAndEnqueued)
      ? savedAndEnqueued[0]
      : savedAndEnqueued;
    const revisionId = String(
      result?.revisionId || result?.revision_id || "",
    );
    const enticePackId = String(
      result?.enticePackId || result?.entice_pack_id || "",
    );
    const workflowRunId = String(
      result?.workflowRunId || result?.workflow_run_id || "",
    );
    const updatedAt = String(
      result?.updatedAt || result?.updated_at || "",
    );
    if (
      !revisionId ||
      !enticePackId ||
      !workflowRunId ||
      !updatedAt
    ) {
      return designproJson(
        {
          error:
            "Atomic revision save returned no durable workflow identity",
          code: "revision_save_identity_missing",
        },
        503,
      );
    }
    const [{ data: revision }, { data: enticePack }, { data: workflowRun }] =
      await Promise.all([
        db.from("design_version_commits").select("*").eq("id", revisionId)
          .maybeSingle(),
        db.from("designpro_entice_packs").select("*").eq("id", enticePackId)
          .maybeSingle(),
        db.from("workforce_runs").select("*").eq("id", workflowRunId)
          .maybeSingle(),
      ]);
    if (!revision || !enticePack || !workflowRun) {
      return designproJson(
        {
          error:
            "Atomic revision save returned incomplete durable records",
          code: "revision_save_identity_missing",
        },
        503,
      );
    }
    return designproJson(
      {
        success: true,
        saved: true,
        accepted: true,
        updatedAt,
        workflowType: DESIGNPRO_ENTICE_WORKFLOW_TYPE,
        revisionId,
        designId: enticePack.design_id,
        visualizationId: enticePack.source_visualization_id,
        versionNumber: revision.version_number,
        enticePackId,
        dimensionManifestId: enticePack.dimension_manifest_id,
        workflowRun,
        idempotent: result?.created !== true,
        submissionHash,
      },
      202,
    );
  }

  if (action === "start") {
    const visualizationId = String(
      body.visualizationId || body.visualization_id || "",
    ).trim();
    let expectedUpdatedAt = String(
      body.expectedUpdatedAt || body.expected_updated_at || "",
    ).trim();
    if (!visualizationId) {
      return designproJson(
        { error: "visualizationId required", code: "visualization_id_required" },
        400,
      );
    }
    if (!expectedUpdatedAt || !Number.isFinite(Date.parse(expectedUpdatedAt))) {
      return designproJson(
        {
          error: "expectedUpdatedAt required",
          code: "expected_updated_at_required",
        },
        400,
      );
    }

    let { data: source, error: sourceError } = await db
      .from("color_visualizations")
      .select("id,updated_at,render_urls,admin_notes,vehicle_type")
      .eq("id", visualizationId)
      .maybeSingle();
    if (sourceError) {
      return designproJson({ error: sourceError.message }, 503);
    }
    if (!source) {
      return designproJson({ error: "Visualization not found" }, 404);
    }
    if (
      Date.parse(String(source.updated_at || "")) !==
      Date.parse(expectedUpdatedAt)
    ) {
      console.error(
        `[run-production-flow] preflight revision_source_changed (freeze): viz=${visualizationId} db_updated_at=${String(source.updated_at || "(null)")} client_expected_updated_at=${expectedUpdatedAt}`,
      );
      return designproJson(
        {
          error: "The saved revision changed before it could be frozen",
          code: "revision_source_changed",
        },
        409,
      );
    }

    // SURFACE MANIFEST BACKFILL — see the helpers at the top of this file for
    // why this exists. Without it the enqueue below is refused, no pack row is
    // created, and the UI polls a nonexistent pack forever behind "Building
    // Production Proof on Server" (one 503, then endless 404s).
    const sourceNotes = readDesignProNotes(source.admin_notes);
    if (!hasSurfaceManifest(sourceNotes)) {
      const surfaceOptions = deriveSurfaceOptions(
        String(source.vehicle_type || sourceNotes.vehicle_type || ""),
        existingSurfaceOptions(sourceNotes),
      );
      const patchedNotes = { ...sourceNotes, surface_options: surfaceOptions };
      // NO .maybeSingle() HERE — IT MAKES THE CONFLICT PATH BELOW UNREACHABLE.
      //
      // This is a guarded write: the `updated_at` equality is optimistic
      // concurrency, so matching ZERO rows is the EXPECTED outcome whenever the
      // design moved between the preflight read and this patch. The code below
      // handles that correctly — `if (!patched)` returns the honest 409.
      //
      // But `.maybeSingle()` asks PostgREST for a single object, and on a
      // zero-row result PostgREST answers PGRST116 "Cannot coerce the result to
      // a single JSON object" as an ERROR rather than a null body. So the
      // guarded write took the `patchError` branch and echoed that raw string
      // to the operator as a 503, while the branch written to explain the
      // conflict could never run. Live 2026-08-01: a design created by an agent
      // at 7:26 was submitted at 7:27, its `updated_at` had moved, and Revision
      // Studio reported "The server did not accept this revision: Cannot coerce
      // the result to a single JSON object" — then showed no 2D proof, no
      // verified pack, and "No print-ready sides" all the way down, every one
      // of them a symptom of this single failure.
      //
      // Taking the rows as an array removes the dependency on PostgREST's
      // coercion behaviour entirely: zero rows is an empty array, which is a
      // value, not an error.
      const { data: patchedRows, error: patchError } = await db
        .from("color_visualizations")
        .update({ admin_notes: JSON.stringify(patchedNotes) })
        .eq("id", visualizationId)
        .eq("updated_at", source.updated_at)
        .select("id,updated_at,render_urls,admin_notes,vehicle_type");
      const patched = Array.isArray(patchedRows) ? patchedRows[0] || null : patchedRows || null;
      if (patchError) {
        console.error(
          `[run-production-flow] surface manifest backfill failed: ${patchError.message} | viz=${visualizationId}`,
        );
        return designproJson(
          {
            error: `Unable to resolve the production surfaces: ${patchError.message}`,
            code: "surface_manifest_backfill_failed",
          },
          503,
        );
      }
      if (!patched) {
        // Someone else wrote the row between the preflight read and this
        // patch. Surfacing the normal conflict is correct — the caller
        // retries with the current timestamp.
        console.error(
          `[run-production-flow] surface manifest backfill lost a race: viz=${visualizationId} expected_updated_at=${expectedUpdatedAt}`,
        );
        return designproJson(
          {
            error: "The saved revision changed before it could be frozen",
            code: "revision_source_changed",
          },
          409,
        );
      }
      // The BEFORE UPDATE trigger bumped updated_at, so every downstream
      // check (fingerprint, recheck, and the RPC's own FOR UPDATE compare)
      // must use the post-write timestamp or they would all see a false
      // conflict against the value the browser sent.
      source = patched;
      expectedUpdatedAt = String(patched.updated_at);
      console.log(
        `[run-production-flow] surface manifest backfilled (start): viz=${visualizationId} sides=${surfaceOptions.expectedPanelSides.join("/")} vehicle_type=${surfaceOptions.derivedFromVehicleType} new_updated_at=${expectedUpdatedAt}`,
      );
    }

    // Compatibility callers may still invoke `start` after the same saved
    // state was already accepted through the atomic `save_revision` path.
    // Those entry points intentionally use different request hashes (the
    // legacy path includes byte evidence), so hash-only dedupe would mint a
    // second immutable revision. Reuse the exact frozen source checkpoint
    // before doing any network fingerprinting.
    const { data: priorPacks, error: priorPackError } = await db
      .from("designpro_entice_packs")
      .select("*")
      .eq("source_visualization_id", visualizationId)
      .eq("definition_version", DESIGNPRO_ENTICE_WORKFLOW_VERSION)
      // Reuse the newest exact frozen revision. Oldest-first reattached the UI
      // to a historical stalled run even when a newer healthy run existed.
      .order("created_at", { ascending: false })
      .limit(20);
    if (priorPackError) {
      return designproJson({ error: priorPackError.message }, 503);
    }
    const priorRevisionIds = (priorPacks || [])
      .map((pack: any) => String(pack.revision_id || ""))
      .filter(Boolean);
    const { data: priorRevisions, error: priorRevisionError } =
      priorRevisionIds.length
        ? await db
            .from("design_version_commits")
            .select("*")
            .in("id", priorRevisionIds)
        : { data: [], error: null };
    if (priorRevisionError) {
      return designproJson({ error: priorRevisionError.message }, 503);
    }
    const priorRevisionsById = new Map(
      (priorRevisions || []).map((revision: any) => [
        String(revision.id),
        revision,
      ]),
    );
    const currentRenderHash = await designproHash(
      stabilizeDesignProInput(source.render_urls),
    );
    let exactPrior:
      | { pack: any; revision: any; workflowRun: any }
      | null = null;
    const privilegedReuse =
      principal.kind === "user" &&
      (await checkPrivileged(db, principal.userId));
    for (const pack of priorPacks || []) {
      if (
        String(pack.user_id || "") !== boundUserId &&
        !privilegedReuse
      ) {
        continue;
      }
      const revision = priorRevisionsById.get(String(pack.revision_id || ""));
      const snapshot =
        revision?.revision_snapshot &&
        typeof revision.revision_snapshot === "object"
          ? revision.revision_snapshot
          : {};
      if (
        Date.parse(String(snapshot.savedAt || "")) !==
          Date.parse(expectedUpdatedAt) ||
        (await designproHash(
          stabilizeDesignProInput(snapshot.renderUrls),
        )) !== currentRenderHash
      ) {
        continue;
      }
      const { data: priorRun, error: priorRunError } = await db
        .from("workforce_runs")
        .select("*")
        .eq("id", pack.workflow_run_id)
        .eq("workflow_type", DESIGNPRO_ENTICE_WORKFLOW_TYPE)
        .eq("domain_job_type", "designpro_entice_packs")
        .eq("domain_job_id", pack.id)
        .maybeSingle();
      if (priorRunError) {
        return designproJson({ error: priorRunError.message }, 503);
      }
      if (priorRun && revision) {
        exactPrior = { pack, revision, workflowRun: priorRun };
        break;
      }
    }
    if (exactPrior) {
      return designproJson(
        {
          success: true,
          accepted: true,
          workflowType: DESIGNPRO_ENTICE_WORKFLOW_TYPE,
          revisionId: exactPrior.revision.id,
          designId: exactPrior.pack.design_id,
          visualizationId: exactPrior.pack.source_visualization_id,
          versionNumber: exactPrior.revision.version_number,
          enticePackId: exactPrior.pack.id,
          dimensionManifestId: exactPrior.pack.dimension_manifest_id,
          workflowRun: exactPrior.workflowRun,
          idempotent: true,
          reusedSavedRevision: true,
          submissionHash: exactPrior.pack.submission_hash,
        },
        202,
      );
    }

    let materialFingerprints: Record<string, unknown>;
    try {
      materialFingerprints = await fingerprintDesignProRevisionSources(
        source.render_urls,
      );
    } catch (error) {
      console.error("[DESIGNPRO ENTICE] source fingerprint failed", error);
      return designproJson(
        {
          error: "Unable to verify the saved revision pixels",
          code: "source_fingerprint_unavailable",
        },
        503,
      );
    }

    const sourceSnapshotHash = await designproHash({
      updatedAt: source.updated_at,
      renderUrls: stabilizeDesignProInput(source.render_urls),
    });
    const { data: rechecked, error: recheckError } = await db
      .from("color_visualizations")
      .select("updated_at,render_urls")
      .eq("id", visualizationId)
      .maybeSingle();
    if (recheckError) {
      return designproJson({ error: recheckError.message }, 503);
    }
    const recheckedSnapshotHash = await designproHash({
      updatedAt: rechecked?.updated_at,
      renderUrls: stabilizeDesignProInput(rechecked?.render_urls),
    });
    if (
      !rechecked ||
      sourceSnapshotHash !== recheckedSnapshotHash ||
      Date.parse(String(rechecked.updated_at || "")) !==
        Date.parse(expectedUpdatedAt)
    ) {
      console.error(
        `[run-production-flow] preflight revision_source_changed (verify recheck): viz=${visualizationId} present=${rechecked ? "yes" : "no"} snapshot_match=${sourceSnapshotHash === recheckedSnapshotHash} db_updated_at=${String(rechecked?.updated_at || "(null)")} client_expected_updated_at=${expectedUpdatedAt}`,
      );
      return designproJson(
        {
          error: "The saved revision changed while it was being verified",
          code: "revision_source_changed",
        },
        409,
      );
    }

    const trigger = String(body.trigger || "revision_saved").trim();
    const change =
      body.change && typeof body.change === "object" && !Array.isArray(body.change)
        ? body.change
        : {};
    const assertedGenerationId = String(
      body.generationId || body.generation_id || "",
    ).trim();
    const submissionHash = await designproHash({
      definitionVersion: DESIGNPRO_ENTICE_WORKFLOW_VERSION,
      visualizationId,
      expectedUpdatedAt,
      assertedGenerationId: assertedGenerationId || null,
      trigger,
      change: stabilizeDesignProInput(change),
      materialFingerprints,
    });
    const callerKey = String(
      body.idempotencyKey || body.idempotency_key || "",
    ).trim();
    const idempotencyKey = callerKey
      ? `designpro-entice:${boundUserId}:${callerKey}`
      : `designpro-entice:${boundUserId}:${visualizationId}:${expectedUpdatedAt}`;

    const { data: enqueued, error: enqueueError } = await db.rpc(
      "enqueue_designpro_entice_pack",
      {
        p_visualization_id: visualizationId,
        p_expected_updated_at: expectedUpdatedAt,
        p_requested_by: boundUserId,
        p_idempotency_key: idempotencyKey,
        p_submission_hash: submissionHash,
        p_material_fingerprints: materialFingerprints,
        p_trigger: trigger,
        p_change: change,
        p_asserted_generation_id: assertedGenerationId || null,
        p_definition_version: DESIGNPRO_ENTICE_WORKFLOW_VERSION,
      },
    );
    if (enqueueError) {
      const message = String(enqueueError.message || "");
      console.error(
        `[run-production-flow] enqueue_entice_pack refused: ${message} | viz=${visualizationId} expected_updated_at=${expectedUpdatedAt} asserted_generation=${assertedGenerationId || "(none)"} requested_by=${boundUserId} trigger=${trigger} idempotency_key=${idempotencyKey} definition=${DESIGNPRO_ENTICE_WORKFLOW_VERSION}`,
      );
      const conflict =
        message.includes("revision_source_changed") ||
        message.includes("revision_generation_identity_conflict") ||
        message.includes("idempotency_identity_conflict");
      const forbidden =
        message.includes("revision_source_not_owned") ||
        message.includes("revision_generation_owner_missing");
      return designproJson(
        {
          error: conflict
            ? "The saved revision identity changed"
            : forbidden
              ? "Visualization not found"
              : `Unable to enqueue revision pack: ${message}`,
          code: conflict
            ? "revision_source_changed"
            : "entice_pack_enqueue_failed",
        },
        conflict ? 409 : forbidden ? 404 : 503,
      );
    }
    const result = Array.isArray(enqueued) ? enqueued[0] : enqueued;
    const revisionId = String(result?.revisionId || "");
    const enticePackId = String(result?.enticePackId || "");
    const workflowRunId = String(result?.workflowRunId || "");
    const [{ data: revision }, { data: enticePack }, { data: workflowRun }] =
      await Promise.all([
        db.from("design_version_commits").select("*").eq("id", revisionId)
          .maybeSingle(),
        db.from("designpro_entice_packs").select("*").eq("id", enticePackId)
          .maybeSingle(),
        db.from("workforce_runs").select("*").eq("id", workflowRunId)
          .maybeSingle(),
      ]);
    if (!revision || !enticePack || !workflowRun) {
      return designproJson(
        { error: "Atomic revision enqueue returned no durable records" },
        503,
      );
    }
    return designproJson(
      {
        success: true,
        accepted: true,
        workflowType: DESIGNPRO_ENTICE_WORKFLOW_TYPE,
        revisionId,
        designId: enticePack.design_id,
        visualizationId: enticePack.source_visualization_id,
        versionNumber: revision.version_number,
        enticePackId,
        dimensionManifestId: enticePack.dimension_manifest_id,
        workflowRun,
        idempotent: result?.created !== true,
        submissionHash,
      },
      202,
    );
  }

  let workflowRunId = String(
    body.workflowRunId || body.workflow_run_id || "",
  ).trim();
  if (!workflowRunId && action === "status") {
    const visualizationId = String(
      body.visualizationId || body.visualization_id || "",
    ).trim();
    const enticePackId = String(
      body.enticePackId || body.entice_pack_id || "",
    ).trim();
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (
      (visualizationId && !uuid.test(visualizationId)) ||
      (enticePackId && !uuid.test(enticePackId))
    ) {
      return designproJson(
        {
          error: "visualizationId and enticePackId must be valid UUIDs",
          code: "invalid_entice_status_identity",
        },
        400,
      );
    }
    let packLookup = db
      .from("designpro_entice_packs")
      .select("id,workflow_run_id")
      .eq("user_id", boundUserId);
    packLookup = enticePackId
      ? packLookup.eq("id", enticePackId)
      : packLookup
          .eq("source_visualization_id", visualizationId)
          .order("created_at", { ascending: false })
          .limit(1);
    const { data: locatedPack, error: locateError } =
      await packLookup.maybeSingle();
    if (locateError) {
      return designproJson({ error: locateError.message }, 503);
    }
    workflowRunId = String(locatedPack?.workflow_run_id || "");
  }
  if (!workflowRunId) {
    return designproJson({ error: "Entice Pack workflow not found" }, 404);
  }
  const { data: workflowRun, error: workflowError } = await db
    .from("workforce_runs")
    .select("*")
    .eq("id", workflowRunId)
    .eq("workflow_type", DESIGNPRO_ENTICE_WORKFLOW_TYPE)
    .eq("domain_job_type", "designpro_entice_packs")
    .maybeSingle();
  if (workflowError) {
    return designproJson({ error: workflowError.message }, 503);
  }
  if (!workflowRun) {
    return designproJson({ error: "Workflow run not found" }, 404);
  }
  const privileged =
    principal.kind === "user" &&
    (await checkPrivileged(db, principal.userId));

  const [{ data: enticePack }, { data: stages }] = await Promise.all([
    db.from("designpro_entice_packs").select("*")
      .eq("id", workflowRun.domain_job_id).maybeSingle(),
    db.from("workflow_stage_runs")
      .select(
        "id,stage_key,scope_key,sequence,status,attempt,max_attempts,output,verification,error_code,error_message,error_details,wait_reason,wait_details,deferred_count,available_at,started_at,completed_at,updated_at",
      )
      .eq("run_id", workflowRun.id)
      .order("sequence")
      .order("scope_key"),
  ]);
  if (!enticePack) {
    return designproJson({ error: "Entice Pack not found" }, 404);
  }
  // requested_by is audit provenance, not the domain authorization boundary.
  // An admin/tester may enqueue a pack on an owner's behalf, so the durable run
  // requester can legitimately differ from the design owner. Status/resume
  // must remain available to the authoritative pack owner.
  const ownsPack = String(enticePack.user_id || "") === boundUserId;
  if (!ownsPack && !privileged) {
    return designproJson({ error: "Workflow run not found" }, 404);
  }
  const { data: revision } = await db
    .from("design_version_commits")
    .select("*")
    .eq("id", enticePack.revision_id)
    .maybeSingle();

  if (action === "status") {
    const proofStage = (stages || []).find(
      (stage: any) =>
        stage?.stage_key === "proof.build" &&
        stage?.status === "completed" &&
        stage?.verification?.verified === true,
    );
    const previewProofUrl = String(proofStage?.output?.url || "") || null;
    const { data: activePack } = await db
      .from("designpro_entice_packs")
      .select("*")
      .eq("design_id", enticePack.design_id)
      .eq("status", "active")
      .maybeSingle();
    return designproJson({
      success: true,
      workflowType: DESIGNPRO_ENTICE_WORKFLOW_TYPE,
      revision: revision
        ? {
            id: revision.id,
            designId: enticePack.design_id,
            visualizationId: enticePack.source_visualization_id,
            versionNumber: revision.version_number,
          }
        : null,
      enticePack,
      activeEnticePack: activePack || null,
      activeEnticePackId: activePack?.id || null,
      activeRevisionId: activePack?.revision_id || null,
      previewProofUrl,
      workflowRun,
      stages: stages || [],
      timing: designProTiming(workflowRun, stages || []),
    });
  }

  if (action === "run" || action === "resume") {
    if (["completed", "cancelled"].includes(String(workflowRun.workflow_status))) {
      return designproJson(
        {
          success: workflowRun.workflow_status === "completed",
          idempotent: true,
          workflowType: DESIGNPRO_ENTICE_WORKFLOW_TYPE,
          enticePack,
          workflowRun,
        },
        workflowRun.workflow_status === "completed" ? 200 : 409,
      );
    }
    if (
      action === "run" &&
      ["queued", "running"].includes(String(workflowRun.workflow_status))
    ) {
      return designproJson(
        {
          success: true,
          accepted: true,
          idempotent: true,
          workflowType: DESIGNPRO_ENTICE_WORKFLOW_TYPE,
          enticePack,
          workflowRun,
        },
        202,
      );
    }
    const retryFailed =
      body.retryFailed === true || body.retry_failed === true;
    if (workflowRun.workflow_status === "failed" && !retryFailed) {
      return designproJson(
        {
          error: "Explicit retryFailed=true is required for a failed workflow",
          workflowRun,
        },
        409,
      );
    }
    const { data: resume, error: resumeError } = await db.rpc(
      "resume_designpro_entice_pack",
      {
        p_run_id: workflowRun.id,
        p_actor: boundUserId,
        p_retry_failed: retryFailed,
      },
    );
    if (resumeError) {
      return designproJson({ error: resumeError.message }, 503);
    }
    const { data: resumed } = await db
      .from("workforce_runs")
      .select("*")
      .eq("id", workflowRun.id)
      .maybeSingle();
    return designproJson(
      {
        success: true,
        accepted: true,
        workflowType: DESIGNPRO_ENTICE_WORKFLOW_TYPE,
        enticePack,
        workflowRun: resumed || workflowRun,
        resume,
      },
      202,
    );
  }

  return designproJson(
    { error: `Invalid designpro_revision action: ${action}` },
    400,
  );
}

async function findDesignProJob(
  db: any,
  body: any,
  userId: string,
  service: boolean,
) {
  const productionJobId = String(
    body.productionJobId || body.production_job_id || "",
  );
  const panelizerJobId = String(
    body.panelizerJobId ||
      body.panelizer_job_id ||
      (!productionJobId ? body.jobId || body.job_id || "" : ""),
  );
  let query = db.from("designpro_production_jobs").select("*");
  query = productionJobId
    ? query.eq("id", productionJobId)
    : query
        .eq("panelizer_job_id", panelizerJobId)
        .order("created_at", { ascending: false })
        .limit(1);
  if (!service || userId) query = query.eq("user_id", userId);
  return await query.maybeSingle();
}

async function handleDesignProJob(
  body: any,
  principal: RequestPrincipal,
  db: any,
  url: string,
  serviceKey: string,
) {
  if (principal.kind === "anonymous") {
    return designproJson({ error: "Authentication required" }, 401);
  }
  const action = String(body.action || "status");
  const isService = principal.kind === "service";

  if (action === "advance_domain") {
    if (!isService) return designproJson({ error: "Forbidden" }, 403);
    const productionJobId = String(
      body.productionJobId || body.production_job_id || "",
    );
    const { data: productionJob } = await db
      .from("designpro_production_jobs")
      .select("*")
      .eq("id", productionJobId)
      .maybeSingle();
    if (!productionJob)
      return designproJson({ error: "Production job not found" }, 404);
    return await advanceDesignProJob(productionJob, db, url, serviceKey, {
      sourceHash: body.sourceHash || body.source_hash,
      packVersion: body.packVersion || body.pack_version,
      sourceProofUrl: body.sourceProofUrl || body.source_proof_url,
      expectedSides: body.expectedSides || body.expected_sides,
      vaultJobId: body.vaultJobId || body.vault_job_id,
      workflowRunId: body.workflowRunId || body.workflow_run_id,
      packIdentityHash:
        body.packIdentityHash || body.pack_identity_hash,
      revisionId: body.revisionId || body.revision_id,
      enticePackId: body.enticePackId || body.entice_pack_id,
      dimensionManifestId:
        body.dimensionManifestId || body.dimension_manifest_id,
      manifestHash: body.manifestHash || body.manifest_hash,
      sourceContractHash:
        body.sourceContractHash || body.source_contract_hash,
      artifactSetHash: body.artifactSetHash || body.artifact_set_hash,
      fingerprints: body.fingerprints,
    });
  }

  if (action === "start") {
    const panelizerJobId = String(body.jobId || body.job_id || "");
    if (!panelizerJobId) return fail("jobId required");
    const { data: ownedJob, error: jobError } = await db
      .from("panelizer_jobs")
      .select("*")
      .eq("id", panelizerJobId)
      .maybeSingle();
    if (jobError) return designproJson({ error: jobError.message }, 503);
    if (!ownedJob) return designproJson({ error: "Job not found" }, 404);
    const userId = String(ownedJob.user_id || "");
    const generationId = String(ownedJob.generation_id || "");
    if (!userId || !generationId)
      return fail("Panelizer job has no owner or generation");
    if (!isService && userId !== principal.userId) {
      return designproJson({ error: "Job not found" }, 404);
    }
    const requestedUserId = String(body.userId || body.user_id || "");
    const requestedGenerationId = String(
      body.generationId || body.generation_id || "",
    );
    if (
      (isService && requestedUserId && requestedUserId !== userId) ||
      (requestedGenerationId && requestedGenerationId !== generationId)
    ) {
      return designproJson(
        { error: "Request does not match the authoritative job" },
        409,
      );
    }
    const concept =
      ownedJob.concept_json && typeof ownedJob.concept_json === "object"
        ? ownedJob.concept_json
        : {};
    const { workflow: _workflowMarker, ...conceptMaterial } = concept;
    const requestedEnticePackId = String(
      body.enticePackId || body.entice_pack_id || "",
    ).trim();
    const orderRequestId = String(
      body.orderRequestId || body.order_request_id || "",
    ).trim();
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (
      (requestedEnticePackId && !uuid.test(requestedEnticePackId)) ||
      (orderRequestId && !uuid.test(orderRequestId))
    ) {
      return designproJson(
        {
          error: "enticePackId and orderRequestId must be valid UUIDs",
          code: "invalid_production_identity",
        },
        400,
      );
    }
    // CANONICALIZE BEFORE THE LOOKUP, OR THIS GUARD REFUSES ITS OWN PACKS.
    //
    // Packs are keyed by the DesignIQ generation id. Every in-app caller of
    // this entry passes the RENDER row id instead (useQuickProductionPack ->
    // RevisionStudioIQ, DesignProToolUI, ApproveModeComponent, ProductionFlow),
    // because that is the id those surfaces hold. Matching a render id against
    // designiq_generation_id finds nothing, so a design with a perfectly good
    // active pack still fell through to the 409 below.
    //
    // Live: pack cb56ce60 (Ridgeline Roofing) is `active` and verified, with
    // designiq_generation_id 74f809fe… and source_visualization_id 0f5b7e62….
    // The browser sends 0f5b7e62…, the lookup misses, and the owner sees
    // "A verified active revision pack is required before production" on a
    // design whose pack is sitting there active. Fixing the one READER beats
    // changing five writers.
    //
    // Resolved the same way `pullBuildAssets` already does it, and matched with
    // `.in()` over BOTH ids rather than replacing one with the other: a caller
    // that already passes the canonical id must keep working unchanged, and a
    // pack row whose back-link is absent must still be reachable by its own id.
    let packGenerationIds = [String(generationId)];
    try {
      const { data: packViz } = await db
        .from("color_visualizations")
        .select("admin_notes")
        .eq("id", generationId)
        .maybeSingle();
      const rawNotes = (packViz as any)?.admin_notes;
      const notes = rawNotes
        ? (typeof rawNotes === "string" ? JSON.parse(rawNotes) : rawNotes)
        : {};
      const backLink = String(notes?.designiq_generation_id || "").trim();
      if (backLink) packGenerationIds = Array.from(new Set([backLink, ...packGenerationIds]));
    } catch {
      // A missing or unparseable render row is not fatal here — the raw id is
      // still a legitimate lookup key for packs created under it directly.
    }

    let packQuery = db
      .from("designpro_entice_packs")
      .select("*")
      .in("designiq_generation_id", packGenerationIds)
      .eq("user_id", userId)
      .eq("status", "active")
      .not("verified_at", "is", null);
    if (requestedEnticePackId) {
      packQuery = packQuery.eq("id", requestedEnticePackId);
    }
    const { data: activePack, error: packError } = await packQuery
      .order("activated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (packError) {
      return designproJson({ error: packError.message }, 503);
    }
    if (
      !activePack ||
      !activePack.revision_id ||
      !activePack.dimension_manifest_id ||
      !/^[0-9a-f]{64}$/.test(
        String(activePack.source_contract_hash || "").toLowerCase(),
      )
    ) {
      return designproJson(
        {
          error:
            "A verified active revision pack is required before production",
          code: "verified_entice_pack_required",
          generation_id: generationId,
          // The ids actually searched. Without these the 409 is unfalsifiable
          // from the outside — it reads the same whether no pack exists, the
          // pack failed, or the lookup simply used the wrong key, which is how
          // the id mismatch above survived unnoticed.
          searched_generation_ids: packGenerationIds,
        },
        409,
      );
    }
    const submissionHash = await designproHash({
      definitionVersion: DESIGNPRO_WORKFLOW_VERSION,
      panelizerJobId,
      generationId,
      userId,
      shopId: ownedJob.shop_id || null,
      orderNumber: ownedJob.order_number || panelizerJobId,
      concept: stabilizeDesignProInput(conceptMaterial),
      orderRequestId: orderRequestId || null,
      revisionId: activePack.revision_id,
      enticePackId: activePack.id,
      dimensionManifestId: activePack.dimension_manifest_id,
      sourceContractHash: activePack.source_contract_hash,
      packVersion: activePack.pack_version,
    });
    const callerKey = String(
      body.idempotencyKey || body.idempotency_key || "",
    ).trim();
    const idempotencyKey = callerKey
      ? `designpro:${userId}:${callerKey}`
      : `designpro:${userId}:${panelizerJobId}:${activePack.id}:${orderRequestId || "direct"}`;
    const { data: enqueued, error: enqueueError } = await db.rpc(
      "enqueue_designpro_production_pack_v2",
      {
        p_panelizer_job_id: panelizerJobId,
        p_entice_pack_id: activePack.id,
        p_order_request_id: orderRequestId || null,
        p_requested_by: userId,
        p_idempotency_key: idempotencyKey,
        p_submission_hash: submissionHash,
        p_definition_version: DESIGNPRO_WORKFLOW_VERSION,
      },
    );
    if (enqueueError) {
      const message = String(enqueueError.message || "");
      console.error(
        `[run-production-flow] enqueue_production_pack refused: ${message} | panelizer_job=${panelizerJobId} entice_pack=${activePack.id} order_request=${orderRequestId || "(none)"} requested_by=${userId} idempotency_key=${idempotencyKey} definition=${DESIGNPRO_WORKFLOW_VERSION}`,
      );
      if (message.includes("pack_required")) {
        return designproJson(
          {
            error: "Production pack entitlement required",
            code: "pack_required",
            generation_id: generationId,
            paywall: { production_pack: { price: 299 } },
          },
          402,
        );
      }
      if (
        message.includes("idempotency_identity_conflict") ||
        message.includes("source_changed") ||
        message.includes("paid_pack_pin_conflict") ||
        message.includes("order_request_pack_pin_conflict") ||
        message.includes("panelizer_entice_pack_identity_conflict") ||
        message.includes("panelizer_entice_pack_manifest_conflict")
      ) {
        return designproJson(
          { error: "Production source or options changed", code: "source_changed" },
          409,
        );
      }
      if (
        message.includes("verified_active_entice_pack_required") ||
        message.includes("verified_entice_pack_assets_missing")
      ) {
        return designproJson(
          {
            error:
              "The active revision pack is not verified for production",
            code: "verified_entice_pack_required",
          },
          409,
        );
      }
      return designproJson(
        { error: `Unable to enqueue Production Pack: ${message}` },
        503,
      );
    }
    const enqueueResult = Array.isArray(enqueued) ? enqueued[0] : enqueued;
    const productionJobId = String(enqueueResult?.productionJobId || "");
    const workflowRunId = String(enqueueResult?.workflowRunId || "");
    const [{ data: productionJob }, { data: workflowRun }] = await Promise.all([
      db
        .from("designpro_production_jobs")
        .select("*")
        .eq("id", productionJobId)
        .maybeSingle(),
      db.from("workforce_runs").select("*").eq("id", workflowRunId).maybeSingle(),
    ]);
    if (!productionJob || !workflowRun) {
      return designproJson(
        { error: "Atomic Production Pack enqueue returned no durable records" },
        503,
      );
    }
    return designproJson(
      {
        success: true,
        accepted: true,
        productionJob,
        workflowRun,
        idempotent: enqueueResult?.created !== true,
        submissionHash,
        revisionId: enqueueResult?.revisionId || activePack.revision_id,
        enticePackId: enqueueResult?.enticePackId || activePack.id,
        dimensionManifestId:
          enqueueResult?.dimensionManifestId ||
          activePack.dimension_manifest_id,
        sourceContractHash:
          enqueueResult?.sourceContractHash ||
          activePack.source_contract_hash,
      },
      202,
    );
  }

  const requestedUserId = String(body.userId || body.user_id || "");
  const privilegedAdminLookup =
    principal.kind === "user" &&
    ["status", "approve"].includes(action) &&
    (await checkPrivileged(db, principal.userId));
  const userId = isService
    ? requestedUserId
    : privilegedAdminLookup
      ? ""
      : principal.userId;
  const { data: productionJob, error: findError } = await findDesignProJob(
    db,
    body,
    userId,
    isService || privilegedAdminLookup,
  );
  if (findError) return designproJson({ error: findError.message }, 503);
  if (!productionJob)
    return designproJson({ error: "Production job not found" }, 404);
  const { data: workflowRun, error: workflowError } = await db
    .from("workforce_runs")
    .select("*")
    .eq("workflow_type", DESIGNPRO_WORKFLOW_TYPE)
    .eq("domain_job_id", productionJob.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (workflowError)
    return designproJson({ error: workflowError.message }, 503);

  if (action === "status") {
    const { data: stages, error: stageError } = workflowRun
      ? await db
          .from("workflow_stage_runs")
          .select(
            "id,stage_key,scope_key,sequence,status,attempt,max_attempts,verification,error_code,error_message,error_details,wait_reason,wait_details,deferred_count,available_at,started_at,completed_at,updated_at",
          )
          .eq("run_id", workflowRun.id)
          .order("sequence")
          .order("scope_key")
      : { data: [], error: null };
    if (stageError) return designproJson({ error: stageError.message }, 503);
    return designproJson({
      success: true,
      productionJob,
      workflowRun: workflowRun || null,
      stages: stages || [],
      timing: workflowRun
        ? designProTiming(workflowRun, stages || [])
        : null,
    });
  }

  if (action === "approve") {
    if (principal.kind !== "user") {
      return designproJson(
        { error: "Interactive admin identity is required for QC approval" },
        403,
      );
    }
    if (!workflowRun)
      return designproJson({ error: "Workflow run not found" }, 404);
    const approvalRef = String(
      body.approvalRef || body.approval_ref || "",
    ).trim();
    if (!approvalRef)
      return designproJson({ error: "approvalRef required" }, 400);
    const { data: approval, error: approvalError } = await db.rpc(
      "approve_designpro_production_pack",
      {
        p_run_id: workflowRun.id,
        p_actor: principal.userId,
        p_approval_ref: approvalRef,
        p_details:
          body.details && typeof body.details === "object" ? body.details : {},
      },
    );
    if (approvalError)
      return designproJson({ error: approvalError.message }, 409);
    return designproJson({ success: true, approval });
  }

  if (action === "run" || action === "resume") {
    if (!workflowRun) {
      return designproJson(
        {
          error:
            "This legacy job has no durable workflow. Submit it through action=start.",
        },
        409,
      );
    }
    if (workflowRun.workflow_status === "approval_required") {
      return designproJson(
        {
          error: "Production Pack is waiting for admin QC",
          workflowRun,
        },
        409,
      );
    }
    if (
      ["completed", "cancelled"].includes(String(workflowRun.workflow_status))
    ) {
      return designproJson(
        {
          success: workflowRun.workflow_status === "completed",
          idempotent: true,
          productionJob,
          workflowRun,
        },
        workflowRun.workflow_status === "completed" ? 200 : 409,
      );
    }
    if (["queued", "running"].includes(String(workflowRun.workflow_status))) {
      return designproJson(
        {
          success: true,
          accepted: true,
          idempotent: true,
          productionJob,
          workflowRun,
        },
        202,
      );
    }
    const retryFailed =
      body.retryFailed === true || body.retry_failed === true;
    if (workflowRun.workflow_status === "failed" && !retryFailed) {
      return designproJson(
        {
          error: "Explicit retryFailed=true is required for a failed workflow",
          workflowRun,
        },
        409,
      );
    }
    const { data: resumeResult, error: resumeError } = await db.rpc(
      "resume_designpro_production_pack",
      {
        p_run_id: workflowRun.id,
        p_actor: principal.kind === "user" ? principal.userId : null,
        p_retry_failed: retryFailed,
        p_reason: "workflow_resume_requested",
      },
    );
    if (resumeError)
      return designproJson({ error: resumeError.message }, 503);
    const [{ data: resumed }, { data: resumedJob }] = await Promise.all([
      db.from("workforce_runs").select("*").eq("id", workflowRun.id).maybeSingle(),
      db
        .from("designpro_production_jobs")
        .select("*")
        .eq("id", productionJob.id)
        .maybeSingle(),
    ]);
    return designproJson(
      {
        success: true,
        accepted: true,
        productionJob: resumedJob || productionJob,
        workflowRun: resumed || workflowRun,
        resume: resumeResult,
      },
      202,
    );
  }

  return fail(`Invalid designpro_job action: ${action}`);
}

const STANDARD_PRODUCTION_SIDES = [
  'DRIVER SIDE',
  'PASSENGER SIDE',
  'HOOD',
  'ROOF',
  'FRONT',
  'REAR',
] as const
const TRAILER_PRODUCTION_SIDES = [
  'DRIVER SIDE',
  'PASSENGER SIDE',
  'FRONT',
  'REAR',
] as const
const SUPPORTED_PRODUCTION_SIDES = new Set<string>(STANDARD_PRODUCTION_SIDES)

type AtomicProductionPack = {
  vaultJobId: string
  version: string
  sourceHash: string
  sourceProofUrl: string
  expectedSides: string[]
  rowsBySide: Record<string, any>
  newestAt: number
}

function normalizeExpectedProductionSides(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const sides = value.map((side) => String(side || '').trim().toUpperCase())
  if (sides.some((side) => !side || !SUPPORTED_PRODUCTION_SIDES.has(side))) return null
  if (new Set(sides).size !== sides.length) return null
  if (!sides.includes('DRIVER SIDE') || !sides.includes('PASSENGER SIDE')) return null
  return STANDARD_PRODUCTION_SIDES.filter((side) => sides.includes(side))
}

function sameProductionSides(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((side) => rightSet.has(side))
}

type DesignProFingerprint = {
  sha256: string
  bytes: number
  contentType: string
}

function normalizeDesignProFingerprints(
  value: unknown,
): Record<string, DesignProFingerprint> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value as Record<string, unknown>)
  if (!entries.length) return null
  const normalized: Record<string, DesignProFingerprint> = {}
  for (const [key, raw] of entries) {
    if (!key || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const fingerprint = raw as Record<string, unknown>
    const sha256 = String(fingerprint.sha256 || '').toLowerCase()
    const bytes = Number(fingerprint.bytes || 0)
    if (!/^[a-f0-9]{64}$/.test(sha256) || !Number.isSafeInteger(bytes) || bytes <= 0) {
      return null
    }
    normalized[key] = {
      sha256,
      bytes,
      contentType: String(fingerprint.contentType || ''),
    }
  }
  return Object.fromEntries(
    Object.entries(normalized).sort(([left], [right]) => left.localeCompare(right)),
  )
}

function sameDesignProFingerprints(
  left: Record<string, DesignProFingerprint>,
  right: Record<string, DesignProFingerprint>,
): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key) =>
      !!right[key] &&
      left[key].sha256 === right[key].sha256 &&
      left[key].bytes === right[key].bytes)
}

/**
 * Choose one immutable, structurally complete v2 pack. Rows are grouped by
 * vault id + version + source hash before sides are considered, so a reader can
 * never manufacture a synthetic pack by taking the newest row for each side.
 *
 * QC is intentionally checked by the caller after structural selection. If the
 * newest complete source fails QC, production must stop on that source instead
 * of silently falling back to an older passing design.
 */
function selectCompleteAtomicProductionPack(
  assets: any[],
  currentProofUrl: string,
  requestedPack: any = null,
): AtomicProductionPack | null {
  const grouped = new Map<string, {
    vaultJobId: string
    version: string
    sourceHash: string
    sourceProofUrl: string
    rows: any[]
  }>()

  for (const row of (assets || [])) {
    const vaultJobId = String(row?.job_id || '')
    const version = String(row?.version || '').toLowerCase()
    const meta = row?.meta_metrics && typeof row.meta_metrics === 'object'
      ? row.meta_metrics
      : {}
    const sourceHash = String(meta.source_hash || '').toLowerCase()
    const packVersion = String(meta.pack_version || '').toLowerCase()
    const sourceProofUrl = String(meta.source_proof_url || '').trim()
    if (!vaultJobId || !/^v2:[a-f0-9]{24}$/.test(version)) continue
    if (!/^[a-f0-9]{64}$/.test(sourceHash) || !sourceProofUrl) continue
    if (version !== `v2:${sourceHash.slice(0, 24)}` || packVersion !== version) continue
    // When the canonical design has a current proof, every panel must explicitly
    // name that exact proof. A structurally complete pack from an earlier revision
    // is stale and must not be selected as a fallback.
    if (currentProofUrl && sourceProofUrl !== currentProofUrl) continue

    const key = `${vaultJobId}\u0000${version}\u0000${sourceHash}`
    const group = grouped.get(key) || {
      vaultJobId,
      version,
      sourceHash,
      sourceProofUrl,
      rows: [],
    }
    if (group.sourceProofUrl !== sourceProofUrl) continue
    group.rows.push(row)
    grouped.set(key, group)
  }

  const complete: AtomicProductionPack[] = []
  for (const group of grouped.values()) {
    let expectedSides: string[] | null = null
    const rowsBySide: Record<string, any> = {}
    let invalid = false
    let newestAt = 0

    for (const row of group.rows) {
      const meta = row?.meta_metrics && typeof row.meta_metrics === 'object'
        ? row.meta_metrics
        : {}
      const rowExpected = normalizeExpectedProductionSides(meta.expected_sides)
      const side = String(row?.side || '').trim().toUpperCase()
      if (!rowExpected || !side || !rowExpected.includes(side)) {
        invalid = true
        break
      }
      if (expectedSides && !sameProductionSides(expectedSides, rowExpected)) {
        invalid = true
        break
      }
      expectedSides ||= rowExpected
      if (rowsBySide[side]) {
        invalid = true
        break
      }
      rowsBySide[side] = row
      const createdAt = Date.parse(String(row?.created_at || ''))
      if (Number.isFinite(createdAt)) newestAt = Math.max(newestAt, createdAt)
    }

    if (
      invalid ||
      !expectedSides ||
      Object.keys(rowsBySide).length !== expectedSides.length ||
      !expectedSides.every((side) => !!rowsBySide[side])
    ) continue

    complete.push({
      vaultJobId: group.vaultJobId,
      version: group.version,
      sourceHash: group.sourceHash,
      sourceProofUrl: group.sourceProofUrl,
      expectedSides,
      rowsBySide,
      newestAt,
    })
  }

  complete.sort((left, right) =>
    right.newestAt - left.newestAt ||
    right.version.localeCompare(left.version) ||
    right.vaultJobId.localeCompare(left.vaultJobId))
  if (requestedPack && (
    requestedPack.sourceHash ||
    requestedPack.packVersion ||
    requestedPack.sourceProofUrl ||
    requestedPack.vaultJobId ||
    requestedPack.expectedSides
  )) {
    const requestedSides = normalizeExpectedProductionSides(requestedPack.expectedSides)
    if (
      !requestedSides ||
      !requestedPack.sourceHash ||
      !requestedPack.packVersion ||
      !requestedPack.sourceProofUrl ||
      !requestedPack.vaultJobId
    ) return null
    return complete.find((pack) =>
      pack.sourceHash === String(requestedPack.sourceHash).toLowerCase() &&
      pack.version === String(requestedPack.packVersion).toLowerCase() &&
      pack.sourceProofUrl === String(requestedPack.sourceProofUrl).trim() &&
      pack.vaultJobId === String(requestedPack.vaultJobId) &&
      sameProductionSides(pack.expectedSides, requestedSides)
    ) || null
  }
  return complete[0] || null
}

const DESIGNPRO_DURABLE_RESULT_KEYS = [
  'entitlementReservation',
  'workflowRunId',
  'workflowType',
  'submissionHash',
  'packIdentityHash',
  'revisionId',
  'enticePackId',
  'dimensionManifestId',
  'sourceContractHash',
  'manifestHash',
  'artifactSetHash',
  'fingerprints',
  'staticAssets',
] as const

function designProResult(value: any): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function mergeDesignProResult(
  current: Record<string, any>,
  additions: Record<string, any>,
): Record<string, any> {
  const merged = { ...current, ...additions }
  // These fields are minted by the atomic enqueue transaction. An activation
  // response may add output metadata, but it may never replace or erase the
  // entitlement reservation or the workflow envelope.
  for (const key of DESIGNPRO_DURABLE_RESULT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(current, key)) {
      merged[key] = current[key]
    }
  }
  return merged
}

function designProIdentityValue(
  result: Record<string, any>,
  key: 'workflowRunId' | 'sourceHash' | 'packVersion' | 'runKey' | 'packIdentityHash',
): string | null {
  if (!Object.prototype.hasOwnProperty.call(result, key)) return null
  const value = result[key]
  return value == null ? null : String(value)
}

async function casDesignProJobUpdate(
  db: any,
  expectedJob: any,
  workflowRunId: string,
  patch: Record<string, any>,
): Promise<{ data: any; error: any; conflict: boolean }> {
  const expectedResult = designProResult(expectedJob?.result)
  if (
    !expectedJob?.id ||
    !expectedJob?.state ||
    designProIdentityValue(expectedResult, 'workflowRunId') !== workflowRunId
  ) {
    return { data: null, error: null, conflict: true }
  }

  let update = db
    .from('designpro_production_jobs')
    .update(patch)
    .eq('id', expectedJob.id)
    .eq('state', String(expectedJob.state))
    .eq('result->>workflowRunId', workflowRunId)
    .eq('revision_id', expectedJob.revision_id)
    .eq('entice_pack_id', expectedJob.entice_pack_id)
    .eq('dimension_manifest_id', expectedJob.dimension_manifest_id)
    .eq('source_contract_hash', expectedJob.source_contract_hash)

  for (const key of ['sourceHash', 'packVersion', 'runKey', 'packIdentityHash'] as const) {
    const value = designProIdentityValue(expectedResult, key)
    update = value === null
      ? update.is(`result->>${key}`, null)
      : update.eq(`result->>${key}`, value)
  }

  // The individual identity predicates make the fencing contract explicit.
  // The scalar `updated_at` token is what detects EVERY other concurrent
  // write (worker/index.js stampPrintWorker is the working precedent). A
  // whole-document result filter cannot do this job: `.eq` with an object
  // serializes to "[object Object]" (invalid input syntax for type json, run
  // 6366dddd attempt 3), `.eq` with JSON text breaks PostgREST's filter
  // grammar (HTTP 400, attempt 6), and cs/cd containment inflated the request
  // URL past the runtime's limit once `result` carried the 68-fingerprint
  // evidence set (TypeError: Invalid URL at ~86KB, attempt 7). Every writer
  // to this row bumps updated_at (belt) and the BEFORE UPDATE trigger bumps
  // it regardless (suspenders), so equality on it is the exact-state fence.
  const expectedUpdatedAt = expectedJob.updated_at == null
    ? ''
    : String(expectedJob.updated_at)
  if (!expectedUpdatedAt) return { data: null, error: null, conflict: true }
  update = update.eq('updated_at', expectedUpdatedAt)

  const { data, error } = await update.select('*').maybeSingle()
  return { data: data || null, error: error || null, conflict: !error && !data }
}

function designProCasFailure(
  operation: string,
  write: { error: any; conflict: boolean },
): Response {
  return designproJson(
    {
      success: false,
      error: write.error?.message ||
        `${operation} lost its state/source fence; the newer durable job was preserved`,
      code: write.error ? 'durable_write_failed' : 'stale_activation',
    },
    write.error ? 503 : 409,
  )
}

async function advanceDesignProJob(
  job: any,
  db: any,
  url: string,
  serviceKey: string,
  requestedPack: any = null,
) {
  if (!job) return fail('Production job unavailable')
  const initialResult = designProResult(job.result)
  const workflowRunId = String(
    requestedPack?.workflowRunId ||
      initialResult.workflowRunId ||
      '',
  )
  const { data: workflowBinding, error: workflowBindingError } = workflowRunId
    ? await db.from('workforce_runs')
        .select('id,domain_job_id,workflow_type,input_hash')
        .eq('id', workflowRunId)
        .eq('domain_job_id', job.id)
        .eq('workflow_type', DESIGNPRO_WORKFLOW_TYPE)
        .maybeSingle()
    : { data: null, error: null }
  if (
    workflowBindingError ||
    !workflowBinding ||
    String(initialResult.workflowRunId || '') !== workflowRunId ||
    String(initialResult.workflowType || '') !== DESIGNPRO_WORKFLOW_TYPE ||
    String(initialResult.submissionHash || '') !==
      String(workflowBinding?.input_hash || '')
  ) {
    return new Response(JSON.stringify({
      success: false,
      error: workflowBindingError?.message ||
        'Durable workflow binding or submission identity is invalid',
    }), {
      status: 409,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const requestedPackIdentityHash = String(
    requestedPack?.packIdentityHash || '',
  ).toLowerCase()
  const requestedFingerprints = normalizeDesignProFingerprints(
    requestedPack?.fingerprints,
  )
  const existingFingerprints = normalizeDesignProFingerprints(
    initialResult.fingerprints,
  )
  if (
    !/^[a-f0-9]{64}$/.test(requestedPackIdentityHash) ||
    !requestedFingerprints ||
    (
      initialResult.packIdentityHash &&
      String(initialResult.packIdentityHash).toLowerCase() !==
        requestedPackIdentityHash
    ) ||
    (
      existingFingerprints &&
      !sameDesignProFingerprints(existingFingerprints, requestedFingerprints)
    )
  ) {
    return designproJson(
      {
        success: false,
        error: 'Frozen atomic-pack fingerprints are missing or stale',
        code: 'pack_fingerprint_mismatch',
      },
      409,
    )
  }
  // "complete" is the only terminal state. Validate its workflow binding before
  // honoring the idempotent return so one run cannot probe another run's job.
  if (String(job.state) === 'complete') {
    return ok({ productionJob: job, idempotent: true })
  }

  // Paid production promotes one exact revision pack. Never rediscover a pack
  // from mutable "latest" proof pointers or mix rows across historical vault
  // versions after the order has been accepted.
  const exactPins = {
    revisionId: String(job.revision_id || ''),
    enticePackId: String(job.entice_pack_id || ''),
    dimensionManifestId: String(job.dimension_manifest_id || ''),
    sourceContractHash: String(job.source_contract_hash || '').toLowerCase(),
  }
  const requestedPins = {
    revisionId: String(requestedPack?.revisionId || ''),
    enticePackId: String(requestedPack?.enticePackId || ''),
    dimensionManifestId: String(requestedPack?.dimensionManifestId || ''),
    manifestHash: String(requestedPack?.manifestHash || '').toLowerCase(),
    sourceContractHash: String(
      requestedPack?.sourceContractHash || '',
    ).toLowerCase(),
    artifactSetHash: String(requestedPack?.artifactSetHash || '').toLowerCase(),
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (
    !uuid.test(exactPins.revisionId) ||
    !uuid.test(exactPins.enticePackId) ||
    !uuid.test(exactPins.dimensionManifestId) ||
    !/^[a-f0-9]{64}$/.test(exactPins.sourceContractHash) ||
    requestedPins.revisionId !== exactPins.revisionId ||
    requestedPins.enticePackId !== exactPins.enticePackId ||
    requestedPins.dimensionManifestId !== exactPins.dimensionManifestId ||
    requestedPins.sourceContractHash !== exactPins.sourceContractHash ||
    String(initialResult.revisionId || '') !== exactPins.revisionId ||
    String(initialResult.enticePackId || '') !== exactPins.enticePackId ||
    String(initialResult.dimensionManifestId || '') !==
      exactPins.dimensionManifestId ||
    String(initialResult.sourceContractHash || '').toLowerCase() !==
      exactPins.sourceContractHash ||
    (
      initialResult.manifestHash &&
      String(initialResult.manifestHash).toLowerCase() !==
        requestedPins.manifestHash
    ) ||
    (
      initialResult.artifactSetHash &&
      String(initialResult.artifactSetHash).toLowerCase() !==
        requestedPins.artifactSetHash
    ) ||
    !/^[a-f0-9]{64}$/.test(requestedPins.manifestHash) ||
    !/^[a-f0-9]{64}$/.test(requestedPins.artifactSetHash)
  ) {
    return designproJson(
      {
        success: false,
        error: 'Paid workflow revision-pack pins are missing or stale',
        code: 'paid_pack_pin_mismatch',
      },
      409,
    )
  }

  const [
    { data: pinnedPack, error: pinnedPackError },
    { data: assets, error: assetsError },
  ] = await Promise.all([
    db.from('designpro_entice_packs')
      .select('*')
      .eq('id', exactPins.enticePackId)
      .maybeSingle(),
    db.from('production_flow_assets')
      .select(
        'job_id,side,version,meta_metrics,created_at,revision_id,entice_pack_id,designiq_generation_id,dimension_manifest_id,manifest_hash,source_contract_hash,artifact_hash',
      )
      .eq('entice_pack_id', exactPins.enticePackId)
      .order('created_at', { ascending: false }),
  ])
  if (
    pinnedPackError ||
    !pinnedPack ||
    !['active', 'superseded'].includes(String(pinnedPack.status || '')) ||
    !pinnedPack.verified_at ||
    !pinnedPack.activated_at ||
    String(pinnedPack.user_id || '') !== String(job.user_id || '') ||
    String(pinnedPack.designiq_generation_id || '') !==
      String(job.generation_id || '') ||
    String(pinnedPack.revision_id || '') !== exactPins.revisionId ||
    String(pinnedPack.dimension_manifest_id || '') !==
      exactPins.dimensionManifestId ||
    String(pinnedPack.source_contract_hash || '').toLowerCase() !==
      exactPins.sourceContractHash ||
    String(requestedPack?.sourceHash || '').toLowerCase() !==
      exactPins.sourceContractHash ||
    String(pinnedPack.manifest_hash || '').toLowerCase() !==
      requestedPins.manifestHash ||
    String(pinnedPack.pack_identity_hash || '').toLowerCase() !==
      requestedPackIdentityHash ||
    String(pinnedPack.pack_version || '').toLowerCase() !==
      String(requestedPack?.packVersion || '').toLowerCase()
  ) {
    return designproJson(
      {
        success: false,
        error:
          pinnedPackError?.message ||
          'The paid workflow is not bound to a verified revision pack',
        code: 'paid_pack_binding_invalid',
      },
      409,
    )
  }
  if (assetsError) {
    const message = `Unable to read production assets: ${assetsError.message}`
    const failedWrite = await casDesignProJobUpdate(db, job, workflowRunId, {
      state: 'failed',
      stage: 'asset_preflight',
      last_error: message,
      attempts: Number(job.attempts || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    if (failedWrite.error || failedWrite.conflict) {
      return designProCasFailure('Asset-preflight failure update', failedWrite)
    }
    return new Response(JSON.stringify({ success: false, productionJob: failedWrite.data, error: message }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const canonicalGenerationId = String(pinnedPack.designiq_generation_id || '')
  const proofArtifact = designProResult(pinnedPack.proof_artifact)
  const currentProofUrl = String(proofArtifact.url || '').trim()
  const typedAssetMismatch = (assets || []).some((asset: any) =>
    String(asset.revision_id || '') !== exactPins.revisionId ||
    String(asset.entice_pack_id || '') !== exactPins.enticePackId ||
    String(asset.designiq_generation_id || '') !== canonicalGenerationId ||
    String(asset.dimension_manifest_id || '') !==
      exactPins.dimensionManifestId ||
    String(asset.manifest_hash || '').toLowerCase() !==
      requestedPins.manifestHash ||
    String(asset.source_contract_hash || '').toLowerCase() !==
      exactPins.sourceContractHash ||
    !/^[a-f0-9]{64}$/.test(String(asset.artifact_hash || '').toLowerCase())
  )
  if (
    !currentProofUrl ||
    String(requestedPack?.sourceProofUrl || '').trim() !== currentProofUrl ||
    String(requestedPack?.vaultJobId || '') !== canonicalGenerationId ||
    typedAssetMismatch
  ) {
    return designproJson(
      {
        success: false,
        error: 'Pinned Production Pack artifacts failed their identity fence',
        code: 'paid_pack_artifact_identity_invalid',
      },
      409,
    )
  }

  const pack = selectCompleteAtomicProductionPack(assets || [], currentProofUrl, requestedPack)
  const blocked = !pack
    ? [{
        side: 'PACK',
        reason: currentProofUrl
          ? 'no complete atomic v2 panel pack is bound to the current flat proof'
          : 'no complete atomic v2 panel pack with one source hash, pack version, and expected side set',
      }]
    : pack.expectedSides.flatMap((side) => {
    const asset = pack.rowsBySide[side]
    const meta = asset?.meta_metrics || {}
    const reasons: Array<{ side: string; reason: string }> = []
    // REASONED SEPARATION GAP — the decided Call 7 contract: a side whose
    // separation was deliberately refused ships its branded panel with the
    // clean asset honestly absent and the row honestly production-INELIGIBLE.
    // Same admission shape as verify_atomic_pack and activate-print-worker;
    // without it every real pack (all carry at least one gap side) parked
    // here in awaiting_build_assets forever.
    const separationGap =
      meta.separation_qc?.known === true &&
      meta.separation_qc?.pass === false &&
      String((meta.separation_qc as any)?.reason || '').trim().length > 0 &&
      String(asset?.background_url || '').trim() === ''
    if (meta.production_eligible !== !separationGap) {
      reasons.push({ side, reason: 'not production eligible' })
    }
    if (meta.qc?.known !== true || meta.qc?.pass !== true) {
      reasons.push({ side, reason: 'QC not known/pass' })
    }
    if (meta.separation_qc?.known !== true || meta.separation_qc?.pass !== !separationGap) {
      reasons.push({ side, reason: 'clean/logo separation not known/pass' })
    }
    return reasons
  })
  if (blocked.length) {
    const waitingWrite = await casDesignProJobUpdate(db, job, workflowRunId, {
      state: 'awaiting_build_assets',
      stage: 'asset_preflight',
      blocked,
      attempts: Number(job.attempts || 0) + 1,
      last_error: null,
      completed_at: null,
      updated_at: new Date().toISOString(),
    })
    if (waitingWrite.error || waitingWrite.conflict) {
      return designProCasFailure('Build-assets wait update', waitingWrite)
    }
    return ok({ productionJob: waitingWrite.data, needsBuild: true, blocked })
  }

  // Narrowing above guarantees pack is present whenever preflight is clear.
  const selectedPack = pack!
  const selectedRunKey = (
    await designproHash({
      workflowRunId,
      productionJobId: job.id,
      revisionId: exactPins.revisionId,
      enticePackId: exactPins.enticePackId,
      dimensionManifestId: exactPins.dimensionManifestId,
      sourceContractHash: exactPins.sourceContractHash,
      manifestHash: requestedPins.manifestHash,
      packIdentityHash: requestedPackIdentityHash,
      packVersion: selectedPack.version,
    })
  ).slice(0, 24)
  const activatingWrite = await casDesignProJobUpdate(db, job, workflowRunId, {
    state: 'activating_worker', stage: 'print_worker', blocked: [],
    attempts: Number(job.attempts || 0) + 1,
    last_error: null,
    completed_at: null,
    result: mergeDesignProResult(initialResult, {
      sourceHash: selectedPack.sourceHash,
      packVersion: selectedPack.version,
      sourceProofUrl: selectedPack.sourceProofUrl || currentProofUrl,
      expectedSides: selectedPack.expectedSides,
      vaultJobId: selectedPack.vaultJobId,
      runKey: selectedRunKey,
      workflowRunId,
      packIdentityHash: requestedPackIdentityHash,
      revisionId: exactPins.revisionId,
      enticePackId: exactPins.enticePackId,
      dimensionManifestId: exactPins.dimensionManifestId,
      manifestHash: requestedPins.manifestHash,
      sourceContractHash: exactPins.sourceContractHash,
      artifactSetHash: requestedPins.artifactSetHash,
      fingerprints: requestedFingerprints,
    }),
    updated_at: new Date().toISOString(),
  })
  if (activatingWrite.error || activatingWrite.conflict) {
    return designProCasFailure('Worker-activation transition', activatingWrite)
  }
  const activatingJob = activatingWrite.data
  const activation = await callFn(url, serviceKey, 'activate-print-worker', {
    productionJobId: activatingJob.id,
    jobId: activatingJob.panelizer_job_id,
    generationId: activatingJob.generation_id,
    userId: activatingJob.user_id,
    orderNumber: activatingJob.order_number,
    sourceHash: selectedPack.sourceHash,
    packVersion: selectedPack.version,
    sourceProofUrl: selectedPack.sourceProofUrl || currentProofUrl,
    expectedSides: selectedPack.expectedSides,
    vaultJobId: selectedPack.vaultJobId,
    workflowRunId,
    packIdentityHash: requestedPackIdentityHash,
    revisionId: exactPins.revisionId,
    enticePackId: exactPins.enticePackId,
    dimensionManifestId: exactPins.dimensionManifestId,
    manifestHash: requestedPins.manifestHash,
    sourceContractHash: exactPins.sourceContractHash,
    artifactSetHash: requestedPins.artifactSetHash,
    fingerprints: requestedFingerprints,
  }, 50000)

  // The activation endpoint stamps runKey before dispatch. Re-read that exact
  // durable row before deciding its next state so a timed-out/stale invocation
  // cannot overwrite a newer retry or a worker-completion transition.
  const { data: currentJob, error: currentJobError } = await db
    .from('designpro_production_jobs')
    .select('*')
    .eq('id', activatingJob.id)
    .maybeSingle()
  if (currentJobError || !currentJob) {
    return designproJson(
      { error: currentJobError?.message || 'Durable production job disappeared during activation' },
      503,
    )
  }
  const currentResult = designProResult(currentJob.result)
  const currentIdentityMatches =
    String(currentResult.workflowRunId || '') === workflowRunId &&
    String(currentResult.sourceHash || '').toLowerCase() === selectedPack.sourceHash &&
    String(currentResult.packVersion || '').toLowerCase() === selectedPack.version &&
    String(currentResult.runKey || '').toLowerCase() === selectedRunKey &&
    String(currentResult.packIdentityHash || '').toLowerCase() ===
      requestedPackIdentityHash &&
    String(currentResult.revisionId || '') === exactPins.revisionId &&
    String(currentResult.enticePackId || '') === exactPins.enticePackId &&
    String(currentResult.dimensionManifestId || '') ===
      exactPins.dimensionManifestId &&
    String(currentResult.manifestHash || '').toLowerCase() ===
      requestedPins.manifestHash &&
    String(currentResult.sourceContractHash || '').toLowerCase() ===
      exactPins.sourceContractHash &&
    String(currentResult.artifactSetHash || '').toLowerCase() ===
      requestedPins.artifactSetHash &&
    !!normalizeDesignProFingerprints(currentResult.fingerprints) &&
    sameDesignProFingerprints(
      normalizeDesignProFingerprints(currentResult.fingerprints)!,
      requestedFingerprints,
    )
  if (!currentIdentityMatches) {
    return designproJson(
      {
        error: 'Worker activation became stale; the newer source run was preserved',
        code: 'stale_activation',
      },
      409,
    )
  }
  if (['awaiting_admin_qc', 'complete'].includes(String(currentJob.state))) {
    return ok({
      productionJob: currentJob,
      activation,
      idempotent: true,
      needsBuild: false,
    })
  }
  if (!['activating_worker', 'worker_queued'].includes(String(currentJob.state))) {
    return designproJson(
      {
        error: `Worker activation cannot replace durable state ${String(currentJob.state)}`,
        code: 'stale_activation',
      },
      409,
    )
  }

  const needsBuild = activation?.productionBlocked === true || activation?.needsBuild === true
  const succeeded = activation?.success === true && !needsBuild
  const allComplete = succeeded && activation?.allComplete === true
  const nextState = needsBuild
    ? 'awaiting_build_assets'
    : (allComplete ? 'awaiting_admin_qc' : (succeeded ? 'worker_queued' : 'failed'))
  const nextStage = needsBuild
    ? 'asset_preflight'
    : (allComplete ? 'admin_qc' : (succeeded ? 'worker_activated' : 'worker_activation'))
  const activationError = String(
    activation?.error ||
    (needsBuild ? 'Worker requires a complete current build-assets pack' : 'Worker activation failed'),
  )
  const updatedWrite = await casDesignProJobUpdate(db, currentJob, workflowRunId, {
    state: nextState,
    stage: nextStage,
    blocked: needsBuild
      ? (Array.isArray(activation?.blocked)
          ? activation.blocked
          : [{ side: 'PACK', reason: activationError }])
      : [],
    result: mergeDesignProResult(currentResult, {
      ...activation,
      sourceHash: selectedPack.sourceHash,
      packVersion: selectedPack.version,
      sourceProofUrl: selectedPack.sourceProofUrl || currentProofUrl,
      expectedSides: selectedPack.expectedSides,
      vaultJobId: selectedPack.vaultJobId,
      runKey: selectedRunKey,
      workflowRunId,
      packIdentityHash: requestedPackIdentityHash,
      revisionId: exactPins.revisionId,
      enticePackId: exactPins.enticePackId,
      dimensionManifestId: exactPins.dimensionManifestId,
      manifestHash: requestedPins.manifestHash,
      sourceContractHash: exactPins.sourceContractHash,
      artifactSetHash: requestedPins.artifactSetHash,
      fingerprints: requestedFingerprints,
    }),
    last_error: succeeded ? null : activationError,
    completed_at: null,
    updated_at: new Date().toISOString(),
  })
  if (updatedWrite.error || updatedWrite.conflict) {
    return designProCasFailure('Worker-activation result update', updatedWrite)
  }
  return new Response(JSON.stringify({
    success: succeeded,
    productionJob: updatedWrite.data,
    activation,
    needsBuild,
  }), {
    // A source-preflight stop is a durable waiting state, not a failed request.
    status: (succeeded || needsBuild) ? 200 : 409,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ══════════════════════════════════════════════════════════════
// PROJECT MODE — STATE MACHINE
// ══════════════════════════════════════════════════════════════

async function handleProject(
  body: any,
  principal: RequestPrincipal,
  db: any,
  url: string,
  key: string,
) {
  const { job_id, trigger } = body
  if (!job_id) return fail('job_id required')

  const { data: job, error } = await db.from('panelizer_jobs').select('*').eq('id', job_id).single()
  if (error || !job) return new Response(JSON.stringify({ error: 'Job not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  const ownerId = String(job.user_id || '')
  if (!ownerId) {
    return designproJson({ error: 'Authoritative job owner is unavailable' }, 409)
  }
  if (principal.kind === 'user' && principal.userId !== ownerId) {
    return designproJson({ error: 'Job not found' }, 404)
  }
  const requestedUserId = String(body.user_id || body.userId || '').trim()
  if (requestedUserId && requestedUserId !== ownerId) {
    return designproJson(
      { error: 'Request does not match the authoritative job owner' },
      409,
    )
  }

  // ── GUARD: approved_render_url must exist before pipeline can start ──
  if (!job.approved_render_url) {
    console.error(`[ORCH] job=${job_id} has no approved_render_url — cannot start pipeline`)
    await upd(db, job_id, {
      status: 'failed',
      error_message: 'no approved render URL — cannot start pipeline',
      error_stage: 'pre-flight',
    })
    await evt(db, job_id, 'error', 'pre-flight', { error: 'no approved render URL' })
    return fail('no approved render URL — cannot start pipeline')
  }

  // ── INITIALIZE ─────────────────────────────────────────────
  if (trigger === 'payment_confirmed' || trigger === 'retry' || trigger === 'init_only') {
    // ── MINT PROMPT FINGERPRINT (Design Equity Architecture) ──────
    // SHA-256 hash of the creative DNA: concept_json + user_id + generation_id
    // This is the "Notarized Receipt" that starts the Design Equity chain.
    const cjInit = job.concept_json || {}
    const fingerprintPayload = JSON.stringify({
      designDescription: cjInit.designDescription || '',
      finish: cjInit.finish || '',
      vehicleMake: job.vehicle_make || '',
      vehicleModel: job.vehicle_model || '',
      vehicleYear: job.vehicle_year || '',
      userId: job.user_id,
      generationId: job.generation_id || '',
      timestamp: new Date().toISOString(),
    })
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprintPayload))
    const promptFingerprint = 'PF-' + Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 12).toUpperCase()
    const designId = 'DID-' + (job.generation_id || job_id).replace(/-/g, '').substring(0, 8).toUpperCase()
    console.log(`[ORCH] DesignEquity minted: ${designId} | ${promptFingerprint}`)

    await upd(db, job_id, {
      status: 'queued', current_stage: 0,
      started_at: new Date().toISOString(),
      error_message: null, error_stage: null,
      concept_json: { ...cjInit, promptFingerprint, designId },
      stage_progress: { panelizer_step_index: 0, panelizer_step_data: {}, panelizer_complete: false, pf_qa_complete: false, extract_complete: false, package_complete: false },
    })
    await evt(db, job_id, 'payment_confirmed', null, { trigger, promptFingerprint, designId })

    // ── NOTIFY CUSTOMER: Job started ──
    const vehicleStart = `${job.vehicle_year || ''} ${job.vehicle_make || ''} ${job.vehicle_model || ''}`.trim()
    await notify(db, url, key, {
      user_id: job.user_id, job_id: job_id,
      type: 'job_started',
      title: `Production Started — ${job.order_number}`,
      message: `Your ${vehicleStart} production job is now processing. The GENIE Production Panelizer OS™ pipeline will generate print-ready panels, run automated QC, and package your production files.`,
      order_number: job.order_number,
      send_email: false, // Don't email on start — they just triggered it
    })

    // For init_only trigger, return after initialization — do NOT auto-run
    if (trigger === 'init_only') {
      return ok({ status: 'initialized', job_id, message: 'Job initialized — use manual step triggers' })
    }

    // Fall through to run_all behavior
  }

  // ── RUN ALL (auto-advance via self-invocation) ─────────────
  if (trigger === 'run_all' || trigger === 'payment_confirmed' || trigger === 'retry') {
    // Refresh job after init
    const { data: freshJob } = await db.from('panelizer_jobs').select('*').eq('id', job_id).single()
    let j = freshJob || job
    let sp = j.stage_progress || {}

    // Auto-initialize if stage_progress is missing (e.g. run_all on a fresh job)
    if (!sp.panelizer_step_index && sp.panelizer_step_index !== 0) {
      console.log(`[ORCH] run_all: stage_progress missing — auto-initializing job ${job_id}`)
      const initSp = { panelizer_step_index: 0, panelizer_step_data: {}, panelizer_complete: false, pf_qa_complete: false, extract_complete: false, package_complete: false }
      await upd(db, job_id, {
        status: 'queued', current_stage: 0,
        started_at: new Date().toISOString(),
        error_message: null, error_stage: null,
        stage_progress: initSp,
      })
      sp = initSp
      // Re-fetch job with updated stage_progress
      const { data: reJob } = await db.from('panelizer_jobs').select('*').eq('id', job_id).single()
      if (reJob) j = reJob
    }

    // ── BUILD ASSETS RECONNECT — PULL from the vault, never re-produce ──
    // If deterministic per-side panels already exist in production_flow_assets
    // (Build Assets is the ONLY sanctioned producer), fill the job from them
    // and advance — do NOT re-slice through the legacy artboard step.
    if (!sp.panelizer_complete) {
      const pulled = await pullBuildAssets(job_id, j, sp, db)
      if (pulled) return pulled
    }

    // Phase A: Simplified 3-step pipeline (validate → artboard → upscale-tiff)
    if (!sp.panelizer_complete) {
      const result = await runPanelizerStep(job_id, j, sp, db, url, key)
      const rb = await result.clone().json().catch(() => null)

      if (!rb || (rb.success && rb.status === 'step_complete')) {
        if (!rb) console.warn(`[ORCH] Phase A: JSON parse failed for step result — defensive self-invoke`)
        await selfInvoke(url, key, { job_id, trigger: 'run_all', mode: 'project' }, db)
      }
      return result
    }

    // Phase B: Skip QA/extraction — single artboard doesn't need per-panel QA
    // Phase C: Skip element extraction — no panels to extract from

    // Phase D: Finalize — artboard TIFF is already saved, mark job complete
    if (!sp.package_complete) {
      return await runFinalizeArtboard(job_id, j, sp, db, url, key)
    }

    return ok({ status: 'ready', job_id, order_number: j.order_number })
  }

  // ── NEXT STEP (manual advance) ─────────────────────────────
  if (trigger === 'next_step') {
    const sp = job.stage_progress || {}
    if (!sp.panelizer_complete) return await runPanelizerStep(job_id, job, sp, db, url, key)
    if (!sp.package_complete) return await runFinalizeArtboard(job_id, job, sp, db, url, key)
    return ok({ status: 'ready', job_id })
  }

  // ── RESUME AFTER INPUT (approve gate) ─────────────────────
  if (trigger === 'input_received') {
    const sp = job.stage_progress || {}
    // Resume pipeline from where it paused (awaiting_input)
    await upd(db, job_id, { status: 'panelizing', error_message: null, error_stage: null, stage_progress: sp })
    await evt(db, job_id, 'input_received', 'awaiting_input', { action: 'approved' })
    await selfInvoke(url, key, { job_id, trigger: 'run_all', mode: 'project' }, db)
    return ok({ status: 'resuming', job_id })
  }

  // ── RESET TO STEP (redo from a specific step) ─────────────
  if (trigger === 'reset_to_step') {
    const { reset_to_step } = body
    const stepIdx = PANELIZER_STEPS.findIndex((s: any) => s.key === reset_to_step)
    if (stepIdx < 0) return fail(`Unknown step: ${reset_to_step}`)

    const sp = job.stage_progress || {}
    // Clear step data from the target step onward
    const stepData = { ...(sp.panelizer_step_data || {}) }
    for (let i = stepIdx; i < PANELIZER_STEPS.length; i++) {
      delete stepData[PANELIZER_STEPS[i].key]
    }
    sp.panelizer_step_data = stepData
    sp.panelizer_step_index = stepIdx
    sp.panelizer_complete = false

    await upd(db, job_id, { status: 'panelizing', stage_progress: sp, retry_count: 0, error_message: null, error_stage: null })
    await evt(db, job_id, 'step_reset', reset_to_step, { reset_from_step: reset_to_step, step_index: stepIdx })
    await selfInvoke(url, key, { job_id, trigger: 'run_all', mode: 'project' }, db)
    return ok({ status: 'resetting', job_id, reset_to_step, step_index: stepIdx })
  }

  // ── RUN SINGLE STEP (manual trigger — no auto-advance) ─────
  if (trigger === 'run_single_step') {
    const { step_key } = body
    const stepIdx = PANELIZER_STEPS.findIndex((s: any) => s.key === step_key)
    if (stepIdx < 0) return fail(`Unknown step: ${step_key}`)

    // Initialize stage_progress if this is the first step on a fresh job
    let sp = job.stage_progress || {}
    if (!sp.panelizer_step_data) {
      // Mint prompt fingerprint (Design Equity Architecture)
      const cjInit = job.concept_json || {}
      const fingerprintPayload = JSON.stringify({
        designDescription: cjInit.designDescription || '',
        finish: cjInit.finish || '',
        vehicleMake: job.vehicle_make || '',
        vehicleModel: job.vehicle_model || '',
        vehicleYear: job.vehicle_year || '',
        userId: job.user_id,
        generationId: job.generation_id || '',
        timestamp: new Date().toISOString(),
      })
      const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprintPayload))
      const promptFingerprint = 'PF-' + Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 12).toUpperCase()
      const designId = 'DID-' + (job.generation_id || job_id).replace(/-/g, '').substring(0, 8).toUpperCase()
      console.log(`[ORCH] run_single_step init: ${designId} | ${promptFingerprint}`)

      sp = {
        panelizer_step_index: 0,
        panelizer_step_data: {},
        panelizer_complete: false,
        pf_qa_complete: false,
        extract_complete: false,
        package_complete: false,
      }

      await upd(db, job_id, {
        status: 'panelizing', current_stage: 0,
        started_at: new Date().toISOString(),
        error_message: null, error_stage: null,
        concept_json: { ...cjInit, promptFingerprint, designId },
        stage_progress: sp,
      })
      await evt(db, job_id, 'manual_init', step_key, { promptFingerprint, designId })
    }

    // Clear this step's data so it re-runs cleanly
    const stepData = { ...(sp.panelizer_step_data || {}) }
    delete stepData[step_key]
    sp.panelizer_step_data = stepData
    sp.panelizer_step_index = stepIdx
    sp.panelizer_complete = false

    await upd(db, job_id, { status: 'panelizing', stage_progress: sp, retry_count: 0, error_message: null, error_stage: null })
    await evt(db, job_id, 'manual_step_trigger', step_key, { step_index: stepIdx })
    // Run ONLY this step — no selfInvoke chain
    return await runPanelizerStep(job_id, { ...job, stage_progress: sp }, sp, db, url, key)
  }

  // ── PULL BUILD ASSETS (idempotent reconnection) ────────────
  // ProductionFlow polls this for jobs stuck at 'queued'. If the Build Assets
  // vault has panels for this job's canonical generation id, fill + advance;
  // if not, report needsBuild and leave the job untouched (no AI fallback).
  if (trigger === 'pull_build_assets') {
    const sp = job.stage_progress || {}
    if (sp.panelizer_complete || ['pending_qc', 'ready'].includes(job.status)) {
      return ok({ status: job.status, job_id, pulled: false, message: 'already advanced' })
    }
    const pulled = await pullBuildAssets(job_id, job, sp, db)
    if (pulled) return pulled
    return ok({ status: job.status, job_id, pulled: false, needsBuild: true })
  }

  return fail('Invalid trigger. Use: payment_confirmed, run_all, next_step, input_received, retry, reset_to_step, run_single_step, pull_build_assets')
}

// ── BUILD ASSETS VAULT PULL — the sanctioned reconnection ────────────
// Build Assets (deterministic gridslice → production_flow_assets) is the ONLY
// sanctioned panel producer. When vault rows exist for this job's canonical
// generation id, fill the job's panels FROM them (newest row per side) and land
// the job at pending_qc — never re-slice. Canonical-id resolution mirrors
// activate-print-worker (color_visualizations.admin_notes.designiq_generation_id).
// Returns the Response when it pulled, or null when no vault exists.
const VAULT_SIDE_TO_QC_KEY: Record<string, string> = {
  'DRIVER SIDE': 'driver_side',
  'PASSENGER SIDE': 'passenger_side',
  'HOOD': 'hood',
  'ROOF': 'roof',
  'FRONT': 'front',
  'REAR': 'rear',
}

async function pullBuildAssets(jid: string, job: any, sp: any, db: any) {
  if (!job.generation_id) return null

  // Canonical vault id: the render id AND its designiq back-link.
  let canonicalGid = String(job.generation_id)
  try {
    const { data: viz } = await db.from('color_visualizations')
      .select('admin_notes').eq('id', job.generation_id).maybeSingle()
    const raw = (viz as any)?.admin_notes
    const n = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {}
    if (n?.designiq_generation_id) canonicalGid = String(n.designiq_generation_id)
  } catch { /* fall back to generation_id */ }
  const gids = Array.from(new Set([canonicalGid, String(job.generation_id)]))

  const { data: pfaAll } = await db.from('production_flow_assets')
    .select('side, dimensions_inches, background_url, branding_url, final_pack_url, created_at, meta_metrics')
    .in('job_id', gids).order('created_at', { ascending: false })

  // Newest row per side.
  const bySide: Record<string, any> = {}
  for (const r of (pfaAll || [])) {
    const k = String(r.side || '').toUpperCase()
    if (!bySide[k]) bySide[k] = r
  }
  if (Object.keys(bySide).length === 0) return null // no vault → caller decides

  // A partial/preview vault is NOT a production build. Only advance when every
  // required side exists and carries the explicit fail-closed stamps written by
  // save-production-panels. This prevents one good driver preview from marking
  // a six-side production job complete.
  const vehicleText = `${job.vehicle_make || ''} ${job.vehicle_model || ''} ${(job.concept_json || {}).vehicleType || ''}`
  const isTrailer = /\btrailer\b/i.test(vehicleText)
  const requiredSides = isTrailer
    ? ['DRIVER SIDE', 'PASSENGER SIDE', 'FRONT', 'REAR']
    : Object.keys(VAULT_SIDE_TO_QC_KEY)
  const blocked = requiredSides.flatMap((side) => {
    const row = bySide[side]
    if (!row) return [{ side, reason: 'missing production panel' }]
    const meta = row.meta_metrics && typeof row.meta_metrics === 'object' ? row.meta_metrics : {}
    if ((meta as any).production_eligible !== true) {
      return [{ side, reason: 'panel is preview-only or missing production provenance' }]
    }
    if ((meta as any).qc?.known !== true || (meta as any).qc?.pass !== true) {
      return [{ side, reason: 'panel QC is missing, unavailable, or failed' }]
    }
    return []
  })
  if (blocked.length) {
    console.warn(`[ORCH] Build Assets vault is not production-complete for job=${jid}: ${JSON.stringify(blocked)}`)
    return null
  }

  const cj = job.concept_json || {}
  const qcPanels: Record<string, any> = { ...(cj.qc_side_panels || {}) }
  const now = new Date().toISOString()
  const filledSides: string[] = []
  for (const [side, row] of Object.entries(bySide) as [string, any][]) {
    const sideKey = VAULT_SIDE_TO_QC_KEY[side] || side.toLowerCase().replace(/\s+/g, '_')
    const panelUrl = row.final_pack_url || row.branding_url || row.background_url
    if (!panelUrl || qcPanels[sideKey]?.approved) continue // never clobber an approval
    qcPanels[sideKey] = {
      ...(qcPanels[sideKey] || {}),
      side: sideKey,
      panelUrl,
      dimensions_inches: row.dimensions_inches || null,
      approved: false, // human QC gate stays — admin approves in QC Artboard
      source: 'build_assets_vault',
      pulled_at: now,
    }
    filledSides.push(sideKey)
  }
  if (filledSides.length === 0 && Object.keys(qcPanels).length === 0) return null

  // Patch panels[] previews so the Production Panels grid shows the real slices.
  const sideAliases: Record<string, string[]> = {
    driver_side: ['driver'], passenger_side: ['passenger'],
    hood: ['hood'], roof: ['roof'], rear: ['rear', 'trunk', 'back'], front: ['front'],
  }
  const panels = Array.isArray(job.panels)
    ? job.panels.map((p: any) => {
        const nameNorm = String(p.label || p.name || p.id || '').toLowerCase()
        const hit = Object.entries(sideAliases).find(([k, aliases]) =>
          qcPanels[k]?.panelUrl && aliases.some((a) => nameNorm.includes(a)))
        return hit
          ? { ...p, signed_url: qcPanels[hit[0]].panelUrl, preview_url: qcPanels[hit[0]].panelUrl, status: 'ready' }
          : p
      })
    : job.panels

  // Mark the whole pipeline satisfied-by-pull so run_all/next_step can never
  // fall into runFinalizeArtboard (which requires a zip path and would fail).
  sp.panelizer_complete = true
  sp.pf_qa_complete = true
  sp.extract_complete = true
  sp.package_complete = true
  sp.panelizer_step_data = {
    ...(sp.panelizer_step_data || {}),
    build_assets_pull: { completed_at: now, result: { canonicalGid, sides: filledSides } },
  }

  await upd(db, jid, {
    status: 'pending_qc',
    current_stage: 4,
    stage_progress: sp,
    panels,
    error_message: null, error_stage: null,
    concept_json: { ...cj, qc_side_panels: qcPanels, build_assets_pull: { canonicalGid, sides: filledSides, pulled_at: now } },
  })
  await evt(db, jid, 'build_assets_pulled', 'panelizing', { canonicalGid, sides: filledSides })
  console.log(`[ORCH] Build Assets vault pull: job=${jid} gid=${canonicalGid} sides=[${filledSides.join(', ')}] → pending_qc`)
  return ok({ status: 'pending_qc', job_id: jid, pulled: true, sides: filledSides, canonicalGid })
}

// ── RUN ONE PIPELINE STEP ────────────────────────────────────
// Simplified: validate → artboard → upscale-tiff

async function runPanelizerStep(jid: string, job: any, sp: any, db: any, url: string, key: string) {
  const idx = sp.panelizer_step_index || 0

  if (idx >= PANELIZER_STEPS.length) {
    sp.panelizer_complete = true
    await upd(db, jid, { stage_progress: sp, status: 'pending_qc' })
    await evt(db, jid, 'stage_completed', 'panelizing', { steps_completed: PANELIZER_STEPS.length })
    return ok({ status: 'panelizer_complete', job_id: jid })
  }

  const step = PANELIZER_STEPS[idx]
  const pfStage = PF_STAGES[step.pfStage]

  await upd(db, jid, { status: pfStage.status, current_stage: step.pfStage })
  await evt(db, jid, 'stage_started', step.key, { label: step.label, step_index: idx })

  const cj = job.concept_json || {}

  // ── STEP: ARTBOARD — resolve the canonical Build Assets vault ────────────
  // This orchestrator is a CONSUMER, never a second panel producer. The old
  // branch called a skip-deployed legacy function, retried it three times, then
  // emailed the customer that production failed. The only sanctioned producer
  // writes production-eligible, QC-passed per-side assets to
  // production_flow_assets. If those assets are not ready, pause honestly and
  // let the server-side build job create them; never redraw/crop a replacement.
  if (step.key === 'artboard') {
    const vehicleName = `${job.vehicle_year || ''} ${job.vehicle_make || ''} ${job.vehicle_model || ''}`.trim() || 'Unknown Vehicle'
    const designDesc = cj.designDescription || cj.design_name || 'Custom vehicle wrap design'

    // 1. Resolve the 2D proof — generate + persist it from the views if missing.
    let proofUrl = cj.flat_proof_url || cj.proof_2d_url || ''
    const views = job.all_view_urls && typeof job.all_view_urls === 'object' ? job.all_view_urls : {}
    if (!proofUrl && Object.keys(views).length) {
      console.log('[ORCH] No 2D proof on job — generating it from the views (generate-2d-proof)')
      const pr = await callFn(url, key, 'generate-2d-proof', {
        allViewUrls: views,
        vehicleYear: job.vehicle_year || '', vehicleMake: job.vehicle_make || '', vehicleModel: job.vehicle_model || '',
        designName: designDesc, finish: cj.finish || 'Gloss',
      }, 120000)
      proofUrl = pr?.proofUrl || pr?.url || ''
      if (proofUrl) {
        cj.flat_proof_url = proofUrl
        await upd(db, jid, { concept_json: cj })
        console.log(`[ORCH] ✓ 2D proof generated + saved: ${String(proofUrl).slice(0, 80)}`)
      }
    }

    // The vault may have completed while validate/proof generation ran.
    const refreshed = { ...job, concept_json: cj }
    const pulled = await pullBuildAssets(jid, refreshed, sp, db)
    if (pulled) return pulled

    const reason = proofUrl
      ? 'Canonical production panels have not been built for this approved proof yet.'
      : `No 2D production proof is available for ${vehicleName}.`
    const requestedAt = new Date().toISOString()
    await upd(db, jid, {
      status: 'awaiting_build_assets',
      current_stage: step.pfStage,
      stage_progress: sp,
      retry_count: 0,
      error_message: null,
      error_stage: null,
      concept_json: {
        ...cj,
        flat_proof_url: proofUrl || null,
        production_build: {
          state: 'awaiting_build_assets',
          proof_url: proofUrl || null,
          requested_at: requestedAt,
          reason,
        },
      },
    })
    await evt(db, jid, 'build_assets_required', step.key, {
      proof_url: proofUrl || null,
      requested_at: requestedAt,
      reason,
    })
    console.warn(`[ORCH] ${reason} job=${jid} — paused without retry, redraw, or customer failure email`)
    return ok({
      status: 'awaiting_build_assets',
      job_id: jid,
      needsBuild: true,
      proofUrl: proofUrl || null,
      reason,
    })
  }

  // ── STEP: UPSCALE-TIFF — Upscale artboard to production file ──
  if (step.key === 'upscale-tiff') {
    const artboardResult = sp.panelizer_step_data?.artboard?.result || {}
    const artboardPath = artboardResult.artboardPath || ''

    if (!artboardPath) {
      await upd(db, jid, { status: 'failed', error_message: 'No artboard path from previous step', error_stage: step.key })
      return fail('No artboard path — cannot upscale')
    }

    console.log(`[ORCH] Upscaling artboard to production TIFF: ${artboardPath}`)
    const result = await callFn(url, key, step.fn, {
      artboardMode: true,
      artboardPath,
      userId: job.user_id,
      jobId: jid,
      orderNumber: job.order_number,
    }, step.timeoutMs || 120000)

    if (!result.success) {
      const retries = job.retry_count || 0
      await upd(db, jid, { error_message: `Upscale failed: ${result.error}`, error_stage: step.key, retry_count: retries + 1 })
      if (retries < 2) {
        return await runPanelizerStep(jid, { ...job, retry_count: retries + 1 }, sp, db, url, key)
      }
      await upd(db, jid, { status: 'failed' })
      return fail(`Upscale failed after 3 attempts: ${result.error}`)
    }

    console.log(`[ORCH] ✓ Production file ready: ${result.storagePath} (${result.upscaled ? '4x upscaled' : 'original'}, ${(result.sizeBytes / 1024).toFixed(0)} KB)`)
    sp.panelizer_step_data = { ...(sp.panelizer_step_data || {}), [step.key]: { completed_at: new Date().toISOString(), result } }
    sp.panelizer_step_index = idx + 1
    await upd(db, jid, {
      stage_progress: sp, retry_count: 0, error_message: null, error_stage: null,
      zip_storage_path: result.storagePath,
      zip_signed_url: result.signedUrl,
    })
    await evt(db, jid, 'stage_completed', step.key, { step_index: idx, storagePath: result.storagePath, upscaled: result.upscaled })
    return ok({ status: 'step_complete', job_id: jid, step_completed: step.key, step_label: step.label, step_index: idx, steps_remaining: PANELIZER_STEPS.length - idx - 1, next_step: 'finalize' })
  }

  // ── STEP: VALIDATE — Pass through to existing validate function ──
  const result = await callFn(url, key, step.fn, {
    job_id: jid, jobId: jid, user_id: job.user_id, userId: job.user_id,
    approved_render_url: job.approved_render_url, renderUrl: job.approved_render_url,
    all_view_urls: job.all_view_urls || null, concept_json: cj,
    vehicle_year: job.vehicle_year, vehicleYear: job.vehicle_year,
    vehicle_make: job.vehicle_make, vehicleMake: job.vehicle_make,
    vehicle_model: job.vehicle_model, vehicleModel: job.vehicle_model,
    vehicle: `${job.vehicle_year || ''} ${job.vehicle_make || ''} ${job.vehicle_model || ''}`.trim(),
    finish: cj.finish || 'gloss', panels: job.panels || [],
    addHood: cj.addHood ?? false, addFrontBumper: cj.addFrontBumper ?? false,
    addRearBumper: cj.addRearBumper ?? false,
    addRoof: cj.roofSize && cj.roofSize !== 'none',
    roofSize: cj.roofSize || 'none', sideSize: cj.sideSize || 'xl',
    orderNumber: job.order_number,
  }, step.timeoutMs || 50000)

  if (!result.success) {
    const retries = job.retry_count || 0
    await upd(db, jid, { error_message: `Step '${step.key}': ${result.error}`, error_stage: step.key, retry_count: retries + 1 })
    await evt(db, jid, 'error', step.key, { error: result.error, retry: retries })
    if (retries < 2) {
      return await runPanelizerStep(jid, { ...job, retry_count: retries + 1 }, sp, db, url, key)
    }
    await upd(db, jid, { status: 'failed' })
    const vehicleFail = `${job.vehicle_year || ''} ${job.vehicle_make || ''} ${job.vehicle_model || ''}`.trim()
    await notify(db, url, key, {
      user_id: job.user_id, job_id: jid, type: 'job_failed',
      title: `Production Issue — ${job.order_number}`,
      message: `Your ${vehicleFail} production job encountered an issue at the "${step.label}" step after 3 attempts.`,
      order_number: job.order_number, send_email: true,
      email_template: 'production-job-failed',
      email_data: { vehicle: vehicleFail, failed_step: step.label, error: result.error || 'Unknown error' },
    })
    return fail(`Step '${step.key}' failed after 3 attempts: ${result.error}`)
  }

  // Merge result, advance index
  sp.panelizer_step_data = { ...(sp.panelizer_step_data || {}), [step.key]: { completed_at: new Date().toISOString(), result: result.data || result } }
  sp.panelizer_step_index = idx + 1

  const panels = result.panels || result.data?.panels || job.panels || []
  const updateFields: Record<string, any> = {
    stage_progress: sp,
    panels: panels.length > 0 ? panels : job.panels,
    retry_count: 0, error_message: null, error_stage: null,
  }

  // After validate: update concept_json.sideSize with REAL validated dimensions
  if (step.key === 'validate') {
    const validateResult = result.data || result
    const validatedSideSize = validateResult.sideSize || validateResult.sizeValidation?.tier
    if (validatedSideSize) {
      updateFields.concept_json = { ...cj, sideSize: validatedSideSize, twoPanel: validateResult.twoPanel || false }
      console.log(`[ORCH] validate: sideSize → "${validatedSideSize}"`)
    }
  }

  await upd(db, jid, updateFields)
  await evt(db, jid, 'stage_completed', step.key, { step_index: idx, panels: panels.length })

  return ok({
    status: 'step_complete', job_id: jid,
    step_completed: step.key, step_label: step.label,
    step_index: idx, steps_remaining: PANELIZER_STEPS.length - idx - 1,
    next_step: idx + 1 < PANELIZER_STEPS.length ? PANELIZER_STEPS[idx + 1].key : 'finalize',
  })
}

// ── FINALIZE ARTBOARD — Simplified completion for single-artboard pipeline ──

async function runFinalizeArtboard(jid: string, job: any, sp: any, db: any, url: string, key: string) {
  await upd(db, jid, { status: 'packaging', current_stage: 4 })

  // The upscale-tiff step already saved the production file path
  const zipPath = job.zip_storage_path
  const signedUrl = job.zip_signed_url

  if (!zipPath) {
    await upd(db, jid, { status: 'failed', error_message: 'No production file path — upscale step may have failed', error_stage: 'finalize' })
    return fail('No production file path — cannot finalize')
  }

  const ms = Date.now() - new Date(job.started_at || Date.now()).getTime()
  sp.package_complete = true
  sp.pf_qa_complete = true   // Skip QA — single artboard doesn't need per-panel QA
  sp.extract_complete = true  // Skip extraction — no panels to extract

  // Initialize QC data for Admin Graphic Designer QC — 24h human review window
  const existingConcept = job.concept_json || {}
  const qcData = {
    state: 'incoming',
    steps: {},
    reviewer_notes: '',
    reviewed_at: null,
    deployed_at: null,
    ai_chat_history: [],
    submitted_at: new Date().toISOString(),
  }

  // Set status to pending_qc — files are ready but need human QC admin approval
  await upd(db, jid, {
    status: 'pending_qc', zip_storage_path: zipPath, zip_signed_url: signedUrl,
    completed_at: new Date().toISOString(), processing_time_ms: ms, stage_progress: sp,
    concept_json: { ...existingConcept, qc_data: qcData },
  })
  await evt(db, jid, 'artboard_ready', 'finalize', { artboard_path: zipPath, ms })
  await evt(db, jid, 'admin_qc_queued', 'finalize', { message: '24h human QC review window started — awaiting admin approval' })

  // WrapBox delivery — upsert into design_pack_purchases so /wrapbox shows the order
  try {
    let userRow: any = null
    try { const r = await db.from('auth.users').select('email').eq('id', job.user_id).single(); userRow = r.data } catch {}
    const userEmail = userRow?.email || ''

    const upsertResult = await db.from('design_pack_purchases').upsert({
      design_id: job.generation_id || jid,
      email: userEmail,
      purchase_type: 'printed_panels',
      stripe_checkout_id: `pf-${jid}`,
      user_id: job.user_id,
      generation_id: job.generation_id,
      order_number: job.order_number,
      production_status: 'ready',
      wrapbox_delivery_url: signedUrl,
      download_url: signedUrl,
      vehicle_year: String(job.vehicle_year || ''),
      vehicle_make: job.vehicle_make || '',
      vehicle_model: job.vehicle_model || '',
      generation_completed_at: new Date().toISOString(),
      ownership_status: 'owned',
      ownership_acquired_at: new Date().toISOString(),
      license_type: 'production',
      transferable: false,
      download_expires_at: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
    }, { onConflict: 'generation_id,user_id', ignoreDuplicates: false })

    if (upsertResult.error) {
      console.error('WrapBox upsert conflict, trying insert:', upsertResult.error)
      await db.from('design_pack_purchases').insert({
        design_id: job.generation_id || jid,
        email: userEmail,
        purchase_type: 'printed_panels',
        stripe_checkout_id: `pf-${jid}-${Date.now()}`,
        user_id: job.user_id,
        generation_id: job.generation_id,
        order_number: job.order_number,
        production_status: 'ready',
        wrapbox_delivery_url: signedUrl,
        download_url: signedUrl,
        vehicle_year: String(job.vehicle_year || ''),
        vehicle_make: job.vehicle_make || '',
        vehicle_model: job.vehicle_model || '',
        generation_completed_at: new Date().toISOString(),
        download_expires_at: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
        ownership_status: 'owned',
        ownership_acquired_at: new Date().toISOString(),
        license_type: 'production',
        transferable: false,
      })
    }
    console.log(`WrapBox delivery: ${job.order_number} → design_pack_purchases`)

    // Mark generation as production-purchased + stamp Design Equity IDs
    if (job.generation_id) {
      try {
        const equityCj = job.concept_json || {}
        await db.from('designiq_generations').update({
          production_purchased: true,
          production_purchased_at: new Date().toISOString(),
          ownership_status: 'owned',
          design_equity_id: equityCj.designId || null,
          prompt_fingerprint: equityCj.promptFingerprint || null,
        }).eq('id', job.generation_id)
      } catch { /* non-fatal — columns may not exist yet */ }
    }
  } catch (e) { console.error('WrapBox delivery failed (non-blocking):', e) }

  // Email (awaited to prevent EarlyDrop)
  try {
    await callFn(url, key, 'send-design-pack-email', {
      user_id: job.user_id, order_number: job.order_number, download_url: signedUrl,
      vehicle: `${job.vehicle_year} ${job.vehicle_make} ${job.vehicle_model}`,
      upsells_available: false,
    })
    await upd(db, jid, { delivery_email_sent: true, delivered_at: new Date().toISOString() })
  } catch { /* email delivery non-critical */ }

  // ── NOTIFY CUSTOMER: Production artboard ready ──
  const vehicleReady = `${job.vehicle_year || ''} ${job.vehicle_make || ''} ${job.vehicle_model || ''}`.trim()
  await notify(db, url, key, {
    user_id: job.user_id, job_id: jid,
    type: 'job_ready',
    title: `Production Pack Ready — ${job.order_number}`,
    message: `Your ${vehicleReady} master artboard is ready for download. Single production-ready TIFF file, RIP-compatible.`,
    order_number: job.order_number,
    send_email: false, // Already sent via send-design-pack-email above
  })

  return ok({ status: 'ready', job_id: jid, order_number: job.order_number, download_url: signedUrl, ms })
}

// ── PRODUCTIONFLOW QA (legacy — kept for manual trigger compatibility) ──

async function runPFQA(jid: string, job: any, sp: any, db: any, url: string, key: string) {
  await upd(db, jid, { status: 'qa_checking', current_stage: 3 })

  const qa = await callFn(url, key, 'qa-validate-panels', {
    job_id: jid, panels: job.panels || [],
    vehicle: { year: job.vehicle_year, make: job.vehicle_make, model: job.vehicle_model },
  })

  await upd(db, jid, { qa_results: qa, qa_passed: qa.all_passed, qa_issues_count: qa.total_issues || 0, qa_requires_input: qa.requires_input || false })
  await evt(db, jid, qa.all_passed ? 'qa_passed' : 'qa_failed', 'qa_checking', qa)

  if (qa.requires_input) {
    const questions = (qa.issues || []).filter((i: any) => i.requires_input).map((i: any) => ({
      issue_id: i.id, question: i.customer_message,
      options: i.options || ['auto_fix', 'keep_as_is'],
      cost: i.fix_cost || 0, panel: i.panel_name, preview_url: i.preview_url,
    }))
    await upd(db, jid, { status: 'awaiting_input', current_stage: 6, customer_inputs: questions })
    await evt(db, jid, 'input_requested', 'awaiting_input', { questions: questions.length })

    // ── NOTIFY CUSTOMER: QA needs your input ──
    const vehicle = `${job.vehicle_year || ''} ${job.vehicle_make || ''} ${job.vehicle_model || ''}`.trim()
    const issueList = questions.map((q: any) => `• ${q.question}`).join('\n')
    await notify(db, url, key, {
      user_id: job.user_id, job_id: jid,
      type: 'qa_input_needed',
      title: `QA Review Needed — ${job.order_number}`,
      message: `Our automated QC flagged ${questions.length} item(s) on your ${vehicle} production job that need your decision. The pipeline is paused until you respond.`,
      order_number: job.order_number,
      send_email: true,
      email_template: 'production-qa-input',
      email_data: {
        vehicle, issue_count: String(questions.length), issue_list: issueList,
      },
    })

    return ok({ status: 'awaiting_input', job_id: jid, questions })
  }

  sp.pf_qa_complete = true
  await upd(db, jid, { stage_progress: sp })
  return ok({ status: 'qa_complete', job_id: jid, qa_passed: qa.all_passed })
}

// ── ELEMENT EXTRACTION ───────────────────────────────────────

async function runExtract(jid: string, job: any, sp: any, db: any, url: string, key: string) {
  await upd(db, jid, { status: 'extracting_elements', current_stage: 5 })

  // ── GENIE 2.1: AI flat panel extraction (optional) ──────────
  // If useGenie21Extract is set in concept_json, run panelizer-step-extract
  // on each selected panel BEFORE element extraction. Sequential to avoid rate limits.
  const cj = job.concept_json || {}
  if (cj.useGenie21Extract && job.approved_render_url) {
    // Render view mapping — which 3D render angle to extract from
    const PANEL_RENDER_VIEW: Record<string, string> = {
      'driver-side': 'driver', 'passenger-side': 'passenger',
      'hood': 'hood', 'roof': 'hood', 'trunk': 'rear',
      'front-bumper': 'front', 'rear-bumper': 'rear',
    }

    // Look up REAL vehicle dimensions from the 260-row database
    const vehicleDims = lookupVehicle(job.vehicle_make || '', job.vehicle_model || '')
    console.log(`[ORCH] GENIE 2.1: Vehicle DB → ${vehicleDims.bodyLengthInches}" × ${vehicleDims.bodyHeightInches}" (${vehicleDims.category}, ${vehicleDims.source})`)

    const genie21Panels = cj.genie21Panels || Object.keys(PANEL_RENDER_VIEW)
    const vehicle = `${job.vehicle_year || ''} ${job.vehicle_make || ''} ${job.vehicle_model || ''}`.trim()
    const genie21Results: Record<string, any> = {}

    console.log(`[ORCH] GENIE 2.1: extracting ${genie21Panels.length} panels for ${vehicle}`)
    await evt(db, jid, 'genie21_started', 'extracting_elements', { panels: genie21Panels.length })

    // Helper to get real panel dimensions from vehicle data
    function getVehiclePanelDims(panelKey: string): { w: number; h: number; aspectRatio: string } {
      let w: number, h: number
      switch (panelKey) {
        case 'driver-side': case 'passenger-side':
          w = vehicleDims.bodyLengthInches; h = vehicleDims.bodyHeightInches; break
        case 'hood':
          w = vehicleDims.hoodWidthInches; h = vehicleDims.hoodLengthInches; break
        case 'roof':
          w = vehicleDims.roofWidthInches; h = vehicleDims.roofLengthInches; break
        case 'trunk':
          w = vehicleDims.backWidthInches; h = vehicleDims.backHeightInches; break
        case 'front-bumper':
          w = Math.round(vehicleDims.bodyLengthInches * 0.6); h = 35; break
        case 'rear-bumper':
          w = Math.round(vehicleDims.bodyLengthInches * 0.6); h = 29; break
        default:
          w = 165; h = 54
      }
      const gcdFn = (a: number, b: number): number => { a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b)); while (b) { [a, b] = [b, a % b] } return a }
      const g = gcdFn(Math.round(w), Math.round(h))
      return { w: Math.round(w), h: Math.round(h), aspectRatio: `${Math.round(w) / g}:${Math.round(h) / g}` }
    }

    for (const panelKey of genie21Panels) {
      const renderView = PANEL_RENDER_VIEW[panelKey]
      if (!renderView) { console.warn(`[ORCH] GENIE 2.1: unknown panel "${panelKey}" — skipping`); continue }

      const dims = getVehiclePanelDims(panelKey)
      console.log(`[ORCH] GENIE 2.1: ${panelKey} → ${dims.w}" × ${dims.h}" (vehicle-aware)`)

      const result = await callFn(url, key, 'panelizer-step-extract', {
        jobId: jid,
        vehicle,
        renderUrl: job.approved_render_url,
        renderView,
        panelKey,
        panelDimensions: {
          widthInches: dims.w,
          heightInches: dims.h,
          aspectRatio: dims.aspectRatio,
        },
        designDescription: cj.designDescription || 'vehicle wrap design',
        userId: job.user_id,
      }, 90000) // 90s timeout for Gemini image gen

      genie21Results[panelKey] = result
      if (result.success) {
        console.log(`[ORCH] GENIE 2.1: ${panelKey} OK in ${result.generationTimeMs}ms`)
      } else {
        console.warn(`[ORCH] GENIE 2.1: ${panelKey} FAILED — ${result.error}`)
      }
    }

    sp.genie21_results = genie21Results
    await upd(db, jid, { stage_progress: sp })
    await evt(db, jid, 'genie21_completed', 'extracting_elements', {
      total: genie21Panels.length,
      succeeded: Object.values(genie21Results).filter((r: any) => r.success).length,
    })
  }

  const ext = await callFn(url, key, 'extract-logo-elements', {
    job_id: jid, approved_render_url: job.approved_render_url,
    concept_json: job.concept_json, user_id: job.user_id,
  })

  const elements = ext.success ? (ext.elements || []) : []
  const upsells = [...buildProjectUpsells(elements, job), ...buildQuickPrepUpsells(elements)]

  sp.extract_complete = true
  await upd(db, jid, { extracted_elements: elements, upsells_offered: upsells, stage_progress: sp })
  await evt(db, jid, 'stage_completed', 'extracting_elements', { elements: elements.length, upsells: upsells.length })

  return ok({ status: 'extraction_complete', job_id: jid, elements: elements.length, upsells })
}

// ── FINAL PACKAGING ──────────────────────────────────────────

async function runFinalPkg(jid: string, job: any, sp: any, db: any, url: string, key: string) {
  await upd(db, jid, { status: 'packaging', current_stage: 4 })

  let zipPath = job.zip_storage_path
  let signedUrl = job.zip_signed_url

  if (!zipPath) {
    const pkg = await callFn(url, key, 'package-production-files', {
      job_id: jid, panels: job.panels, elements: job.extracted_elements || [],
      user_id: job.user_id, order_number: job.order_number,
      vehicle: { year: job.vehicle_year, make: job.vehicle_make, model: job.vehicle_model },
    })
    if (!pkg.success) {
      await upd(db, jid, { status: 'failed', error_message: pkg.error, error_stage: 'packaging' })
      const vehiclePkgFail = `${job.vehicle_year || ''} ${job.vehicle_make || ''} ${job.vehicle_model || ''}`.trim()
      await notify(db, url, key, {
        user_id: job.user_id, job_id: jid, type: 'job_failed',
        title: `Packaging Issue — ${job.order_number}`,
        message: `Your ${vehiclePkgFail} production pack could not be assembled. Our team has been notified.`,
        order_number: job.order_number, send_email: true,
        email_template: 'production-job-failed',
        email_data: { vehicle: vehiclePkgFail, failed_step: 'Production Packaging', error: pkg.error || 'Assembly failed' },
      })
      return fail(pkg.error)
    }
    zipPath = pkg.zip_path; signedUrl = pkg.signed_url
  }

  const ms = Date.now() - new Date(job.started_at || Date.now()).getTime()
  sp.package_complete = true

  // Initialize QC data for Admin Graphic Designer QC — 24h human review window
  const existingConcept = job.concept_json || {}
  const qcData = {
    state: 'incoming',
    steps: {},
    reviewer_notes: '',
    reviewed_at: null,
    deployed_at: null,
    ai_chat_history: [],
    submitted_at: new Date().toISOString(),
  }

  // Set status to pending_qc — files are packaged but need human QC admin approval
  // before the customer sees "READY FOR PRINT". Only "Deploy to WrapBox" sets status='ready'.
  await upd(db, jid, {
    status: 'pending_qc', zip_storage_path: zipPath, zip_signed_url: signedUrl,
    completed_at: new Date().toISOString(), processing_time_ms: ms, stage_progress: sp,
    concept_json: { ...existingConcept, qc_data: qcData },
  })
  await evt(db, jid, 'zip_ready', 'packaging', { zip_path: zipPath, ms })
  await evt(db, jid, 'admin_qc_queued', 'packaging', { message: '24h human QC review window started — awaiting admin approval' })

  // WrapBox delivery — upsert into design_pack_purchases so /wrapbox shows the order
  try {
    let userRow: any = null
    try { const r = await db.from('auth.users').select('email').eq('id', job.user_id).single(); userRow = r.data } catch {}
    const userEmail = userRow?.email || ''

    const upsertResult = await db.from('design_pack_purchases').upsert({
      design_id: job.generation_id || jid,
      email: userEmail,
      purchase_type: 'printed_panels',
      stripe_checkout_id: `pf-${jid}`,
      user_id: job.user_id,
      generation_id: job.generation_id,
      order_number: job.order_number,
      production_status: 'ready',
      wrapbox_delivery_url: signedUrl,
      download_url: signedUrl,
      vehicle_year: String(job.vehicle_year || ''),
      vehicle_make: job.vehicle_make || '',
      vehicle_model: job.vehicle_model || '',
      generation_completed_at: new Date().toISOString(),
      // ── DESIGN OWNERSHIP: Mark as owned on production pack delivery ──
      ownership_status: 'owned',
      ownership_acquired_at: new Date().toISOString(),
      license_type: 'production',
      transferable: false,
      download_expires_at: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
    }, { onConflict: 'generation_id,user_id', ignoreDuplicates: false })

    if (upsertResult.error) {
      // Fallback: try without onConflict if the unique constraint doesn't exist
      console.error('WrapBox upsert conflict, trying insert:', upsertResult.error)
      await db.from('design_pack_purchases').insert({
        design_id: job.generation_id || jid,
        email: userEmail,
        purchase_type: 'printed_panels',
        stripe_checkout_id: `pf-${jid}-${Date.now()}`,
        user_id: job.user_id,
        generation_id: job.generation_id,
        order_number: job.order_number,
        production_status: 'ready',
        wrapbox_delivery_url: signedUrl,
        download_url: signedUrl,
        vehicle_year: String(job.vehicle_year || ''),
        vehicle_make: job.vehicle_make || '',
        vehicle_model: job.vehicle_model || '',
        generation_completed_at: new Date().toISOString(),
        download_expires_at: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
        ownership_status: 'owned',
        ownership_acquired_at: new Date().toISOString(),
        license_type: 'production',
        transferable: false,
      })
    }
    console.log(`WrapBox delivery: ${job.order_number} → design_pack_purchases`)

    // Mark generation as production-purchased + stamp Design Equity IDs
    if (job.generation_id) {
      try {
        const equityCjFinal = job.concept_json || {}
        await db.from('designiq_generations').update({
          production_purchased: true,
          production_purchased_at: new Date().toISOString(),
          ownership_status: 'owned',
          design_equity_id: equityCjFinal.designId || null,
          prompt_fingerprint: equityCjFinal.promptFingerprint || null,
        }).eq('id', job.generation_id)
      } catch { /* non-fatal — columns may not exist yet */ }
    }
  } catch (e) { console.error('WrapBox delivery failed (non-blocking):', e) }

  // Email (awaited to prevent EarlyDrop)
  try {
    await callFn(url, key, 'send-design-pack-email', {
      user_id: job.user_id, order_number: job.order_number, download_url: signedUrl,
      vehicle: `${job.vehicle_year} ${job.vehicle_make} ${job.vehicle_model}`,
      upsells_available: (job.upsells_offered || []).length > 0,
    })
    await upd(db, jid, { delivery_email_sent: true, delivered_at: new Date().toISOString() })
  } catch { /* email delivery non-critical */ }

  // ── NOTIFY CUSTOMER: Production pack ready ──
  const vehicleReady = `${job.vehicle_year || ''} ${job.vehicle_make || ''} ${job.vehicle_model || ''}`.trim()
  await notify(db, url, key, {
    user_id: job.user_id, job_id: jid,
    type: 'job_ready',
    title: `Production Pack Ready — ${job.order_number}`,
    message: `Your ${vehicleReady} print production files are ready for download. ${(job.panels || []).length} panel(s), RIP-compatible output for VersaWorks, Onyx, Caldera, Flexi, SAi, EFI Fiery.`,
    order_number: job.order_number,
    send_email: false, // Already sent via send-design-pack-email above
  })

  return ok({ status: 'ready', job_id: jid, order_number: job.order_number, download_url: signedUrl, panels: (job.panels || []).length, ms })
}

// ══════════════════════════════════════════════════════════════
// QUICK PREP MODE
// ══════════════════════════════════════════════════════════════

async function handleQuickPrep(
  body: any,
  principal: RequestPrincipal,
  db: any,
  url: string,
  key: string,
) {
  const { package_id, service_id, file_url, file_name, options } = body
  const boundUser = bindLegacyUserId(body, principal)
  if (boundUser instanceof Response) return boundUser
  const user_id = boundUser
  if (!file_url) return fail('file_url required')

  if (package_id) {
    const pkg = QUICK_PREP_PACKAGES[package_id]
    if (!pkg) return fail(`Unknown package: ${package_id}`)

    // Token gating — admin/tester roles bypass
    const isPrivileged = await checkPrivileged(db, user_id)
    if (!isPrivileged) {
      const bal = await getTokens(db, user_id)
      if (bal < pkg.tokens) return fail(`Need ${pkg.tokens} tokens, have ${bal}`)
      await spendTokens(db, user_id, pkg.tokens, `Quick Prep: ${pkg.name}`)
    }

    const { data: action } = await db.from('production_actions').insert({
      user_id, action_type: 'quick_prep', package_id: pkg.id, package_name: pkg.name,
      tokens_used: isPrivileged ? 0 : pkg.tokens, file_in: file_url, file_name: file_name || 'file',
      status: 'processing', steps_total: pkg.steps.length, steps_completed: 0, options: options || {},
      output_format: pkg.output_format, rip_compatible: pkg.rip_compatible,
    }).select().single()

    let currentUrl = file_url
    const results: any[] = []
    let failedStep: { sk: string; label: string; error: string } | null = null

    // ── Fail-fast pipeline ────────────────────────────────────────
    // Previously this loop ignored step failures and kept marching, so
    // a 4-of-9-steps run still got marked status='completed' and shipped
    // a blank/partial PDF to the customer with a misleading "Done!" UI.
    // Now: bail on first failure, mark the action as 'failed', and
    // return a clear error response naming which step + why.
    for (let i = 0; i < pkg.steps.length; i++) {
      const sk = pkg.steps[i], step = PREP_STEPS[sk]
      if (!step) continue

      if (action?.id) await db.from('production_actions').update({ steps_completed: i, current_step: step.label }).eq('id', action.id)

      const r = await callFn(url, key, step.fn, {
        action_id: action?.id, user_id, file_url: currentUrl, file_name, step_key: sk,
        options: options || {}, previous_results: results,
      })

      results.push({ step: sk, label: step.label, success: r.success, output_url: r.output_url || r.file_url, metrics: r.metrics || {}, error: r.error })

      if (!r.success) {
        failedStep = { sk, label: step.label, error: r.error || 'Step failed without an error message' }
        console.error(`[QUICK-PREP] Bailing at step ${i + 1}/${pkg.steps.length} (${step.label}): ${failedStep.error}`)
        break
      }

      if (r.output_url || r.file_url) currentUrl = r.output_url || r.file_url
    }

    const stepsCompleted = results.filter(r => r.success).length
    const beforeAfter = {
      before: { file_url, file_name },
      after: failedStep ? null : { file_url: currentUrl, output_format: pkg.output_format },
      steps_completed: stepsCompleted,
      steps_total: pkg.steps.length,
      rip_compatible: pkg.rip_compatible,
      ...(failedStep ? { failed_step: failedStep } : {}),
    }

    const finalStatus = failedStep ? 'failed' : 'completed'
    if (action?.id) await db.from('production_actions').update({
      status: finalStatus,
      file_out: failedStep ? null : currentUrl,
      steps_completed: stepsCompleted,
      before_after: beforeAfter,
      step_results: results,
      completed_at: new Date().toISOString(),
    }).eq('id', action.id)

    if (failedStep) {
      return new Response(JSON.stringify({
        success: false,
        error: `Step "${failedStep.label}" failed: ${failedStep.error}. Completed ${stepsCompleted} of ${pkg.steps.length} before bailing.`,
        failed_step: failedStep,
        steps_completed: stepsCompleted,
        steps_total: pkg.steps.length,
        step_results: results,
        before_after: beforeAfter,
        action_id: action?.id,
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return ok({
      action_id: action?.id, package: pkg.name, tokens_used: pkg.tokens,
      estimated_time_saved: `${pkg.estimated_time_saved_min} minutes`,
      designer_cost_equivalent: `$${Math.round(pkg.estimated_time_saved_min * 0.58)}`,
      before_after: beforeAfter, download_url: currentUrl, step_results: results,
      rip_compatible: pkg.rip_compatible,
      convert_to_pack: { available: true, message: 'Convert to full Production Pack with approval tracking' },
    })
  }

  if (service_id) {
    const step = PREP_STEPS[service_id]
    if (!step) return fail(`Unknown service: ${service_id}`)
    // Token gating — admin/tester roles bypass
    const isPrivSvc = await checkPrivileged(db, user_id)
    if (!isPrivSvc) {
      const bal = await getTokens(db, user_id)
      if (bal < step.tokens) return fail(`Need ${step.tokens} tokens, have ${bal}`)
      await spendTokens(db, user_id, step.tokens, `Quick Prep: ${step.label}`)
    }
    const r = await callFn(url, key, step.fn, { user_id, file_url, file_name, step_key: service_id, options: options || {} })
    await db.from('production_actions').insert({
      user_id, action_type: 'quick_prep_single', service_id, package_name: step.label,
      tokens_used: isPrivSvc ? 0 : step.tokens, file_in: file_url, file_out: r.output_url || r.file_url, file_name,
      status: r.success ? 'completed' : 'failed', steps_total: 1, steps_completed: r.success ? 1 : 0,
      completed_at: r.success ? new Date().toISOString() : null,
      metrics: r.metrics || {},
    })
    return ok({ service: step.label, tokens_used: isPrivSvc ? 0 : step.tokens, success: r.success, output_url: r.output_url, metrics: r.metrics })
  }

  return fail('package_id or service_id required')
}

// ══════════════════════════════════════════════════════════════
// FILE ANALYSIS — Walk-in diagnosis
// ══════════════════════════════════════════════════════════════

async function handleAnalyze(body: any, _db: any, _url: string, _key: string) {
  const { file_url } = body
  if (!file_url) return fail('file_url required')

  // Detect file type from URL extension. Gemini's vision endpoint accepts
  // image/jpeg, image/png, image/webp, image/heic, image/heif. For
  // PDF/AI/EPS/SVG vector files Gemini can't ingest them directly — we
  // skip the AI analysis and return a vector-file fallback recommendation
  // so the page still loads and shows tools instead of "Analysis Failed".
  const lowerUrl = file_url.toLowerCase().split('?')[0]
  const ext = (lowerUrl.match(/\.([a-z0-9]+)$/)?.[1] || '').toLowerCase()
  const IMAGE_MIME: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
    gif: 'image/png', // Gemini doesn't list gif but png mime works for animated→still analysis
    bmp: 'image/png',
    tiff: 'image/png',
    tif: 'image/png',
  }
  const mimeType = IMAGE_MIME[ext]
  const isVectorOrPdf = ['pdf', 'ai', 'eps', 'svg'].includes(ext)

  if (isVectorOrPdf) {
    // Vector / PDF file — Gemini can't analyze directly. Return a sane
    // default so the upload zone shows recommendations instead of failing.
    const rec = QUICK_PREP_PACKAGES['pro_cut_prep'] || QUICK_PREP_PACKAGES['basic_cut_prep']
    return ok({
      analysis: {
        file_type: ext === 'pdf' ? 'pdf' : 'vector',
        estimated_resolution_px: null,
        has_transparency: ext === 'svg' || ext === 'pdf',
        has_cut_path: ext === 'svg',
        color_space: 'unknown',
        has_bleed: false,
        has_spot_colors: false,
        content_type: 'mixed',
        quality_score: 90,
      },
      issues: [{
        issue: 'Vector source detected',
        severity: 'info',
        description: `${ext.toUpperCase()} files are already production-grade. Use VectorizeIt only if you need to re-trace, or run Cut Contour Logo Pack directly to extract cut paths.`,
      }],
      summary: `${ext.toUpperCase()} vector file. Skip analysis — go straight to Cut Contour Logo Pack or any individual tool below.`,
      recommendation: rec ? {
        package_id: rec.id, package_name: rec.name, tokens: rec.tokens, description: rec.description,
        estimated_time_saved: `${rec.estimated_time_saved_min} min`,
        designer_cost_equivalent: `$${Math.round(rec.estimated_time_saved_min * 0.58)}`,
        steps: rec.steps.map((s: string) => PREP_STEPS[s]?.label || s),
        output_format: rec.output_format, rip_compatible: rec.rip_compatible,
      } : null,
      all_packages: Object.values(QUICK_PREP_PACKAGES).map((p: any) => ({ id: p.id, name: p.name, tokens: p.tokens, time_saved: `${p.estimated_time_saved_min} min` })),
    })
  }

  if (!mimeType) return fail(`Unsupported file type: .${ext}. Supported: PNG, JPG, JPEG, WEBP, HEIC, TIFF, PDF, AI, EPS, SVG.`)

  const gk = Deno.env.get('GOOGLE_AI_API_KEY')
  if (!gk) return fail('Analysis engine not configured')

  try {
    const imgRes = await fetch(file_url)
    if (!imgRes.ok) return fail(`Cannot fetch file: ${imgRes.status}`)
    const buf = await imgRes.arrayBuffer()
    // Chunked base64 conversion — spread operator crashes on large images (>100KB)
    const bytes = new Uint8Array(buf)
    let binary = ''
    const chunkSize = 8192
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
      binary += String.fromCharCode.apply(null, Array.from(chunk))
    }
    const b64 = btoa(binary)

    const prompt = `You are a vehicle wrap production specialist. Analyze this file for print readiness.
Respond ONLY with valid JSON:
{
  "file_analysis": {
    "file_type": "raster|vector|pdf|unknown",
    "estimated_resolution_px": 0,
    "has_transparency": false,
    "has_cut_path": false,
    "color_space": "RGB|CMYK|unknown",
    "has_bleed": false,
    "has_spot_colors": false,
    "content_type": "logo|photo|illustration|text|mixed",
    "quality_score": 0
  },
  "issues_found": [{"issue":"","severity":"critical|warning|info","description":""}],
  "recommended_package": "basic_cut_prep|pro_cut_prep|advanced_output_prep",
  "estimated_designer_time_min": 0,
  "summary": ""
}`

    const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${gk}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ inlineData: { mimeType, data: b64 } }, { text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 2048 } }),
    })

    if (!gRes.ok) {
      const errBody = await gRes.text().catch(() => '')
      console.error(`[ANALYZE] Gemini ${gRes.status}:`, errBody.slice(0, 400))
      return fail(`Analysis API ${gRes.status}: ${errBody.slice(0, 200) || 'unavailable'}`)
    }
    const gData = await gRes.json()
    const raw = gData?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const clean = raw.replace(/```json\s*|```\s*/g, '').trim()
    const analysis = JSON.parse(clean)

    const rec = QUICK_PREP_PACKAGES[analysis.recommended_package]
    return ok({
      analysis: analysis.file_analysis, issues: analysis.issues_found, summary: analysis.summary,
      recommendation: rec ? {
        package_id: rec.id, package_name: rec.name, tokens: rec.tokens, description: rec.description,
        estimated_time_saved: `${analysis.estimated_designer_time_min || rec.estimated_time_saved_min} min`,
        designer_cost_equivalent: `$${Math.round((analysis.estimated_designer_time_min || rec.estimated_time_saved_min) * 0.58)}`,
        steps: rec.steps.map((s: string) => PREP_STEPS[s]?.label || s),
        output_format: rec.output_format, rip_compatible: rec.rip_compatible,
      } : null,
      all_packages: Object.values(QUICK_PREP_PACKAGES).map((p: any) => ({ id: p.id, name: p.name, tokens: p.tokens, time_saved: `${p.estimated_time_saved_min} min` })),
    })
  } catch (e) { return fail(`Analysis failed: ${String(e)}`) }
}

// ══════════════════════════════════════════════════════════════
// STANDALONE SERVICE MODE — Token-gated individual tool runs
// ══════════════════════════════════════════════════════════════

// Replicate-backed services need a much longer fetch timeout than the
// 50s callFn default. BiRefNet (bg removal) alone can take 60–90s on a
// cold start, then cut-map adds boundary trace + 3 SVG uploads on top.
const STANDALONE_SERVICES: Record<string, { fn: string; label: string; tokens: number; output_format: string; rip_compatible: string[]; description: string; timeout_ms?: number }> = {
  cut_map: {
    fn: 'cut-map', label: 'CutMap™', tokens: 3,
    output_format: 'SVG cut file + PNG overlay with CutContour spot color (#FF00FF)',
    rip_compatible: ['VersaWorks', 'Onyx', 'Caldera', 'Flexi', 'SAi', 'EFI Fiery'],
    description: 'Generate precise cut maps and panel layouts instantly. Maps your design to exact material width and panel sizes — eliminating waste, reducing install time, removing guesswork.',
    timeout_ms: 180_000,
  },
  file_revitalizer: {
    fn: 'file-revitalizer', label: 'FileRevitalizer™', tokens: 3,
    output_format: 'PNG (AI upscaled + sharpened for print DPI)',
    rip_compatible: ['VersaWorks', 'Onyx', 'Caldera', 'Flexi', 'SAi', 'EFI Fiery'],
    description: 'Rescue low-quality files and make them print-worthy. Upscales, sharpens, and enhances images so you can save the job instead of sending the customer back to their designer.',
    timeout_ms: 180_000,
  },
  vectorize_it: {
    fn: 'vectorize-it', label: 'VectorizeIt™', tokens: 4,
    output_format: 'Production-grade SVG (scalable vector)',
    rip_compatible: ['VersaWorks', 'Onyx', 'Caldera', 'Flexi', 'SAi', 'EFI Fiery', 'Illustrator', 'CorelDRAW', 'SignCut'],
    description: 'Turn raster images into clean, scalable vector files on demand. Converts logos, graphics, and artwork into production-grade vectors — no more tracing by hand.',
  },
  bg_remove: {
    fn: 'quick-prep-bg-remove', label: 'Background Removal', tokens: 2,
    output_format: 'PNG (transparent alpha channel)',
    rip_compatible: ['VersaWorks', 'Onyx', 'Caldera', 'Flexi', 'SAi', 'EFI Fiery'],
    description: 'Remove background for transparent output. Essential first step before contour cut prep.',
    timeout_ms: 150_000,
  },
  layer_split: {
    fn: 'layer-split', label: 'Layer Split™', tokens: 4,
    output_format: 'Subject PNG (transparent) + Background PNG (subject erased & filled)',
    rip_compatible: ['Illustrator', 'Photoshop', 'CorelDRAW', 'VersaWorks', 'Onyx', 'Caldera', 'Flexi', 'SAi'],
    description: 'Separate subject from background — get the logo / element as a transparent PNG AND the wrap art behind it as a clean plate (subject erased, AI-filled). Drop a new logo on the same wrap art instantly.',
    timeout_ms: 240_000,
  },
  cmyk_convert: {
    fn: 'quick-prep-color-sep', label: 'CMYK Conversion', tokens: 2,
    output_format: 'PNG (CMYK color-corrected, 300% ink limit)',
    rip_compatible: ['VersaWorks', 'Onyx', 'EFI Fiery', 'Caldera'],
    description: 'Convert RGB to CMYK color space with ink limiting for accurate print color on wide-format printers.',
  },
  upscale_4x: {
    fn: 'quick-prep-upscale', label: 'AI Upscale (4x)', tokens: 3,
    output_format: 'PNG (4x resolution via Real-ESRGAN)',
    rip_compatible: ['VersaWorks', 'Onyx', 'Caldera', 'Flexi', 'SAi', 'EFI Fiery'],
    description: 'AI-powered 4x resolution boost via Real-ESRGAN neural network. For maximum print quality on large-format output.',
  },
}

async function handleStandaloneService(
  body: any,
  principal: RequestPrincipal,
  db: any,
  url: string,
  key: string,
) {
  const {
    service_id, file_url, file_name, options,
    job_id: providedJobId,
    // Optional render context — when a tool sends a customer to ProductionFlow
    // with vehicle/design metadata (e.g. ColorPro → "Generate Cut Contour Logo
    // Pack"), populate the auto-created panelizer_job so WrapBox shows a real
    // vehicle/design row instead of a barebones MP-XXXXXX entry.
    render_context: renderCtx,
  } = body
  const boundUser = bindLegacyUserId(body, principal)
  if (boundUser instanceof Response) return boundUser
  const user_id = boundUser
  if (!file_url) return fail('file_url required')
  if (!service_id) return fail('service_id required')

  const svc = STANDALONE_SERVICES[service_id]
  if (!svc) return fail(`Unknown service: ${service_id}. Available: ${Object.keys(STANDALONE_SERVICES).join(', ')}`)

  // Validate an attached job before charging or invoking a tool. The attached
  // row, not the browser-supplied user/job pairing, owns the association.
  let ownedProvidedJob: any = null
  if (providedJobId) {
    const { data: existing, error: existingError } = await db
      .from('panelizer_jobs')
      .select('id, user_id, order_number')
      .eq('id', providedJobId)
      .maybeSingle()
    if (existingError) {
      return designproJson({ error: existingError.message }, 503)
    }
    if (!existing || String(existing.user_id || '') !== user_id) {
      return designproJson({ error: 'Job not found' }, 404)
    }
    ownedProvidedJob = existing
  }

  // Token gating — admin/tester roles bypass
  const isPrivileged = await checkPrivileged(db, user_id)
  if (!isPrivileged) {
    const bal = await getTokens(db, user_id)
    if (bal < svc.tokens) return fail(`Need ${svc.tokens} tokens, have ${bal}. Purchase more tokens to continue.`)
    await spendTokens(db, user_id, svc.tokens, `${svc.label}: ${file_name || 'file'}`)
  }

  // Resolve a panelizer_job to attach this output to. WrapBox renders files
  // grouped by panelizer_jobs.order_number (joined to production_actions
  // via job_id). If the caller didn't pass a job_id, auto-create a manual
  // prep job with an MP-XXXXXX order number derived from its uuid.
  let jobId: string | null = providedJobId || null
  let orderNumber: string | null = null
  if (jobId) {
    jobId = String(ownedProvidedJob.id)
    if (ownedProvidedJob.order_number) {
      orderNumber = String(ownedProvidedJob.order_number)
    }
  } else {
    const { data: shopRow } = await db.from('shop_profiles').select('id').eq('user_id', user_id).maybeSingle()
    const insertPayload: Record<string, any> = {
      user_id,
      job_type: 'manual_prep',
      status: 'ready',
      shop_id: shopRow?.id || null,
    }
    if (renderCtx) {
      if (renderCtx.vehicle_year) insertPayload.vehicle_year = Number(renderCtx.vehicle_year) || null
      if (renderCtx.vehicle_make) insertPayload.vehicle_make = String(renderCtx.vehicle_make)
      if (renderCtx.vehicle_model) insertPayload.vehicle_model = String(renderCtx.vehicle_model)
      if (renderCtx.approved_render_url) insertPayload.approved_render_url = String(renderCtx.approved_render_url)
      const conceptExtras: Record<string, any> = {}
      if (renderCtx.design_name) conceptExtras.design_name = String(renderCtx.design_name)
      if (renderCtx.tool_source) conceptExtras.source_type = String(renderCtx.tool_source)
      if (Object.keys(conceptExtras).length > 0) insertPayload.concept_json = conceptExtras
    }
    const { data: newJob, error: jobErr } = await db.from('panelizer_jobs').insert(insertPayload).select('id').single()
    if (jobErr || !newJob?.id) {
      console.error('[STANDALONE] failed to create manual_prep job:', jobErr)
    } else {
      jobId = newJob.id
      orderNumber = `MP-${newJob.id.slice(0, 6).toUpperCase()}`
      await db.from('panelizer_jobs').update({ order_number: orderNumber }).eq('id', newJob.id)
    }
  }

  // Create tracking record
  const { data: action } = await db.from('production_actions').insert({
    user_id,
    action_type: 'standalone_service',
    service_id,
    package_name: svc.label,
    tokens_used: isPrivileged ? 0 : svc.tokens,
    file_in: file_url,
    file_name: file_name || 'file',
    status: 'processing',
    steps_total: 1,
    steps_completed: 0,
    output_format: svc.output_format,
    rip_compatible: svc.rip_compatible,
    options: options || {},
    job_id: jobId,
  }).select().single()

  // Call the service. Forward order_number so the function saves to
  // production-packs/{user}/{order#} where WrapBox reads.
  const r = await callFn(url, key, svc.fn, {
    user_id,
    file_url,
    file_name,
    order_number: orderNumber,
    job_id: jobId,
    ...(options || {}),
  }, svc.timeout_ms)

  // Update tracking record
  const outputUrl = r.output_url || r.file_url || r.svg_url || null
  if (action?.id) {
    await db.from('production_actions').update({
      status: r.success ? 'completed' : 'failed',
      file_out: outputUrl,
      steps_completed: r.success ? 1 : 0,
      completed_at: r.success ? new Date().toISOString() : null,
      metrics: {
        processing_ms: r.processing_ms,
        contour_points: r.contour_points,
        improvement: r.improvement,
        vector_stats: r.vector_stats,
        pixels_removed: r.pixels_removed,
        percentage_removed: r.percentage_removed,
        upscaled: r.upscaled,
        storage_path: r.storage_path,
        ...(r.metrics || {}),
      },
    }).eq('id', action.id)
  }

  return ok({
    action_id: action?.id,
    job_id: jobId,
    order_number: orderNumber,
    service: svc.label,
    service_id,
    tokens_used: svc.tokens,
    description: svc.description,
    output_format: svc.output_format,
    rip_compatible: svc.rip_compatible,
    ...r,
  })
}

// ══════════════════════════════════════════════════════════════
// OUTPUT HISTORY — Fetch past production actions for a user
// ══════════════════════════════════════════════════════════════

async function handleGetHistory(
  body: any,
  principal: RequestPrincipal,
  db: any,
) {
  const { limit: histLimit, offset: histOffset } = body
  const boundUser = bindLegacyUserId(body, principal)
  if (boundUser instanceof Response) return boundUser
  const user_id = boundUser

  const { data: actions, error } = await db
    .from('production_actions')
    .select('*')
    .eq('user_id', user_id)
    .order('created_at', { ascending: false })
    .range(histOffset || 0, (histOffset || 0) + (histLimit || 20) - 1)

  if (error) return fail(`History fetch failed: ${error.message}`)

  // Get token balance + privileged status
  const bal = await getTokens(db, user_id)
  const privileged = await checkPrivileged(db, user_id)

  return ok({
    actions: actions || [],
    total: actions?.length || 0,
    token_balance: bal,
    is_privileged: privileged,
  })
}

// ══════════════════════════════════════════════════════════════
// NOTIFICATIONS — Fetch + Mark Read
// ══════════════════════════════════════════════════════════════

async function handleGetNotifications(
  body: any,
  principal: RequestPrincipal,
  db: any,
) {
  const { unread_only } = body
  const boundUser = bindLegacyUserId(body, principal)
  if (boundUser instanceof Response) return boundUser
  const user_id = boundUser

  let query = db
    .from('production_notifications')
    .select('*')
    .eq('user_id', user_id)
    .order('created_at', { ascending: false })
    .limit(30)

  if (unread_only) {
    query = query.eq('read', false)
  }

  const { data: notifications, error } = await query
  if (error) return fail(`Notifications fetch failed: ${error.message}`)

  // Unread count
  const { count } = await db
    .from('production_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user_id)
    .eq('read', false)

  return ok({ notifications: notifications || [], unread_count: count || 0 })
}

async function handleMarkRead(
  body: any,
  principal: RequestPrincipal,
  db: any,
) {
  const { notification_id, mark_all } = body
  const boundUser = bindLegacyUserId(body, principal)
  if (boundUser instanceof Response) return boundUser
  const user_id = boundUser

  if (mark_all) {
    await db.from('production_notifications').update({ read: true }).eq('user_id', user_id).eq('read', false)
    return ok({ marked: 'all' })
  }

  if (notification_id) {
    await db.from('production_notifications').update({ read: true }).eq('id', notification_id).eq('user_id', user_id)
    return ok({ marked: notification_id })
  }

  return fail('notification_id or mark_all required')
}

// ══════════════════════════════════════════════════════════════
// UPSELL BUILDERS
// ══════════════════════════════════════════════════════════════

function buildProjectUpsells(elements: any[], job: any): any[] {
  const offers: any[] = []
  const logos = elements.filter((e: any) => e.type === 'logo' || e.type === 'text').length
  if (logos > 0) offers.push({ type: 'cut_contour_pack', label: 'Cut Contour Logo Pack', description: `${logos} element${logos > 1 ? 's' : ''} — cut-ready contour files`, price: 49, tokens: 8, rip_compatible: ['VersaWorks', 'Onyx', 'Caldera', 'Flexi', 'SAi'] })
  offers.push({ type: 'window_perf', label: 'Rear Window Perf Design', description: 'AI-matched rear window perforated vinyl', price: 39, tokens: 6 })
  offers.push({ type: 'magnetic_panels', label: 'Magnetic Door Panels', description: 'Same design for removable magnetics', price: 29, tokens: 5 })
  if (job.vehicle_make) offers.push({ type: 'fleet_numbering', label: 'Fleet Numbering', description: 'Individual truck/unit numbers', price: 19, tokens: 3 })
  return offers
}

function buildQuickPrepUpsells(elements: any[]): any[] {
  if (elements.some((e: any) => e.type === 'logo')) {
    return [{ type: 'quick_prep_pro_cut', label: 'Pro Cut Prep for Logos', description: 'Vector + contour + production PDF for extracted logos', tokens: 8, package_id: 'pro_cut_prep', category: 'quick_prep' }]
  }
  return []
}

// ══════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════

async function callFn(url: string, key: string, fn: string, body: any, timeoutMs = 50000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const r = await fetch(`${url}/functions/v1/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` }, body: JSON.stringify(body), signal: controller.signal })
    if (!r.ok) {
      const responseText = await r.text()
      let responseBody: Record<string, any> = {}
      try {
        const parsed = JSON.parse(responseText)
        if (parsed && typeof parsed === 'object') responseBody = parsed
      } catch { /* retain the plain-text error below */ }
      return {
        ...responseBody,
        success: false,
        httpStatus: r.status,
        error: String(responseBody.error || `${fn} ${r.status}: ${responseText}`),
      }
    }
    return await r.json()
  } catch (e) {
    const msg = String(e)
    if (msg.includes('abort') || msg.includes('Abort')) {
      console.warn(`[callFn] ${fn} timed out after ${timeoutMs}ms`)
      return { success: false, error: `${fn}: timed out after ${Math.round(timeoutMs / 1000)}s` }
    }
    return { success: false, error: `${fn}: ${msg}` }
  } finally { clearTimeout(timer) }
}

async function selfInvoke(url: string, key: string, body: any, db?: any) {
  // Self-invocation to run the next pipeline step.
  // 3 retries with 2-second delay. If all fail, mark job as failed
  // so it does not stay stuck in panelizing forever.
  const MAX_RETRIES = 3
  const RETRY_DELAY_MS = 2000

  const attempt = async (attemptNum: number) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12000)
    try {
      await fetch(`${url}/functions/v1/run-production-flow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      console.log(`[SELF-INVOKE] job=${body.job_id} → request accepted (attempt ${attemptNum})`)
      return true
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // Expected — request was already sent and accepted by server
        console.log(`[SELF-INVOKE] job=${body.job_id} → fire-and-forget timeout (attempt ${attemptNum})`)
        return true
      }
      // Real network error — DNS failure, connection refused, etc.
      console.error(`[SELF-INVOKE] job=${body.job_id} → REAL ERROR (attempt ${attemptNum}/${MAX_RETRIES}): ${err?.message || err}`)
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  for (let i = 1; i <= MAX_RETRIES; i++) {
    const success = await attempt(i)
    if (success) return
    if (i < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
    }
  }

  // All retries exhausted — mark job as failed so it doesn't stall forever
  console.error(`[SELF-INVOKE] job=${body.job_id} → ALL ${MAX_RETRIES} RETRIES FAILED — marking job as failed`)
  if (db && body.job_id) {
    await upd(db, body.job_id, {
      status: 'failed',
      error_message: 'self-invoke failed after 3 retries',
      error_stage: 'self-invoke',
    })
    await evt(db, body.job_id, 'error', 'self-invoke', { error: 'self-invoke failed after 3 retries', retries: MAX_RETRIES })
  }
}

async function upd(db: any, id: string, u: any): Promise<boolean> {
  const { error } = await db.from('panelizer_jobs').update(u).eq('id', id)
  if (error) {
    const fields = Object.keys(u).join(', ')
    console.error(`[UPD FAIL] job=${id} fields=[${fields}] code=${error.code} msg=${error.message} details=${error.details}`)
    return false
  }
  return true
}
async function evt(db: any, jid: string, type: string, stage: string | null, data: any = {}) { await db.from('panelizer_job_events').insert({ job_id: jid, event_type: type, stage, data }) }
async function checkPrivileged(db: any, uid: string) { const { data } = await db.from('user_roles').select('role').eq('user_id', uid).in('role', ['admin', 'tester']).maybeSingle(); return !!data }
async function getTokens(db: any, uid: string) { const { data } = await db.from('user_tokens').select('balance').eq('user_id', uid).single(); return data?.balance || 0 }
async function spendTokens(db: any, uid: string, amt: number, reason: string) {
  try {
    await db.rpc('deduct_user_tokens', { p_user_id: uid, p_amount: amt, p_reason: reason })
  } catch {
    try { await db.from('user_tokens').update({ balance: db.raw(`balance - ${amt}`) }).eq('user_id', uid) } catch {}
  }
}

// ── NOTIFICATION SYSTEM ──────────────────────────────────────
// Writes to production_notifications table + optionally sends email via send-templated-email

async function notify(db: any, url: string, key: string, opts: {
  user_id: string; job_id: string; type: string; title: string; message: string;
  order_number?: string; send_email?: boolean; email_template?: string; email_data?: Record<string, string>;
}) {
  // Write in-app notification
  const actionUrl = `/productionflow/${opts.job_id}`
  let notif: any = null
  try {
    const { data } = await db.from('production_notifications').insert({
      user_id: opts.user_id,
      job_id: opts.job_id,
      type: opts.type,
      title: opts.title,
      message: opts.message,
      action_url: actionUrl,
      read: false,
      email_sent: false,
    }).select('id').single()
    notif = data
  } catch { /* table may not exist yet — non-fatal */ }

  console.log(`[NOTIFY] ${opts.type} → user ${opts.user_id}: ${opts.title}`)

  // Send email (awaited to prevent EarlyDrop)
  if (opts.send_email && opts.email_template) {
    try {
      const r = await callFn(url, key, 'send-templated-email', {
        templateSlug: opts.email_template,
        to: await getUserEmail(db, opts.user_id),
        mergeData: {
          order_number: opts.order_number || '',
          job_url: `https://restylepro.com${actionUrl}`,
          ...(opts.email_data || {}),
        },
      })
      if (notif?.id && r?.messageId) {
        await db.from('production_notifications').update({ email_sent: true, email_id: r.messageId }).eq('id', notif.id)
      }
    } catch (e: any) { console.warn('[NOTIFY] Email failed:', e) }
  }
}

async function getUserEmail(db: any, uid: string): Promise<string> {
  // Try auth.users via service role
  try {
    const { data } = await db.auth.admin.getUserById(uid)
    if (data?.user?.email) return data.user.email
  } catch {}
  // Fallback: check profiles table
  try {
    const { data } = await db.from('profiles').select('email').eq('id', uid).single()
    if (data?.email) return data.email
  } catch {}
  return ''
}

function ok(d: any) { return new Response(JSON.stringify({ success: true, ...d }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
function fail(m: string) { return new Response(JSON.stringify({ success: false, error: m }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
