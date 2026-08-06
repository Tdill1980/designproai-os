import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
};

const readBody = async (req) => {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 1_000_000) throw new Error("request_too_large");
  }
  return text ? JSON.parse(text) : {};
};

const cookie = (req, name) => Object.fromEntries(
  String(req.headers.cookie || "").split(";").map((part) => part.trim().split("=").map(decodeURIComponent)),
)[name] || "";

function config(env) {
  const supabaseUrl = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const anonKey = String(env.SUPABASE_ANON_KEY || "");
  if (!supabaseUrl || !anonKey) throw new Error("gateway_config_missing");
  return { supabaseUrl, anonKey, secure: env.NODE_ENV === "production" };
}

async function upstream(fetchImpl, url, init, accessToken, cfg) {
  return fetchImpl(url, { ...init, headers: { apikey: cfg.anonKey, authorization: `Bearer ${accessToken}`, "content-type": "application/json", ...(init?.headers || {}) } });
}

async function userFor(fetchImpl, token, cfg) {
  if (!token) return null;
  const response = await upstream(fetchImpl, `${cfg.supabaseUrl}/auth/v1/user`, { method: "GET" }, token, cfg);
  if (!response.ok) return null;
  return response.json();
}

function generationId(run) {
  return String(run?.results?.generationId || run?.results?.generation_id || run?.input?.generationId || run?.input?.generation_id || run.id);
}

function publicState(raw) {
  const run = raw.run || {}; const stages = raw.stages || [];
  const waitingPreflight = stages.some((s) => s.stage_key === "await_panelpro_preflight_qc" && ["running", "waiting", "blocked"].includes(s.status));
  const waitingFinal = stages.some((s) => s.stage_key === "await_final_human_qc" && ["running", "waiting", "blocked"].includes(s.status));
  const failed = stages.find((s) => s.status === "failed");
  const active = stages.find((s) => ["running", "waiting", "blocked"].includes(s.status)) || [...stages].reverse().find((s) => s.status === "completed");
  return {
    generationId: generationId(run), revision: Number(run.results?.revision || run.input?.revision || 1),
    state: failed ? "failed" : waitingPreflight ? "waiting_for_preflight" : waitingFinal ? "waiting_for_final_qc" : run.status === "completed" ? "complete" : run.status === "queued" ? "queued" : "running",
    currentStage: String(active?.stage_key || run.status || "queued"),
    stages: stages.map((s) => ({ key: s.stage_key, label: s.stage_key, state: s.status === "completed" ? "complete" : s.status === "failed" ? "failed" : s.status === "running" ? "running" : "pending", artifactUrl: s.output?.artifactUrl || undefined })),
    failure: failed ? { stage: failed.stage_key, message: String(failed.error_message || "Stage failed"), retryable: failed.retryable !== false } : undefined,
  };
}

async function listRuns(fetchImpl, token, cfg) {
  const fields = encodeURIComponent("id,workflow_type,status,results,input,created_at");
  const types = encodeURIComponent("(designpro.entice_pack,designpro.production_pack)");
  const response = await upstream(fetchImpl, `${cfg.supabaseUrl}/rest/v1/designpro_workflow_runs?select=${fields}&workflow_type=in.${types}&order=created_at.desc&limit=100`, { method: "GET" }, token, cfg);
  if (!response.ok) throw new Error(`runs_query_${response.status}`);
  return response.json();
}

async function runState(fetchImpl, token, cfg, run) {
  const runId = encodeURIComponent(run.id);
  const response = await upstream(fetchImpl, `${cfg.supabaseUrl}/rest/v1/designpro_workflow_stages?select=stage_key,status,output,error_message,error_details&run_id=eq.${runId}&order=sequence.asc`, { method: "GET" }, token, cfg);
  if (!response.ok) throw new Error(`stages_query_${response.status}`);
  return { run, stages: await response.json() };
}

async function resolveRun(fetchImpl, token, cfg, requestedGenerationId) {
  const runs = await listRuns(fetchImpl, token, cfg);
  return runs.find((run) => generationId(run) === requestedGenerationId || run.id === requestedGenerationId) || null;
}

async function rpc(fetchImpl, token, cfg, name, body) {
  const response = await upstream(fetchImpl, `${cfg.supabaseUrl}/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(body) }, token, cfg);
  const payload = await response.json().catch(() => ({ error: `invalid_${name}_response` }));
  if (!response.ok) throw Object.assign(new Error(payload.message || payload.error || `${name}_${response.status}`), { status: response.status });
  return payload;
}

export function createGateway({ env = process.env, fetchImpl = fetch } = {}) {
  const cfg = config(env);
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://gateway");
      if (req.method === "GET" && url.pathname === "/healthz") return json(res, 200, { status: "ok", service: "designpro-api-gateway" });
      if (req.method === "POST" && url.pathname === "/api/auth/login") {
        const body = await readBody(req);
        const auth = await fetchImpl(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: cfg.anonKey, "content-type": "application/json" }, body: JSON.stringify({ email: body.email, password: body.password }) });
        const payload = await auth.json().catch(() => ({}));
        if (!auth.ok || !payload.access_token) return json(res, 401, { error: "invalid_credentials" });
        const flags = `HttpOnly; Path=/; SameSite=Strict; Max-Age=${Number(payload.expires_in || 3600)}${cfg.secure ? "; Secure" : ""}`;
        return json(res, 200, { ok: true }, { "set-cookie": `dp_session=${encodeURIComponent(payload.access_token)}; ${flags}` });
      }
      const token = cookie(req, "dp_session");
      const user = await userFor(fetchImpl, token, cfg);
      if (!user?.id) return json(res, 401, { error: "authentication_required" });

      if (req.method === "GET" && url.pathname === "/api/jobs") {
        const runs = await listRuns(fetchImpl, token, cfg);
        const states = await Promise.all(runs.map((run) => runState(fetchImpl, token, cfg, run).then(publicState)));
        return json(res, 200, states);
      }
      if (req.method === "POST" && url.pathname === "/api/revisions") {
        const body = await readBody(req);
        const required = ["revisionId", "generationId", "visualizationId", "expectedUpdatedAt", "renderUrls", "idempotencyKey", "revisionSnapshot"];
        const missing = required.filter((key) => body[key] == null || body[key] === "");
        const snapshot = body.revisionSnapshot;
        const snapshotMissing = ["vehicle", "surfaceOptions", "finish", "bodyText", "expectedLogoInventory"]
          .filter((key) => snapshot?.[key] == null);
        const invalidSnapshot = !snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) ||
          snapshot.contractVersion !== "designpro.revision-snapshot.v1" ||
          typeof snapshot.vehicle !== "object" || Array.isArray(snapshot.vehicle) ||
          typeof snapshot.surfaceOptions !== "object" || Array.isArray(snapshot.surfaceOptions) ||
          !Array.isArray(snapshot.expectedLogoInventory) ||
          snapshot.expectedLogoInventory.some((item) => !item || typeof item !== "object" ||
            !item.identityKey || !item.surfaceKey || !item.storagePath || !/^[0-9a-f]{64}$/.test(String(item.contentHash || "")));
        if (missing.length || snapshotMissing.length || invalidSnapshot || typeof body.renderUrls !== "object" || Array.isArray(body.renderUrls)) {
          return json(res, 400, { error: "revision_contract_incomplete", missing, snapshotMissing });
        }
        const frozenSnapshot = { ...snapshot, revisionId: body.revisionId, generationId: body.generationId, designId: body.generationId, visualizationId: body.visualizationId, renderUrls: body.renderUrls, change: { ...(snapshot.change || {}), view: body.view, instruction: body.instruction, attachmentIds: body.attachmentIds || [] } };
        const saved = await rpc(fetchImpl, token, cfg, "save_designpro_revision_source", { p_revision_id: body.revisionId, p_generation_id: body.generationId, p_visualization_id: body.visualizationId, p_expected_updated_at: body.expectedUpdatedAt, p_snapshot: frozenSnapshot, p_snapshot_hash: null, p_idempotency_key: body.idempotencyKey });
        if (!/^[0-9a-f]{64}$/.test(String(saved.snapshotHash || ""))) throw new Error("revision_snapshot_hash_missing");
        const result = await rpc(fetchImpl, token, cfg, "create_designpro_entice_workflow", { p_revision_id: body.revisionId, p_idempotency_key: body.idempotencyKey, p_input: { trigger: "revision.saved", revisionSnapshotHash: saved.snapshotHash } });
        return json(res, 202, { runId: result.workflowRunId, accepted: true });
      }
      if (req.method === "POST" && url.pathname === "/api/production") {
        const body = await readBody(req);
        const required = ["enticeWorkflowRunId", "idempotencyKey"];
        const missing = required.filter((key) => body[key] == null || body[key] === "");
        if (missing.length) return json(res, 400, { error: "production_contract_incomplete", missing });
        const result = await rpc(fetchImpl, token, cfg, "create_designpro_production_workflow", { p_entice_run_id: body.enticeWorkflowRunId, p_idempotency_key: body.idempotencyKey, p_input: { orderRequestId: body.orderRequestId || null } });
        return json(res, 202, { runId: result.workflowRunId, accepted: true });
      }
      const match = url.pathname.match(/^\/api\/jobs\/([^/]+)(?:\/(resume|approvals\/(preflight|final)))?$/);
      if (match) {
        const requestedId = decodeURIComponent(match[1]); const run = await resolveRun(fetchImpl, token, cfg, requestedId);
        if (!run) return json(res, 404, { error: "job_not_found" });
        const mode = run.workflow_type === "designpro.entice_pack" ? "designpro_revision" : "designpro_job";
        if (req.method === "GET" && !match[2]) return json(res, 200, publicState(await runState(fetchImpl, token, cfg, run)));
        if (req.method === "POST" && match[2] === "resume") return json(res, 202, await rpc(fetchImpl, token, cfg, "resume_designpro_workflow", { p_run_id: run.id, p_actor: user.id, p_retry_failed: true }));
        if (req.method === "POST" && match[2]?.startsWith("approvals/")) {
          if (mode !== "designpro_job") return json(res, 409, { error: "production_job_required" });
          const body = await readBody(req); const action = match[3] === "preflight" ? "approve_preflight" : "approve";
          if (!body.qc || typeof body.qc !== "object" || Array.isArray(body.qc) || body.qc.known !== true || body.qc.pass !== true) {
            return json(res, 400, { error: "known_passing_qc_required" });
          }
          const rpcName = match[3] === "preflight" ? "approve_designpro_panelpro_preflight" : "approve_designpro_production_pack";
          return json(res, 202, await rpc(fetchImpl, token, cfg, rpcName, { p_run_id: run.id, p_actor: user.id, p_approval_ref: `${action}:${user.id}:${Date.now()}`, p_details: { notes: String(body.notes || ""), qc: body.qc } }));
        }
      }
      return json(res, 404, { error: "not_found" });
    } catch (error) {
      return json(res, Number(error.status || 500), { error: error.message || "gateway_error" });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8787);
  createGateway().listen(port, "0.0.0.0", () => console.log(`designpro-api-gateway listening on ${port}`));
}
