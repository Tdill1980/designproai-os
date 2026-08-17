/**
 * DesignPro File Output API
 *
 * Stable browser/internal facade for canonical server-owned DesignPro file
 * workflows. This function never renders, extracts, sizes, mirrors, judges,
 * upscales, packages, or delivers files. It authenticates one request and
 * delegates to run-production-flow, which records the durable workflow.
 *
 * Existing Production Pack callers may omit workflowType:
 * POST {
 *   action:"start",
 *   jobId,
 *   generationId?,
 *   enticePackId?,
 *   orderRequestId?,
 *   idempotencyKey?
 * }
 * POST { action:"status", productionJobId? | panelizerJobId? | jobId? }
 * POST { action:"resume", productionJobId? | panelizerJobId? | jobId? }
 *
 * Revision-aware Entice Pack callers must identify the workflow:
 * POST {
 *   action:"save_revision",
 *   workflowType:"designpro.entice_pack",
 *   visualizationId,
 *   expectedUpdatedAt,
 *   renderUrls,
 *   adminNotesPatch?,
 *   vehicleType?,
 *   finishType?,
 *   generationId?,
 *   trigger?,
 *   change?,
 *   idempotencyKey?
 * }
 * POST {
 *   action:"start",
 *   workflowType:"designpro.entice_pack",
 *   visualizationId,
 *   expectedUpdatedAt,
 *   generationId?,
 *   trigger?,
 *   change?,
 *   idempotencyKey?
 * }
 * POST {
 *   action:"status" | "resume",
 *   workflowType:"designpro.entice_pack",
 *   workflowRunId
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const PRODUCTION_PACK_WORKFLOW = "designpro.production_pack";
const ENTICE_PACK_WORKFLOW = "designpro.entice_pack";
const supportedWorkflowTypes = new Set([
  PRODUCTION_PACK_WORKFLOW,
  ENTICE_PACK_WORKFLOW,
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function text(value: unknown): string {
  return String(value || "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Server configuration unavailable" }, 503);
  }
  const bearer = (req.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  const serviceAuthorized = bearer === serviceKey;
  const userBearerSupplied = !!bearer && !serviceAuthorized;
  if (!serviceAuthorized && !userBearerSupplied) {
    return json({ error: "Unauthorized", code: "no_auth" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const requestedAction = text(body.action || "start").toLowerCase();
  const action = requestedAction === "run" ? "start" : requestedAction;
  if (!["start", "save_revision", "status", "resume"].includes(action)) {
    return json(
      { error: `Unknown action "${requestedAction}"`, code: "invalid_action" },
      400,
    );
  }

  const workflowType = text(
    body.workflowType || body.workflow_type || PRODUCTION_PACK_WORKFLOW,
  );
  if (!supportedWorkflowTypes.has(workflowType)) {
    return json(
      {
        error: `Unsupported workflowType "${workflowType}"`,
        code: "invalid_workflow_type",
        supportedWorkflowTypes: [...supportedWorkflowTypes],
      },
      400,
    );
  }
  const isEnticePack = workflowType === ENTICE_PACK_WORKFLOW;

  if (action === "save_revision" && !isEnticePack) {
    return json(
      {
        error: "save_revision is only valid for designpro.entice_pack",
        code: "invalid_save_revision_workflow",
      },
      400,
    );
  }

  if (action === "start" || action === "save_revision") {
    if (isEnticePack) {
      if (!text(body.visualizationId || body.visualization_id)) {
        return json(
          {
            error:
              "visualizationId is required to freeze the saved Revision Studio state",
            code: "visualization_id_required",
          },
          400,
        );
      }
      const expectedUpdatedAt = text(
        body.expectedUpdatedAt || body.expected_updated_at,
      );
      if (
        !expectedUpdatedAt ||
        !Number.isFinite(Date.parse(expectedUpdatedAt))
      ) {
        return json(
          {
            error:
              "expectedUpdatedAt is required to prevent freezing a newer or partial edit",
            code: "expected_updated_at_required",
          },
          400,
        );
      }
      if (action === "save_revision") {
        const renderUrls = body.renderUrls || body.render_urls;
        const entries = isRecord(renderUrls)
          ? Object.entries(renderUrls)
          : [];
        if (
          !entries.length ||
          entries.length > 32 ||
          entries.some(
            ([key, value]) =>
              !text(key) ||
              text(key).length > 80 ||
              !text(value) ||
              text(value).length > 8_192,
          )
        ) {
          return json(
            {
              error:
                "renderUrls must contain one to 32 named saved image URLs",
              code: "invalid_revision_render_urls",
            },
            400,
          );
        }
        const adminNotesPatch =
          body.adminNotesPatch || body.admin_notes_patch;
        if (
          adminNotesPatch !== undefined &&
          !isRecord(adminNotesPatch)
        ) {
          return json(
            {
              error: "adminNotesPatch must be a JSON object",
              code: "invalid_admin_notes_patch",
            },
            400,
          );
        }
        if (
          text(body.vehicleType || body.vehicle_type).length > 80 ||
          text(body.finishType || body.finish_type).length > 80
        ) {
          return json(
            {
              error: "vehicleType and finishType are too long",
              code: "invalid_revision_column_patch",
            },
            400,
          );
        }
      }
    } else if (!text(body.jobId || body.job_id)) {
      return json(
        {
          error:
            "jobId is required; create the tenant-owned panelizer request before starting output",
          code: "job_id_required",
        },
        400,
      );
    }
  }

  if (
    isEnticePack &&
    action === "resume" &&
    !text(body.workflowRunId || body.workflow_run_id)
  ) {
    return json(
      {
        error: "workflowRunId is required to resume an Entice Pack",
        code: "workflow_run_id_required",
      },
      400,
    );
  }
  if (
    isEnticePack &&
    action === "status" &&
    !text(body.workflowRunId || body.workflow_run_id) &&
    !text(body.visualizationId || body.visualization_id) &&
    !text(body.enticePackId || body.entice_pack_id)
  ) {
    return json(
      {
        error:
          "workflowRunId, visualizationId, or enticePackId is required for Entice Pack status",
        code: "entice_status_identity_required",
      },
      400,
    );
  }

  const headerIdempotencyKey = text(req.headers.get("idempotency-key"));
  const idempotencyKey = text(
    body.idempotencyKey || body.idempotency_key || headerIdempotencyKey,
  );

  try {
    // User OAuth/JWT callers retain their own identity. Service authority is
    // reserved for configured internal workers/webhooks. A future public API
    // must map scoped credentials to tenant identity server-side; a global key
    // plus caller-supplied userId is intentionally not supported.
    const upstreamBearer = serviceAuthorized ? serviceKey : bearer;
    const upstream = await fetch(
      `${supabaseUrl}/functions/v1/run-production-flow`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${upstreamBearer}`,
          apikey: serviceKey,
        },
        body: JSON.stringify({
          ...body,
          ...(idempotencyKey ? { idempotencyKey } : {}),
          workflowType,
          mode: isEnticePack ? "designpro_revision" : "designpro_job",
          action,
        }),
        // Atomic revision saves perform only structural validation, a fast
        // canonical request hash, and one database transaction. Byte hashing
        // belongs to the durable worker after acceptance.
        signal: AbortSignal.timeout(
          action === "save_revision" ? 30_000 : 120_000,
        ),
      },
    );
    const payload = await upstream.json().catch(() => ({
      error: `Orchestrator returned HTTP ${upstream.status}`,
    }));
    return json(payload, upstream.status);
  } catch (error) {
    const timedOut = (error as Error)?.name === "TimeoutError";
    return json(
      {
        error: timedOut
          ? isEnticePack
            ? "Orchestrator acceptance timed out; retry the same idempotent request or query status with its workflowRunId"
            : "Orchestrator acceptance timed out; query status with the same job ID before retrying"
          : String((error as Error)?.message || error),
        code: timedOut ? "acceptance_timeout" : "orchestrator_unavailable",
      },
      503,
    );
  }
});
