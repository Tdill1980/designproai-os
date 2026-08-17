/**
 * activate-print-worker — buy-triggered production activation.
 *
 * THE UNIFIED BUY PATH. When a customer buys print files, this fires the
 * deterministic Railway print worker on the SAME per-side panels Build Assets
 * already produced (production_flow_assets — the pre-panels Revision Studio shows
 * to entice the buyer). It does NOT re-slice: the extraction is deterministic and
 * already done. Per side it:
 *   1. Resolves only the paid job's exact immutable Entice Pack vault.
 *   2. Kicks the Railway worker /process-panel (pg_net, fire-and-forget) →
 *      native crisp upscale + 5" mirror bleed → 1500-DPI CMYK TIFF + PNG in
 *      production-packs/{userId}/{order}/runs/{runKey}/
 *      {panelKey}_{w}x{h}_1500dpi_CMYK.tiff.
 *   3. Runs golden-job-regression (validate, non-fatal) and stamps the summary.
 *   4. Lands the panelizer_job at status='pending_qc' — ADMIN-READY, gated. The
 *      admin verifies + clicks Send to WrapBox (deploy-to-wrapbox); nothing ships
 *      to the customer's WrapBox automatically.
 *
 * Retires the failing Vercel process-production-pack re-slicer ("bad extract
 * area") as the buy producer. If NO vault exists (design bought without Build
 * Assets ever running), it returns { activated:0, needsBuild:true } so the caller
 * can fall back — it never silently no-ops.
 *
 * Durable body: { productionJobId, workflowRunId, jobId, generationId, userId,
 *   orderNumber, revisionId, enticePackId, dimensionManifestId,
 *   sourceContractHash, manifestHash, packIdentityHash, packVersion,
 *   sourceHash, sourceProofUrl, expectedSides, vaultJobId, fingerprints }.
 * Every paid dispatch is bound to that exact immutable revision pack. This
 * endpoint does not alter unrelated legacy worker/package endpoints.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// production_flow_assets.side → Railway worker panelKey (matches VIEW_DEFS.sideKey).
const SIDE_TO_KEY: Record<string, string> = {
  "DRIVER SIDE": "driver_side",
  "PASSENGER SIDE": "passenger_side",
  HOOD: "hood",
  ROOF: "roof",
  FRONT: "front",
  REAR: "rear",
};
const SUPPORTED_SIDES = new Set(Object.keys(SIDE_TO_KEY));
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const jsonObject = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
const canonicalize = (value: any): any => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
};
const sha256 = async (value: unknown): Promise<string> => {
  const encoded = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoded));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
};
const positiveDimension = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};
const sameDimension = (left: unknown, right: unknown): boolean =>
  positiveDimension(left) > 0 &&
  positiveDimension(right) > 0 &&
  Math.abs(Number(left) - Number(right)) <= 0.01;
const dimensionsFrom = (value: unknown): { w: number; h: number } | null => {
  const dimensions = jsonObject(value);
  let w = positiveDimension(dimensions.w ?? dimensions.width);
  let h = positiveDimension(dimensions.h ?? dimensions.height);
  if ((!w || !h) && typeof value === "string") {
    const match = value.match(/([\d.]+)\s*[x×]\s*([\d.]+)/i);
    if (match) {
      w = positiveDimension(match[1]);
      h = positiveDimension(match[2]);
    }
  }
  return w && h ? { w, h } : null;
};
const normalizeSurfaceManifest = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const sides = value.map((side) =>
    String(side || "")
      .trim()
      .toUpperCase(),
  );
  if (
    sides.length < 2 ||
    sides.some((side) => !SUPPORTED_SIDES.has(side)) ||
    new Set(sides).size !== sides.length ||
    !sides.includes("DRIVER SIDE") ||
    !sides.includes("PASSENGER SIDE")
  ) {
    return null;
  }
  return Object.keys(SIDE_TO_KEY).filter((side) => sides.includes(side));
};
const sameSideSet = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  const right = new Set(b);
  return (
    new Set(a).size === a.length &&
    right.size === b.length &&
    a.every((side) => right.has(side))
  );
};
type FrozenFingerprint = {
  sha256: string;
  bytes: number;
  contentType: string;
};
const normalizeFingerprints = (
  value: unknown,
): Record<string, FrozenFingerprint> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return null;
  const normalized: Record<string, FrozenFingerprint> = {};
  for (const [key, raw] of entries) {
    if (!key || !raw || typeof raw !== "object" || Array.isArray(raw))
      return null;
    const fingerprint = raw as Record<string, unknown>;
    const sha256 = String(fingerprint.sha256 || "").toLowerCase();
    const bytes = Number(fingerprint.bytes || 0);
    if (
      !/^[a-f0-9]{64}$/.test(sha256) ||
      !Number.isSafeInteger(bytes) ||
      bytes <= 0
    ) {
      return null;
    }
    normalized[key] = {
      sha256,
      bytes,
      contentType: String(fingerprint.contentType || ""),
    };
  }
  return Object.fromEntries(
    Object.entries(normalized).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
};
const sameFingerprints = (
  left: Record<string, FrozenFingerprint>,
  right: Record<string, FrozenFingerprint>,
) => {
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        !!right[key] &&
        left[key].sha256 === right[key].sha256 &&
        left[key].bytes === right[key].bytes,
    )
  );
};
type RevisionPackPins = {
  revisionId: string;
  enticePackId: string;
  dimensionManifestId: string;
  sourceContractHash: string;
  manifestHash: string;
  packIdentityHash: string;
  packVersion: string;
};
const pinValue = (
  value: unknown,
  snakeKey: string,
  camelKey: string,
): string => {
  const object = jsonObject(value);
  return String(object[snakeKey] ?? object[camelKey] ?? "");
};
const exactPinsMatch = (
  value: unknown,
  pins: RevisionPackPins,
  includePackHashes = true,
): boolean =>
  pinValue(value, "revision_id", "revisionId") === pins.revisionId &&
  pinValue(value, "entice_pack_id", "enticePackId") === pins.enticePackId &&
  pinValue(value, "dimension_manifest_id", "dimensionManifestId") ===
    pins.dimensionManifestId &&
  pinValue(
    value,
    "source_contract_hash",
    "sourceContractHash",
  ).toLowerCase() === pins.sourceContractHash &&
  (!includePackHashes ||
    (pinValue(value, "manifest_hash", "manifestHash").toLowerCase() ===
      pins.manifestHash &&
      pinValue(
        value,
        "pack_identity_hash",
        "packIdentityHash",
      ).toLowerCase() === pins.packIdentityHash &&
      pinValue(value, "pack_version", "packVersion").toLowerCase() ===
        pins.packVersion));
const fingerprintMatches = (
  expected: unknown,
  observed: FrozenFingerprint | undefined,
): boolean => {
  const value = jsonObject(expected);
  return (
    !!observed &&
    SHA256_PATTERN.test(String(value.sha256 || "").toLowerCase()) &&
    String(value.sha256 || "").toLowerCase() === observed.sha256 &&
    Number(value.bytes || 0) === observed.bytes
  );
};
const storageObjectFromUrl = (
  raw: unknown,
): { bucket: string; path: string } | null => {
  try {
    const parsed = new URL(String(raw || ""));
    const match = parsed.pathname.match(
      /\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/,
    );
    if (!match) return null;
    const bucket = decodeURIComponent(match[1]);
    const path = decodeURIComponent(match[2]);
    if (
      !["wrap-files", "extracted-elements"].includes(bucket) ||
      !path ||
      path.includes("..")
    ) {
      return null;
    }
    return { bucket, path };
  } catch {
    return null;
  }
};
const matchesRun = (
  value: any,
  sourceHash: string,
  packVersion: string,
  runKey: string,
  activationIdentityHash: string,
) =>
  !!value &&
  String(value.source_hash || "") === sourceHash &&
  String(value.pack_version || "") === packVersion &&
  String(value.run_key || "") === runKey &&
  (!activationIdentityHash ||
    String(value.activation_identity_hash || "") === activationIdentityHash);

serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const {
      jobId: requestedJobIdRaw,
      productionJobId: requestedProductionJobIdRaw,
      workflowRunId: requestedWorkflowRunIdRaw,
      generationId: requestedGenerationIdRaw,
      userId: requestedUserIdRaw,
      orderNumber: requestedOrderNumberRaw,
      sourceHash: requestedSourceHashRaw,
      packVersion: requestedPackVersionRaw,
      sourceProofUrl: requestedSourceProofUrlRaw,
      expectedSides: requestedExpectedSidesRaw,
      vaultJobId: requestedVaultJobIdRaw,
      revisionId: requestedRevisionIdRaw,
      enticePackId: requestedEnticePackIdRaw,
      dimensionManifestId: requestedDimensionManifestIdRaw,
      sourceContractHash: requestedSourceContractHashRaw,
      manifestHash: requestedManifestHashRaw,
      packIdentityHash: requestedPackIdentityHashRaw,
      fingerprints: requestedFingerprintsRaw,
    } = await req.json();
    const productionJobId = String(requestedProductionJobIdRaw || "");
    const workflowRunId = String(requestedWorkflowRunIdRaw || "");
    if (!productionJobId || !workflowRunId) {
      return json(
        {
          success: false,
          error: "Missing workflowRunId or productionJobId",
        },
        400,
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceKey);
    const bearer = (req.headers.get("authorization") || "").replace(
      /^Bearer\s+/i,
      "",
    );
    if (!bearer || bearer !== serviceKey) {
      return json(
        { success: false, error: "Service authorization required" },
        bearer ? 403 : 401,
      );
    }

    // The paid domain job is the authority for tenant, owner, generation,
    // panelizer job and storage folder. Caller copies are compatibility checks
    // only; they are never used to choose tenant-scoped assets or output paths.
    const { data: durableJob, error: durableReadError } = await db
      .from("designpro_production_jobs")
      .select(
        "id,panelizer_job_id,generation_id,user_id,order_number,state,result,revision_id,entice_pack_id,dimension_manifest_id,source_contract_hash,updated_at",
      )
      .eq("id", productionJobId)
      .maybeSingle();
    const durableResult =
      (durableJob as any)?.result &&
      typeof (durableJob as any).result === "object"
        ? (durableJob as any).result
        : {};
    if (
      durableReadError ||
      !durableJob ||
      !["activating_worker", "worker_queued"].includes(
        String((durableJob as any).state || ""),
      ) ||
      String(durableResult.workflowRunId || "") !== workflowRunId
    ) {
      return json(
        {
          success: false,
          error:
            durableReadError?.message ||
            "Durable production job is unavailable or not activation-ready",
        },
        409,
      );
    }

    const jobId = String((durableJob as any).panelizer_job_id || "");
    const generationId = String((durableJob as any).generation_id || "");
    const userId = String((durableJob as any).user_id || "");
    if (!jobId || !generationId || !userId) {
      return json(
        {
          success: false,
          error: "Durable production job has no authoritative owner or source",
        },
        409,
      );
    }
    const { data: panelizerJob, error: panelizerReadError } = await db
      .from("panelizer_jobs")
      .select("id,user_id,shop_id,generation_id,order_number")
      .eq("id", jobId)
      .maybeSingle();
    if (
      panelizerReadError ||
      !panelizerJob ||
      String(panelizerJob.user_id || "") !== userId ||
      String(panelizerJob.generation_id || "") !== generationId
    ) {
      return json(
        {
          success: false,
          error:
            panelizerReadError?.message ||
            "Paid job does not match its authoritative panelizer owner/source",
        },
        409,
      );
    }
    const orderNumber = String(
      (durableJob as any).order_number || panelizerJob.order_number || jobId,
    );
    const suppliedIdentity = {
      jobId: String(requestedJobIdRaw || ""),
      generationId: String(requestedGenerationIdRaw || ""),
      userId: String(requestedUserIdRaw || ""),
      orderNumber: String(requestedOrderNumberRaw || ""),
    };
    const authoritativeIdentity = { jobId, generationId, userId, orderNumber };
    const mismatchedIdentity = Object.entries(suppliedIdentity).find(
      ([key, value]) =>
        !!value &&
        value !==
          authoritativeIdentity[key as keyof typeof authoritativeIdentity],
    );
    if (mismatchedIdentity) {
      return json(
        {
          success: false,
          error: `${mismatchedIdentity[0]} does not match the authoritative paid job`,
        },
        409,
      );
    }

    const { data: workflowRun, error: workflowReadError } = await db
      .from("workforce_runs")
      .select(
        "id,domain_job_id,domain_job_type,workflow_type,workflow_status,cancel_requested_at,tenant_key,requested_by,results",
      )
      .eq("id", workflowRunId)
      .eq("domain_job_id", productionJobId)
      .eq("domain_job_type", "designpro_production_jobs")
      .eq("workflow_type", "designpro.production_pack")
      .in("workflow_status", ["queued", "running", "waiting"])
      .is("cancel_requested_at", null)
      .maybeSingle();
    if (workflowReadError || !workflowRun) {
      return json(
        {
          success: false,
          error:
            workflowReadError?.message ||
            "Workflow run does not own the paid production job",
        },
        409,
      );
    }

    const WORKER_URL = Deno.env.get("WORKER_URL");
    const WORKER_SECRET = String(Deno.env.get("WORKER_SECRET") || "").trim();
    if (!WORKER_SECRET) {
      return json(
        {
          success: false,
          error:
            "WORKER_SECRET is not configured; worker activation is disabled",
        },
        500,
      );
    }
    if (!WORKER_URL)
      return json(
        {
          success: false,
          error: "WORKER_URL is not configured for this project",
        },
        500,
      );
    const processPanelUrl = `${WORKER_URL.replace(/\/+$/, "")}/process-panel`;
    const processLogoUrl = `${WORKER_URL.replace(/\/+$/, "")}/process-logo`;
    const packagePackUrl = `${WORKER_URL.replace(/\/+$/, "")}/package-pack`;

    // The durable orchestrator passes the exact pack it selected. Bind this
    // activation to that identity so a rebuild landing between its preflight and
    // this function cannot silently switch the paid job to a different source.
    const requestedSourceHash = String(
      requestedSourceHashRaw || "",
    ).toLowerCase();
    const requestedPackVersion = String(
      requestedPackVersionRaw || "",
    ).toLowerCase();
    const requestedSourceProofUrl = String(
      requestedSourceProofUrlRaw || "",
    ).trim();
    const requestedVaultJobId = String(requestedVaultJobIdRaw || "");
    const requestedRevisionId = String(requestedRevisionIdRaw || "");
    const requestedEnticePackId = String(requestedEnticePackIdRaw || "");
    const requestedDimensionManifestId = String(
      requestedDimensionManifestIdRaw || "",
    );
    const requestedSourceContractHash = String(
      requestedSourceContractHashRaw || "",
    ).toLowerCase();
    const requestedManifestHash = String(
      requestedManifestHashRaw || "",
    ).toLowerCase();
    const requestedPackIdentityHash = String(
      requestedPackIdentityHashRaw || "",
    ).toLowerCase();
    const requestedFingerprints = normalizeFingerprints(
      requestedFingerprintsRaw,
    );
    const requestedExpectedSides = normalizeSurfaceManifest(
      requestedExpectedSidesRaw,
    );
    const requestedPins: RevisionPackPins = {
      revisionId: requestedRevisionId,
      enticePackId: requestedEnticePackId,
      dimensionManifestId: requestedDimensionManifestId,
      sourceContractHash: requestedSourceContractHash,
      manifestHash: requestedManifestHash,
      packIdentityHash: requestedPackIdentityHash,
      packVersion: requestedPackVersion,
    };
    if (
      !UUID_PATTERN.test(requestedPins.revisionId) ||
      !UUID_PATTERN.test(requestedPins.enticePackId) ||
      !UUID_PATTERN.test(requestedPins.dimensionManifestId) ||
      !SHA256_PATTERN.test(requestedPins.sourceContractHash) ||
      !SHA256_PATTERN.test(requestedPins.manifestHash) ||
      !SHA256_PATTERN.test(requestedPins.packIdentityHash) ||
      !SHA256_PATTERN.test(requestedSourceHash) ||
      requestedSourceHash !== requestedPins.sourceContractHash ||
      requestedPins.packVersion !==
        `v2:${requestedPins.sourceContractHash.slice(0, 24)}` ||
      !requestedSourceProofUrl ||
      !UUID_PATTERN.test(requestedVaultJobId) ||
      !requestedFingerprints ||
      !requestedExpectedSides
    ) {
      return json(
        {
          success: false,
          error:
            "The durable Production Pack requires exact revisionId, enticePackId, dimensionManifestId, sourceContractHash, manifestHash, packIdentityHash, packVersion, source proof, dynamic surfaces, and artifact fingerprints",
        },
        400,
      );
    }
    const durableExpectedSides = normalizeSurfaceManifest(
      durableResult.expectedSides,
    );
    const durableRunKey = String(durableResult.runKey || "").toLowerCase();
    const durableFingerprints = normalizeFingerprints(
      durableResult.fingerprints,
    );
    if (
      String((durableJob as any).revision_id || "") !==
        requestedPins.revisionId ||
      String((durableJob as any).entice_pack_id || "") !==
        requestedPins.enticePackId ||
      String((durableJob as any).dimension_manifest_id || "") !==
        requestedPins.dimensionManifestId ||
      String((durableJob as any).source_contract_hash || "").toLowerCase() !==
        requestedPins.sourceContractHash ||
      !exactPinsMatch(durableResult, requestedPins) ||
      !exactPinsMatch((workflowRun as any).results, requestedPins) ||
      String((workflowRun as any).requested_by || "") !== userId ||
      String(durableResult.sourceHash || "").toLowerCase() !==
        requestedSourceHash ||
      String(durableResult.packVersion || "").toLowerCase() !==
        requestedPins.packVersion ||
      String(durableResult.sourceProofUrl || "").trim() !==
        requestedSourceProofUrl ||
      String(durableResult.vaultJobId || "") !== requestedVaultJobId ||
      String(durableResult.packIdentityHash || "").toLowerCase() !==
        requestedPins.packIdentityHash ||
      !durableFingerprints ||
      !sameFingerprints(durableFingerprints, requestedFingerprints) ||
      !durableExpectedSides ||
      !sameSideSet(durableExpectedSides, requestedExpectedSides)
    ) {
      return json(
        {
          success: false,
          error:
            "Requested source pack does not match the authoritative paid job",
        },
        409,
      );
    }

    const expectedWorkflowTenant = panelizerJob.shop_id
      ? `shop-profile:${panelizerJob.shop_id}`
      : `user:${userId}`;
    if (
      String((workflowRun as any).tenant_key || "") !== expectedWorkflowTenant
    ) {
      return json(
        {
          success: false,
          error: "Workflow tenant does not match the authoritative paid job",
        },
        409,
      );
    }

    // Durable production never resolves "latest" assets. The paid job's exact
    // Entice Pack is the only source of its surfaces, dimensions and artifacts.
    const [
      { data: pinnedPack, error: pinnedPackError },
      { data: pinnedRows, error: pinnedRowsError },
    ] = await Promise.all([
      db
        .from("designpro_entice_packs")
        .select(
          "id,design_id,designiq_generation_id,source_visualization_id,revision_id,dimension_manifest_id,user_id,tenant_key,status,manifest_hash,pack_identity_hash,source_contract_hash,surface_manifest,proof_artifact,panel_artifacts,logo_artifacts,pack_version,verified_at,activated_at,superseded_at",
        )
        .eq("id", requestedPins.enticePackId)
        .maybeSingle(),
      db
        .from("production_flow_assets")
        .select(
          "id,job_id,side,version,dimensions_inches,background_url,branding_url,meta_metrics,revision_id,entice_pack_id,designiq_generation_id,dimension_manifest_id,manifest_hash,source_contract_hash,artifact_hash",
        )
        .eq("entice_pack_id", requestedPins.enticePackId),
    ]);
    if (pinnedPackError || pinnedRowsError || !pinnedPack) {
      return json(
        {
          success: false,
          activated: 0,
          needsBuild: true,
          productionBlocked: true,
          error:
            pinnedPackError?.message ||
            pinnedRowsError?.message ||
            "The exact paid Entice Pack is unavailable",
        },
        409,
      );
    }

    const canonicalGid = String(
      (pinnedPack as any).designiq_generation_id || "",
    );
    const packSurfaceManifest = jsonObject(
      (pinnedPack as any).surface_manifest,
    );
    const packProofArtifact = jsonObject((pinnedPack as any).proof_artifact);
    const packPanelArtifacts = Array.isArray(
      (pinnedPack as any).panel_artifacts,
    )
      ? (pinnedPack as any).panel_artifacts
      : [];
    const packLogoArtifacts = Array.isArray((pinnedPack as any).logo_artifacts)
      ? (pinnedPack as any).logo_artifacts
      : [];
    const packExpectedSides = normalizeSurfaceManifest(
      packSurfaceManifest.expectedSides,
    );
    const packSurfaces = Array.isArray(packSurfaceManifest.surfaces)
      ? packSurfaceManifest.surfaces
      : [];
    const packDimensions = jsonObject(packSurfaceManifest.dimensions);
    const surfaceSides = normalizeSurfaceManifest(
      packSurfaces.map((surface: any) => surface?.key),
    );
    const panelSides = normalizeSurfaceManifest(
      packPanelArtifacts.map((panel: any) => panel?.side),
    );
    const manifestWithoutHash = { ...packSurfaceManifest };
    delete manifestWithoutHash.manifestHash;
    const computedManifestHash = await sha256(manifestWithoutHash);
    const computedPackIdentityHash = await sha256({
      revisionId: requestedPins.revisionId,
      dimensionManifestId: requestedPins.dimensionManifestId,
      sourceContractHash: requestedPins.sourceContractHash,
    });
    const verifiedAt = Date.parse(
      String((pinnedPack as any).verified_at || ""),
    );
    const activatedAt = Date.parse(
      String((pinnedPack as any).activated_at || ""),
    );
    const supersededAt = Date.parse(
      String((pinnedPack as any).superseded_at || ""),
    );
    const validLifecycle =
      Number.isFinite(verifiedAt) &&
      Number.isFinite(activatedAt) &&
      verifiedAt <= activatedAt &&
      (String((pinnedPack as any).status || "") === "active" ||
        (String((pinnedPack as any).status || "") === "superseded" &&
          Number.isFinite(supersededAt) &&
          activatedAt <= supersededAt));
    if (
      !validLifecycle ||
      String((pinnedPack as any).id || "") !== requestedPins.enticePackId ||
      String((pinnedPack as any).revision_id || "") !==
        requestedPins.revisionId ||
      String((pinnedPack as any).dimension_manifest_id || "") !==
        requestedPins.dimensionManifestId ||
      String((pinnedPack as any).source_contract_hash || "").toLowerCase() !==
        requestedPins.sourceContractHash ||
      String((pinnedPack as any).manifest_hash || "").toLowerCase() !==
        requestedPins.manifestHash ||
      String((pinnedPack as any).pack_identity_hash || "").toLowerCase() !==
        requestedPins.packIdentityHash ||
      String((pinnedPack as any).pack_version || "").toLowerCase() !==
        requestedPins.packVersion ||
      String((pinnedPack as any).user_id || "") !== userId ||
      String((pinnedPack as any).tenant_key || "") !== `user:${userId}` ||
      String((pinnedPack as any).design_id || "") !== generationId ||
      canonicalGid !== generationId ||
      requestedVaultJobId !== canonicalGid ||
      String(packProofArtifact.url || "").trim() !== requestedSourceProofUrl ||
      !fingerprintMatches(packProofArtifact, requestedFingerprints.proof) ||
      String(packSurfaceManifest.manifestHash || "").toLowerCase() !==
        requestedPins.manifestHash ||
      computedManifestHash !== requestedPins.manifestHash ||
      computedPackIdentityHash !== requestedPins.packIdentityHash ||
      !packExpectedSides ||
      !surfaceSides ||
      !panelSides ||
      !sameSideSet(packExpectedSides, requestedExpectedSides) ||
      !sameSideSet(packExpectedSides, surfaceSides) ||
      !sameSideSet(packExpectedSides, panelSides) ||
      packSurfaces.length !== packExpectedSides.length ||
      packPanelArtifacts.length !== packExpectedSides.length
    ) {
      return json(
        {
          success: false,
          activated: 0,
          productionBlocked: true,
          error:
            "The exact paid Entice Pack, frozen manifest, or tenant binding no longer matches its durable pins",
        },
        409,
      );
    }

    const bySide: Record<string, any> = {};
    for (const row of pinnedRows || []) {
      const side = String((row as any)?.side || "")
        .trim()
        .toUpperCase();
      if (!side || bySide[side]) {
        return json(
          {
            success: false,
            activated: 0,
            productionBlocked: true,
            error: "The exact paid Entice Pack contains duplicate panel rows",
          },
          409,
        );
      }
      bySide[side] = row;
    }
    if (
      Object.keys(bySide).length !== packExpectedSides.length ||
      !sameSideSet(Object.keys(bySide), packExpectedSides)
    ) {
      return json(
        {
          success: false,
          activated: 0,
          needsBuild: true,
          productionBlocked: true,
          generationId,
          canonicalId: canonicalGid,
          blocked: [
            {
              side: "PACK",
              reason: "the exact Entice Pack panel set is incomplete",
            },
          ],
          error:
            "Production activation blocked: rebuild and verify this exact revision pack.",
        },
        409,
      );
    }

    const panelsBySide = new Map<string, Record<string, any>>();
    const surfacesBySide = new Map<string, Record<string, any>>();
    for (const panel of packPanelArtifacts) {
      panelsBySide.set(
        String(panel?.side || "")
          .trim()
          .toUpperCase(),
        jsonObject(panel),
      );
    }
    for (const surface of packSurfaces) {
      surfacesBySide.set(
        String(surface?.key || "")
          .trim()
          .toUpperCase(),
        jsonObject(surface),
      );
    }

    const requiredSides = packExpectedSides;
    const activeSourceHash = requestedPins.sourceContractHash;
    const activePackVersion = requestedPins.packVersion;
    const activeSourceProofUrl = requestedSourceProofUrl;
    const activationIdentityHash = await sha256({
      workflowRunId,
      productionJobId,
      revisionId: requestedPins.revisionId,
      enticePackId: requestedPins.enticePackId,
      dimensionManifestId: requestedPins.dimensionManifestId,
      sourceContractHash: requestedPins.sourceContractHash,
      manifestHash: requestedPins.manifestHash,
      packIdentityHash: requestedPins.packIdentityHash,
      packVersion: requestedPins.packVersion,
    });
    const runKey = activationIdentityHash.slice(0, 24);
    if (durableRunKey && durableRunKey !== runKey) {
      return json(
        {
          success: false,
          error:
            "The durable worker run belongs to a different immutable revision pack",
        },
        409,
      );
    }
    const currentPanelManifest = Array.from(
      new Set(
        requiredSides.flatMap((side) => {
          const row = bySide[side];
          const panelKey = SIDE_TO_KEY[side];
          if (!row || !panelKey) return [];
          const brandedUrl = row.branding_url || row.background_url || null;
          const keys = [panelKey];
          if (row.background_url && row.background_url !== brandedUrl)
            keys.push(`${panelKey}_clean`);
          return keys;
        }),
      ),
    );
    const staticAssetFingerprintErrors: Array<{
      side: string;
      reason: string;
    }> = [];
    const staticAssets: Array<Record<string, unknown>> = [];
    const staticAssetObjects = new Set<string>();
    for (const [index, asset] of packLogoArtifacts.entries()) {
      const side = String(asset?.side || "")
        .trim()
        .toUpperCase();
      const object = storageObjectFromUrl(asset?.url);
      const fingerprintKey = `logo:${index}`;
      if (!requiredSides.includes(side)) {
        staticAssetFingerprintErrors.push({
          side: side || "PACK",
          reason: `${fingerprintKey} is not bound to a frozen surface`,
        });
        continue;
      }
      if (!object) {
        staticAssetFingerprintErrors.push({
          side,
          reason: `${fingerprintKey} is not in an approved storage bucket`,
        });
        continue;
      }
      const fingerprint = requestedFingerprints[fingerprintKey];
      if (!fingerprintMatches(asset, fingerprint)) {
        staticAssetFingerprintErrors.push({
          side,
          reason: `frozen fingerprint mismatch for ${fingerprintKey}`,
        });
        continue;
      }
      const objectKey = `${object.bucket}/${object.path}`;
      if (staticAssetObjects.has(objectKey)) continue;
      staticAssetObjects.add(objectKey);
      staticAssets.push({
        bucket: object.bucket,
        path: object.path,
        side,
        label: String(
          asset?.element_label ||
            asset?.label ||
            asset?.element_type ||
            `Logo ${index + 1}`,
        ),
        type: String(asset?.element_type || "branding"),
        revision_id: requestedPins.revisionId,
        entice_pack_id: requestedPins.enticePackId,
        dimension_manifest_id: requestedPins.dimensionManifestId,
        source_contract_hash: requestedPins.sourceContractHash,
        manifest_hash: requestedPins.manifestHash,
        pack_identity_hash: requestedPins.packIdentityHash,
        source_hash: activeSourceHash,
        pack_version: activePackVersion,
        activation_identity_hash: activationIdentityHash,
        run_key: runKey,
        fingerprint_key: fingerprintKey,
        sha256: fingerprint.sha256,
        bytes: fingerprint.bytes,
      });
    }

    // ── LOGO DISPATCH PLANS — "the fence must move for logos" (gap a). Every
    // frozen Logo Pack cut gets its own ledger-fenced hi-res dispatch. The key
    // derives from the frozen fingerprint index (`logo:<n>` → `logo_<n>`), so
    // a retried activation addresses the same durable dispatch row. Adding the
    // keys to the manifest extends the SAME completion/packaging/verify fence
    // that already governs panels — no parallel accounting.
    const logoDispatchPlans = staticAssets.map((asset) => ({
      asset,
      panelKey: `logo_${String(asset.fingerprint_key).split(":")[1]}`,
    }));
    for (const plan of logoDispatchPlans) {
      currentPanelManifest.push(plan.panelKey);
    }

    // ── FAIL-CLOSED PRODUCTION PREFLIGHT ────────────────────────────────────
    // Preview/entice assets may include one sanctioned, QC-judged flatten or
    // proof extraction. Never kick even one Railway panel unless every required side explicitly
    // carries the production-eligible provenance stamp written by
    // save-production-panels. Legacy/unknown rows are intentionally blocked.
    const blocked: Array<{ side: string; reason: string }> = [
      ...staticAssetFingerprintErrors,
    ];
    const frozenLogoArtifactsHash = await sha256(packLogoArtifacts);
    for (const side of requiredSides) {
      const row = bySide[side];
      const panel = panelsBySide.get(side);
      const surface = surfacesBySide.get(side);
      const expectedDimension = dimensionsFrom(packDimensions[side]);
      if (!row || !panel || !surface || !expectedDimension) {
        blocked.push({
          side,
          reason:
            "missing exact vault row, panel manifest, surface manifest, or dimensions",
        });
        continue;
      }
      const meta = jsonObject(row.meta_metrics);
      const rowDimensions = dimensionsFrom(row.dimensions_inches);
      const artifactHash = String(row.artifact_hash || "").toLowerCase();
      const panelArtifactHash = String(panel.artifactHash || "").toLowerCase();
      const cleanUrl = String(row.background_url || "").trim();
      const brandedUrl = String(row.branding_url || "").trim();
      const expectedSidesFromRow = normalizeSurfaceManifest(
        meta.expected_sides,
      );
      const panelFingerprints = jsonObject(panel.fingerprints);
      // REASONED SEPARATION GAP — the decided Call 7 contract: a refused
      // separation leaves the clean panel honestly absent while the branded
      // panel (the deliverable) ships. Same admission shape as the paid
      // verifier (worker/designpro-workflow.cjs resolveVerifiedAtomicPack):
      // known refused separation with a reason on both records, no clean
      // asset or evidence anywhere, no overlays, row production-INELIGIBLE.
      const separationGap =
        (panel as any).separationQc?.known === true &&
        (panel as any).separationQc?.pass === false &&
        String((panel as any).separationQc?.reason || "").trim().length > 0 &&
        (meta as any).separation_qc?.known === true &&
        (meta as any).separation_qc?.pass === false &&
        String(row.background_url || "").trim() === "" &&
        String((panel as any).cleanUrl || "").trim() === "" &&
        (!Array.isArray((panel as any).overlayManifest) ||
          (panel as any).overlayManifest.length === 0) &&
        (panelFingerprints as any).clean === undefined;
      const rowIdentityIsExact =
        String(row.job_id || "") === canonicalGid &&
        String(row.revision_id || "") === requestedPins.revisionId &&
        String(row.entice_pack_id || "") === requestedPins.enticePackId &&
        String(row.designiq_generation_id || "") === canonicalGid &&
        String(row.dimension_manifest_id || "") ===
          requestedPins.dimensionManifestId &&
        String(row.manifest_hash || "").toLowerCase() ===
          requestedPins.manifestHash &&
        String(row.source_contract_hash || "").toLowerCase() ===
          requestedPins.sourceContractHash &&
        String(row.version || "").toLowerCase() === requestedPins.packVersion &&
        artifactHash === panelArtifactHash &&
        SHA256_PATTERN.test(artifactHash);
      if (!rowIdentityIsExact) {
        blocked.push({
          side,
          reason: "typed revision-pack or artifact-hash pins do not match",
        });
      }
      if (
        String(panel.side || "")
          .trim()
          .toUpperCase() !== side ||
        String(surface.key || "")
          .trim()
          .toUpperCase() !== side ||
        cleanUrl !== String(panel.cleanUrl || "").trim() ||
        brandedUrl !== String(panel.brandedUrl || "").trim()
      ) {
        blocked.push({
          side,
          reason:
            "panel URLs or surface identity differ from the verified pack",
        });
      }
      if (
        !rowDimensions ||
        !sameDimension(rowDimensions.w, expectedDimension.w) ||
        !sameDimension(rowDimensions.h, expectedDimension.h) ||
        !sameDimension(panel.widthIn, expectedDimension.w) ||
        !sameDimension(panel.heightIn, expectedDimension.h) ||
        !sameDimension(surface.trimWidthIn, expectedDimension.w) ||
        !sameDimension(surface.trimHeightIn, expectedDimension.h)
      ) {
        blocked.push({
          side,
          reason: "panel dimensions differ from the frozen surface manifest",
        });
      }
      if (
        Number(meta.bleed_in) !== 5 ||
        Number(panel.bleedIn) !== 5 ||
        Number(surface.bleedIn) !== 5
      ) {
        blocked.push({
          side,
          reason: "the verified panel does not carry exactly 5 inches of bleed",
        });
      }
      if (
        meta.production_eligible !== !separationGap ||
        panel.productionEligible !== true
      ) {
        blocked.push({
          side,
          reason: "missing explicit production-eligible provenance",
        });
      }
      if (
        meta.qc?.known !== true ||
        meta.qc?.pass !== true ||
        panel.qc?.known !== true ||
        panel.qc?.pass !== true
      ) {
        blocked.push({
          side,
          reason: "QC verdict is missing, unavailable, or failed",
        });
      }
      if (
        meta.separation_qc?.known !== true ||
        meta.separation_qc?.pass !== !separationGap ||
        panel.separationQc?.known !== true ||
        panel.separationQc?.pass !== !separationGap
      ) {
        blocked.push({
          side,
          reason: "clean/logo separation is missing, unavailable, or failed",
        });
      }
      if (
        !brandedUrl ||
        !/\/wrap-files\/(.+?)(\?|$)/.test(brandedUrl) ||
        (!separationGap &&
          (!cleanUrl || !/\/wrap-files\/(.+?)(\?|$)/.test(cleanUrl)))
      ) {
        blocked.push({
          side,
          reason: "every expected clean/branded layer must be in wrap-files",
        });
      }
      const brandedFingerprintKey = `panel:${side}:branded`;
      if (
        !fingerprintMatches(
          panelFingerprints.branded,
          requestedFingerprints[brandedFingerprintKey],
        )
      ) {
        blocked.push({
          side,
          reason: `frozen fingerprint mismatch for ${brandedFingerprintKey}`,
        });
      }
      // A gap side has no clean asset by contract, so it carries no clean
      // fingerprint; requiring one here is what refused the honest REAR gap.
      if (
        !separationGap &&
        !fingerprintMatches(
          panelFingerprints.clean,
          requestedFingerprints[`panel:${side}:clean`],
        )
      ) {
        blocked.push({
          side,
          reason: `frozen fingerprint mismatch for panel:${side}:clean`,
        });
      }
      // Overlay evidence is TWO artifacts per lifted element (rebuild + cut),
      // keyed `overlay:{i}:rebuild` / `overlay:{i}:cut` — the shape the entice
      // chain writes and verify_atomic_pack now verifies. The un-suffixed key
      // is accepted only as a legacy fallback for the rebuild.
      const overlays = Array.isArray(panel.overlayManifest)
        ? panel.overlayManifest
        : [];
      for (const [position, overlay] of overlays.entries()) {
        const index = Number.isSafeInteger(Number((overlay as any)?.index))
          ? Number((overlay as any).index)
          : position;
        const rebuildKey = `panel:${side}:overlay:${index}:rebuild`;
        const rebuildEvidence =
          panelFingerprints[`overlay:${index}:rebuild`] ??
          panelFingerprints[`overlay:${index}`];
        if (
          String((overlay as any)?.rebuild_url || (overlay as any)?.url || "").trim() === "" ||
          !fingerprintMatches(
            rebuildEvidence,
            requestedFingerprints[rebuildKey],
          )
        ) {
          blocked.push({
            side,
            reason: `frozen fingerprint mismatch for ${rebuildKey}`,
          });
        }
        const cutEvidence = panelFingerprints[`overlay:${index}:cut`];
        const cutUrl = String((overlay as any)?.cut_url || "").trim();
        if (cutEvidence !== undefined || cutUrl) {
          const cutKey = `panel:${side}:overlay:${index}:cut`;
          if (
            !cutUrl ||
            !fingerprintMatches(cutEvidence, requestedFingerprints[cutKey])
          ) {
            blocked.push({
              side,
              reason: `frozen fingerprint mismatch for ${cutKey}`,
            });
          }
        }
      }
      if (
        String(meta.source_hash || "").toLowerCase() !== activeSourceHash ||
        String(meta.source_contract_hash || "").toLowerCase() !==
          requestedPins.sourceContractHash ||
        String(meta.pack_version || "").toLowerCase() !== activePackVersion ||
        String(meta.source_proof_url || "").trim() !== activeSourceProofUrl ||
        String(meta.revision_id || "") !== requestedPins.revisionId ||
        String(meta.entice_pack_id || "") !== requestedPins.enticePackId ||
        String(meta.designiq_generation_id || "") !== canonicalGid ||
        String(meta.dimension_manifest_id || "") !==
          requestedPins.dimensionManifestId ||
        String(meta.manifest_hash || "").toLowerCase() !==
          requestedPins.manifestHash ||
        !expectedSidesFromRow ||
        !sameSideSet(expectedSidesFromRow, requiredSides)
      ) {
        blocked.push({
          side,
          reason: "artifact metadata does not match the frozen revision pack",
        });
      }
      if (
        (await sha256(Array.isArray(meta.logo_pack) ? meta.logo_pack : [])) !==
        frozenLogoArtifactsHash
      ) {
        blocked.push({
          side,
          reason: "row logo pack differs from the verified pack",
        });
      }
    }
    if (blocked.length) {
      return json(
        {
          success: false,
          activated: 0,
          productionBlocked: true,
          generationId,
          canonicalId: canonicalGid,
          blocked,
          error:
            "Production activation blocked: every side requires a source-bound panel and known passing QC/separation verdicts.",
        },
        409,
      );
    }

    const storageFolder = orderNumber;

    // Publish runKey onto this exact durable paid job before any worker can
    // finish. Every identity component and the prior JSON value participate in
    // the compare-and-swap, so a newer retry/source can never be overwritten.
    let durableStamp = db
      .from("designpro_production_jobs")
      .update({
        result: {
          ...durableResult,
          sourceHash: activeSourceHash,
          packVersion: activePackVersion,
          sourceProofUrl: activeSourceProofUrl,
          runKey,
          activationIdentityHash,
          revisionId: requestedPins.revisionId,
          enticePackId: requestedPins.enticePackId,
          dimensionManifestId: requestedPins.dimensionManifestId,
          sourceContractHash: requestedPins.sourceContractHash,
          manifestHash: requestedPins.manifestHash,
          packIdentityHash: requestedPins.packIdentityHash,
          expectedSides: requiredSides,
          expectedPanels: currentPanelManifest,
          staticAssets,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", productionJobId)
      .eq("state", (durableJob as any).state)
      .eq("revision_id", requestedPins.revisionId)
      .eq("entice_pack_id", requestedPins.enticePackId)
      .eq("dimension_manifest_id", requestedPins.dimensionManifestId)
      .eq("source_contract_hash", requestedPins.sourceContractHash)
      .eq("result->>workflowRunId", workflowRunId)
      .eq("result->>sourceHash", activeSourceHash)
      .eq("result->>packVersion", activePackVersion)
      .eq("result->>revisionId", requestedPins.revisionId)
      .eq("result->>enticePackId", requestedPins.enticePackId)
      .eq("result->>dimensionManifestId", requestedPins.dimensionManifestId)
      .eq("result->>sourceContractHash", requestedPins.sourceContractHash)
      .eq("result->>manifestHash", requestedPins.manifestHash)
      .eq("result->>packIdentityHash", requestedPins.packIdentityHash);
    durableStamp = durableRunKey
      ? durableStamp.eq("result->>runKey", durableRunKey)
      : durableStamp.is("result->>runKey", null);
    // Scalar `updated_at` token, not a whole-document result filter: object
    // `.eq` serializes to "[object Object]" (invalid json syntax), JSON-text
    // `.eq` breaks PostgREST's filter grammar (HTTP 400), and cs/cd
    // containment inflated the URL past the runtime limit once `result`
    // carried the full fingerprint evidence set (TypeError: Invalid URL at
    // ~86KB — run 6366dddd attempt 7). Every writer bumps updated_at and the
    // BEFORE UPDATE trigger bumps it regardless, so equality on it detects
    // any concurrent write (worker/index.js stampPrintWorker precedent).
    const durableUpdatedAt =
      (durableJob as any).updated_at == null
        ? ""
        : String((durableJob as any).updated_at);
    if (!durableUpdatedAt) {
      return json(
        {
          success: false,
          error: "Durable job carries no updated_at token to fence on",
          code: "durable_write_failed",
        },
        409,
      );
    }
    durableStamp = durableStamp.eq("updated_at", durableUpdatedAt);
    const { data: durableStamped, error: durableStampError } =
      await durableStamp.select("id").maybeSingle();
    if (durableStampError || !durableStamped?.id) {
      return json(
        {
          success: false,
          error:
            durableStampError?.message ||
            "Unable to bind the durable job to the worker run",
        },
        409,
      );
    }

    // concept_json remains a compatibility/read-model projection for the
    // existing QC board and worker completion stamps. It is never consulted to
    // decide whether a panel may be dispatched. Compare-and-swap prevents this
    // projection from erasing a worker stamp that lands concurrently.
    const projectPrintWorker = async (
      mutate: (current: Record<string, any>) => Record<string, any>,
      status?: string,
    ): Promise<Record<string, any>> => {
      for (let attempt = 1; attempt <= 6; attempt++) {
        const { data: row, error: readError } = await db
          .from("panelizer_jobs")
          .select("concept_json,updated_at")
          .eq("id", jobId)
          .maybeSingle();
        if (readError || !row) {
          throw new Error(
            readError?.message || "Panelizer projection is unavailable",
          );
        }
        const concept =
          row.concept_json && typeof row.concept_json === "object"
            ? row.concept_json
            : {};
        const current =
          (concept as any).print_worker &&
          typeof (concept as any).print_worker === "object"
            ? (concept as any).print_worker
            : {};
        const next = mutate(current);
        let update = db
          .from("panelizer_jobs")
          .update({
            ...(status ? { status } : {}),
            concept_json: { ...concept, print_worker: next },
          })
          .eq("id", jobId);
        // Scalar updated_at fence — the exact pattern worker/index.js
        // stampPrintWorker uses on this same table (its BEFORE UPDATE trigger
        // panelizer_jobs_updated_at bumps the column on every write). A
        // jsonb-document filter on concept_json cannot do this: .eq breaks
        // both ways and cs/cd containment overflows the request URL once
        // print_worker carries per-side stamps.
        update = update.eq("updated_at", (row as any).updated_at);
        const { data: changed, error: updateError } = await update
          .select("id")
          .maybeSingle();
        if (!updateError && changed?.id) return next;
        if (updateError && attempt === 6) throw updateError;
      }
      throw new Error("Panelizer projection conflicted repeatedly");
    };

    await projectPrintWorker((current) => {
      const sameSource = matchesRun(
        current,
        activeSourceHash,
        activePackVersion,
        runKey,
        activationIdentityHash,
      );
      return sameSource
        ? {
            ...current,
            source_proof_url: activeSourceProofUrl,
            activated: currentPanelManifest,
            static_assets: staticAssets,
          }
        : {
            activation_attempts: Number(current.activation_attempts || 0),
            previous_run: current.run_key
              ? {
                  source_hash: current.source_hash || null,
                  pack_version: current.pack_version || null,
                  run_key: current.run_key,
                  panels: current.panels || {},
                  zip: current.zip || null,
                }
              : current.previous_run || null,
            source_hash: activeSourceHash,
            pack_version: activePackVersion,
            source_proof_url: activeSourceProofUrl,
            revision_id: requestedPins.revisionId,
            entice_pack_id: requestedPins.enticePackId,
            dimension_manifest_id: requestedPins.dimensionManifestId,
            source_contract_hash: requestedPins.sourceContractHash,
            manifest_hash: requestedPins.manifestHash,
            pack_identity_hash: requestedPins.packIdentityHash,
            activation_identity_hash: activationIdentityHash,
            run_key: runKey,
            panels: {},
            zip: null,
            activated: currentPanelManifest,
            static_assets: staticAssets,
            skipped: [],
            alreadyComplete: [],
            alreadyDispatched: [],
          };
    });

    const kicked: string[] = [];
    const alreadyComplete: string[] = [];
    const alreadyDispatched: string[] = [];
    const skipped: Array<{ side: string; reason: string }> = [];
    const dispatchWorkerPanel = async (
      sideLabel: string,
      panelKey: string,
      workerBody: Record<string, unknown>,
      workerUrl: string = processPanelUrl,
    ): Promise<void> => {
      const { data, error } = await db.rpc(
        "claim_and_enqueue_production_panel_dispatch",
        {
          p_workflow_run_id: workflowRunId,
          p_production_job_id: productionJobId,
          p_source_hash: activeSourceHash,
          p_pack_version: activePackVersion,
          p_run_key: runKey,
          p_panel_key: panelKey,
          p_worker: `activate-print-worker:${workflowRunId}`,
          p_lease_seconds: 1800,
          p_url: workerUrl,
          p_secret: WORKER_SECRET,
          p_body: workerBody,
        },
      );
      if (error) {
        skipped.push({ side: sideLabel, reason: error.message });
        return;
      }
      const receipt = data && typeof data === "object" ? data : {};
      if ((receipt as any).enqueued === true) {
        kicked.push(panelKey);
      } else if ((receipt as any).status === "completed") {
        alreadyComplete.push(panelKey);
      } else if (
        ["dispatched", "processing"].includes(String((receipt as any).status))
      ) {
        alreadyDispatched.push(panelKey);
      } else {
        skipped.push({
          side: sideLabel,
          reason: `dispatch receipt returned ${String((receipt as any).status || "no status")}`,
        });
      }
    };

    for (const side of requiredSides) {
      const row = bySide[side];
      if (!row) {
        skipped.push({ side, reason: "not in vault" });
        continue;
      }
      const panelKey = SIDE_TO_KEY[side];
      // Durable workflows consume only the branded object fingerprinted by the
      // verify_atomic_pack checkpoint. final_pack_url is a mutable legacy
      // projection and is intentionally excluded from source-bound dispatch.
      const url: string | null = row.branding_url || null;
      if (!url) {
        skipped.push({ side, reason: "no panel url" });
        continue;
      }
      const inputFingerprintKey = `panel:${side}:branded`;
      const inputFingerprint = requestedFingerprints[inputFingerprintKey];
      if (!inputFingerprint) {
        skipped.push({
          side,
          reason: `missing frozen fingerprint for ${inputFingerprintKey}`,
        });
        continue;
      }
      // inputPath = the storage path WITHIN the wrap-files bucket (the worker
      // downloads supabase.storage.from("wrap-files").download(inputPath)).
      const m = String(url).match(/\/wrap-files\/(.+?)(\?|$)/);
      if (!m) {
        skipped.push({ side, reason: "panel not in wrap-files" });
        continue;
      }
      const inputPath = decodeURIComponent(m[1]);

      // True print dims (GENIE trim); the worker adds the 5" mirror bleed.
      const di: any = row.dimensions_inches || {};
      let W = Number(di.w ?? di.width) || 0;
      let H = Number(di.h ?? di.height) || 0;
      if ((!W || !H) && typeof di === "string") {
        const dm = String(di).match(/([\d.]+)\s*[x×]\s*([\d.]+)/i);
        if (dm) {
          W = parseFloat(dm[1]);
          H = parseFloat(dm[2]);
        }
      }
      if (!W || !H) {
        skipped.push({ side, reason: "side has no own GENIE print dimensions" });
        continue;
      }

      // Build Assets' gridslice/mirror panels already carry a BAKED 5" mirror
      // bleed (meta_metrics.bleed_in; inferred from px/dpi for legacy rows).
      // Feed the worker the TRUE bleed-inclusive inches and addBleed:false so
      // nativePPI is computed correctly and the bleed is never doubled — the
      // old TRIM dims + addBleed:true stacked a SECOND 5" ring (~10" total)
      // and skewed the PPI estimate by up to ~50% on small sides.
      const bleedEvidence = (row.meta_metrics as any)?.bleed_in;
      const bakedBleed = Number(bleedEvidence);
      if (![0, 5].includes(bakedBleed)) {
        skipped.push({
          side,
          reason: "side has no exact zero-or-five-inch bleed receipt",
        });
        continue;
      }
      const workerBody = {
        jobId,
        userId,
        orderNumber: storageFolder,
        panelKey,
        sourceHash: activeSourceHash,
        packVersion: activePackVersion,
        sourceProofUrl: activeSourceProofUrl,
        runKey,
        activationIdentityHash,
        revisionId: requestedPins.revisionId,
        enticePackId: requestedPins.enticePackId,
        dimensionManifestId: requestedPins.dimensionManifestId,
        sourceContractHash: requestedPins.sourceContractHash,
        manifestHash: requestedPins.manifestHash,
        packIdentityHash: requestedPins.packIdentityHash,
        widthInches: W + 2 * bakedBleed,
        heightInches: H + 2 * bakedBleed,
        inputPath,
        inputFingerprintKey,
        inputSha256: inputFingerprint.sha256,
        inputBytes: inputFingerprint.bytes,
        // Paid DesignPro output is source-bound and deterministic after Call 7.
        // Railway may resize only with Sharp, add the missing five-inch mirror
        // bleed, and encode the approved bytes. EPS is a local raster encoding;
        // no Topaz, Clarity, ESRGAN or Vectorizer tracing is permitted.
        native: true,
        addBleed: bakedBleed === 0,
        trimWidthInches: W,
        trimHeightInches: H,
        sourceBleedInches: bakedBleed,
        outputEps: true,
        deterministicProduction: true,
        reconstruct: false,
        useTopaz: false,
        upscaler: "sharp",
      };
      // Atomic claim + pg_net enqueue happen in one database transaction. The
      // RPC injects its generated dispatchId and dispatchToken into this body.
      await dispatchWorkerPanel(side, panelKey, workerBody);

      // ── BLANK/CLEAN panel — its OWN upscale job (Trish 2026-07-24: "railway
      // should upscale everything, including the blank panels so the design team
      // can lay them on vehicle templates to verify sizing for QC"). The clean,
      // logo-free slice lives in background_url; upscale it under a distinct
      // panelKey (`${panelKey}_clean`) so it never clobbers the branded file. It
      // shares the side's dims/bleed, so reuse the same workerBody. Skipped when
      // there is no distinct clean slice (e.g. the branded url IS background_url).
      const cleanUrl: string | null = row.background_url || null;
      if (cleanUrl && cleanUrl !== url) {
        const cm = String(cleanUrl).match(/\/wrap-files\/(.+?)(\?|$)/);
        if (cm) {
          const cleanFingerprintKey = `panel:${side}:clean`;
          const cleanFingerprint = requestedFingerprints[cleanFingerprintKey];
          if (!cleanFingerprint) {
            skipped.push({
              side: `${side} (clean)`,
              reason: `missing frozen fingerprint for ${cleanFingerprintKey}`,
            });
            continue;
          }
          const cleanInputPath = decodeURIComponent(cm[1]);
          const cleanKey = `${panelKey}_clean`;
          const cleanBody = {
            ...workerBody,
            panelKey: cleanKey,
            inputPath: cleanInputPath,
            inputFingerprintKey: cleanFingerprintKey,
            inputSha256: cleanFingerprint.sha256,
            inputBytes: cleanFingerprint.bytes,
          };
          await dispatchWorkerPanel(`${side} (clean)`, cleanKey, cleanBody);
        } else {
          skipped.push({
            side: `${side} (clean)`,
            reason: "clean panel not in wrap-files",
          });
        }
      }
    }

    // ── LOGO dispatches — gap (a): the fence moves for logos. Each frozen
    // Logo Pack cut asset gets its own ledger-fenced job on the worker
    // (/process-logo): exactly ONE deterministic Sharp lanczos3 resample with
    // alpha preserved, no AI — the same post-freeze rule as panels. The as-is
    // cut still ships in Logo-Pack/; packaging adds the hi-res variant under
    // Logo-Pack-HiRes/ from this dispatch's artifact evidence.
    for (const plan of logoDispatchPlans) {
      const asset = plan.asset as Record<string, unknown>;
      const logoBody = {
        jobId,
        userId,
        orderNumber: storageFolder,
        panelKey: plan.panelKey,
        sourceHash: activeSourceHash,
        packVersion: activePackVersion,
        runKey,
        activationIdentityHash,
        revisionId: requestedPins.revisionId,
        enticePackId: requestedPins.enticePackId,
        dimensionManifestId: requestedPins.dimensionManifestId,
        sourceContractHash: requestedPins.sourceContractHash,
        manifestHash: requestedPins.manifestHash,
        packIdentityHash: requestedPins.packIdentityHash,
        inputBucket: asset.bucket,
        inputPath: asset.path,
        inputFingerprintKey: asset.fingerprint_key,
        inputSha256: asset.sha256,
        inputBytes: asset.bytes,
        label: asset.label,
        side: asset.side,
        native: true,
      };
      await dispatchWorkerPanel(
        `${String(asset.side || "PACK")} (${plan.panelKey})`,
        plan.panelKey,
        logoBody,
        processLogoUrl,
      );
    }

    const acceptedDispatches = new Set([
      ...kicked,
      ...alreadyComplete,
      ...alreadyDispatched,
    ]);
    const missingDispatches = currentPanelManifest.filter(
      (panelKey) => !acceptedDispatches.has(panelKey),
    );
    if (missingDispatches.length) {
      skipped.push({
        side: "PACK",
        reason: `dispatch manifest incomplete: ${missingDispatches.join(", ")}`,
      });
    }

    // Durable dispatch rows, not concept_json, are the completion authority.
    const { data: durableDispatches, error: dispatchReadError } = await db
      .from("production_panel_dispatches")
      .select("panel_key,status")
      .eq("production_job_id", productionJobId)
      .eq("source_hash", activeSourceHash)
      .eq("pack_version", activePackVersion)
      .eq("run_key", runKey);
    if (dispatchReadError) {
      skipped.push({
        side: "PACK",
        reason: `unable to verify durable dispatches: ${dispatchReadError.message}`,
      });
    }
    const dispatchStatus = new Map<string, string>(
      (durableDispatches || []).map((row: any) => [
        String(row.panel_key),
        String(row.status),
      ]),
    );
    const allManifestPanelsComplete =
      !dispatchReadError &&
      currentPanelManifest.length > 0 &&
      currentPanelManifest.every(
        (panelKey) => dispatchStatus.get(panelKey) === "completed",
      );
    const packageStatus = dispatchStatus.get("__package__") || "";
    const packageComplete = packageStatus === "completed";
    const packageInFlight = ["pending", "dispatched", "processing"].includes(
      packageStatus,
    );
    let packageQueued = false;
    if (allManifestPanelsComplete && !packageComplete && !packageInFlight) {
      const { error: packageKickError } = await db.rpc("kick_print_worker", {
        p_url: packagePackUrl,
        p_secret: WORKER_SECRET,
        p_body: {
          jobId,
          userId,
          orderNumber: storageFolder,
          sourceHash: activeSourceHash,
          packVersion: activePackVersion,
          sourceProofUrl: activeSourceProofUrl,
          runKey,
          activationIdentityHash,
          revisionId: requestedPins.revisionId,
          enticePackId: requestedPins.enticePackId,
          dimensionManifestId: requestedPins.dimensionManifestId,
          sourceContractHash: requestedPins.sourceContractHash,
          manifestHash: requestedPins.manifestHash,
          packIdentityHash: requestedPins.packIdentityHash,
          workflowRunId,
          productionJobId,
          force: false,
        },
      });
      if (packageKickError) {
        skipped.push({
          side: "PACK",
          reason: `package kick failed: ${packageKickError.message}`,
        });
      } else {
        packageQueued = true;
      }
    }

    const { data: projectionRow } = await db
      .from("panelizer_jobs")
      .select("concept_json")
      .eq("id", jobId)
      .maybeSingle();
    const projection =
      projectionRow?.concept_json &&
      typeof projectionRow.concept_json === "object"
        ? (projectionRow.concept_json as any).print_worker || {}
        : {};
    const currentZipProjected = matchesRun(
      projection.zip,
      activeSourceHash,
      activePackVersion,
      runKey,
      "",
    );

    // Validate (non-fatal) — the read-only 5-check golden-job regression on the
    // vault the worker is upscaling. Stamp the summary onto the job.
    let validation: any = null;
    try {
      const vr = await fetch(
        `${supabaseUrl}/functions/v1/golden-job-regression`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ generationId }),
          signal: AbortSignal.timeout(60000),
        },
      );
      if (vr.ok) {
        const vj = await vr.json();
        validation = { pass: vj?.pass, summary: vj?.summary };
      }
    } catch {
      /* non-fatal */
    }

    const acceptedSet = new Set([
      ...kicked,
      ...alreadyComplete,
      ...alreadyDispatched,
    ]);
    const dispatchSucceeded =
      skipped.length === 0 &&
      currentPanelManifest.length > 0 &&
      acceptedSet.size === currentPanelManifest.length &&
      currentPanelManifest.every((panelKey) => acceptedSet.has(panelKey));

    // Land the job ADMIN-READY (gated). pending_qc = the designer QC surface;
    // it is NOT auto-delivered to the customer's WrapBox.
    try {
      await projectPrintWorker(
        (current) => {
          if (
            !matchesRun(
              current,
              activeSourceHash,
              activePackVersion,
              runKey,
              activationIdentityHash,
            )
          ) {
            throw new Error(
              `Run ${runKey} became stale before final activation projection`,
            );
          }
          return {
            ...current,
            source_proof_url: activeSourceProofUrl,
            revision_id: requestedPins.revisionId,
            entice_pack_id: requestedPins.enticePackId,
            dimension_manifest_id: requestedPins.dimensionManifestId,
            source_contract_hash: requestedPins.sourceContractHash,
            manifest_hash: requestedPins.manifestHash,
            pack_identity_hash: requestedPins.packIdentityHash,
            activation_identity_hash: activationIdentityHash,
            activated: currentPanelManifest,
            static_assets: staticAssets,
            kicked,
            skipped,
            alreadyComplete,
            alreadyDispatched,
            activation_attempts: (Number(current.activation_attempts) || 0) + 1,
            activated_at: new Date().toISOString(),
            validation: validation ?? current.validation ?? null,
            source:
              "activate-print-worker (durable dispatch ledger → Railway /process-panel)",
          };
        },
        allManifestPanelsComplete && packageComplete && currentZipProjected
          ? "pending_qc"
          : "processing",
      );
    } catch (e) {
      console.warn(
        "[activate-print-worker] job status update failed (non-fatal):",
        (e as Error)?.message,
      );
    }

    console.log(
      `[activate-print-worker] job ${jobId}: kicked ${kicked.length} panel(s) [${kicked.join(", ")}], already complete ${alreadyComplete.length}, skipped ${skipped.length}`,
    );
    return json({
      success: dispatchSucceeded,
      ...(dispatchSucceeded
        ? {}
        : {
            error:
              "One or more current-run worker dispatches failed; retry will reuse completed panels.",
          }),
      activated: kicked.length,
      activatedSides: kicked,
      expectedPanels: currentPanelManifest,
      alreadyComplete,
      alreadyDispatched,
      resume: alreadyComplete.length > 0 || alreadyDispatched.length > 0,
      // A paid durable job is complete only when the matching current-run ZIP
      // exists. Panel completion alone queues/retries packaging.
      allComplete:
        allManifestPanelsComplete && packageComplete && currentZipProjected,
      packageQueued,
      skipped,
      generationId,
      canonicalId: canonicalGid,
      validation,
      sourceHash: activeSourceHash,
      packVersion: activePackVersion,
      sourceProofUrl: activeSourceProofUrl,
      runKey,
      activationIdentityHash,
      revisionId: requestedPins.revisionId,
      enticePackId: requestedPins.enticePackId,
      dimensionManifestId: requestedPins.dimensionManifestId,
      sourceContractHash: requestedPins.sourceContractHash,
      manifestHash: requestedPins.manifestHash,
      packIdentityHash: requestedPins.packIdentityHash,
      staticAssetCount: staticAssets.length,
    });
  } catch (err) {
    console.error("[activate-print-worker] error:", err);
    return json({ success: false, error: String(err) }, 500);
  }
});
