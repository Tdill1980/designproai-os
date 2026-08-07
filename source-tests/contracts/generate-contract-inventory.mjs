import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(here, "../..");
const sources = {
  runtimeEntry: resolve(here, "../../runtime/index.js"),
  claimant: resolve(here, "../../runtime/designpro-standalone-claimant.cjs"),
  universalResolver: resolve(here, "../../runtime/genie-universal-resolver.cjs"),
  wrapboxDelivery: resolve(here, "../../runtime/wrapbox-delivery.cjs"),
  gateway: resolve(here, "../../gateway/src/server.mjs"),
};
const text = Object.fromEntries(Object.entries(sources).map(([key, file]) => [key, readFileSync(file, "utf8")]));

function balanced(source, start, open = "(", close = ")") {
  let depth = 0; let quote = ""; let escape = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escape) escape = false;
      else if (char === "\\") escape = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") { quote = char; continue; }
    if (char === open) depth += 1;
    if (char === close && --depth === 0) return source.slice(start + 1, index);
  }
  throw new Error(`unbalanced ${open}${close} at ${start}`);
}

function callArguments(source, marker) {
  const result = [];
  let cursor = 0;
  while ((cursor = source.indexOf(marker, cursor)) !== -1) {
    const open = source.indexOf("(", cursor + marker.length);
    result.push(balanced(source, open));
    cursor = open + 1;
  }
  return result;
}

function firstString(args) {
  return args.match(/^\s*["'`]([^"'`]+)["'`]/)?.[1] || null;
}

function sourceRef(sourceKey, source, index) {
  return { source: sourceKey, line: source.slice(0, index).split("\n").length };
}

const tables = {};
for (const [sourceKey, source] of Object.entries(text)) {
  for (const match of source.matchAll(/\.from\(["']([^"']+)["']\)/g)) {
    if (/\.storage\s*$/.test(source.slice(Math.max(0, match.index - 40), match.index))) continue;
    const name = match[1]; const tail = source.slice(match.index, match.index + 1000);
    const entry = tables[name] ||= { consumers: [], selects: [], writes: [] };
    entry.consumers.push(sourceRef(sourceKey, source, match.index));
    const select = tail.match(/\.select\(\s*["'`]([^"'`]+)["'`]/)?.[1];
    if (select && !entry.selects.includes(select)) entry.selects.push(select);
    for (const write of tail.matchAll(/\.(insert|update|upsert)\(\s*(\{[\s\S]*?\})\s*\)/g)) {
      entry.writes.push({ operation: write[1], expression: write[2].replace(/\s+/g, " ").slice(0, 2000), ...sourceRef(sourceKey, source, match.index) });
    }
  }
}
for (const value of Object.values(tables)) {
  value.consumers = value.consumers.filter((item, index, all) => all.findIndex((candidate) => candidate.source === item.source && candidate.line === item.line) === index);
  value.selects.sort();
}

const rpcs = {};
for (const [sourceKey, source] of Object.entries(text)) {
  let cursor = 0;
  while ((cursor = source.indexOf(".rpc(", cursor)) !== -1) {
    const args = balanced(source, cursor + 4);
    const name = firstString(args);
    if (name) {
      const comma = args.indexOf(",");
      const payloadExpression = comma < 0 ? null : args.slice(comma + 1).trim().replace(/\s+/g, " ");
      const entry = rpcs[name] ||= { callsites: [] };
      entry.callsites.push({ payloadExpression, ...sourceRef(sourceKey, source, cursor) });
    }
    cursor += 5;
  }
}

const runtimeEndpoints = [];
for (const match of text.runtimeEntry.matchAll(/app\.(get|post|put|delete|patch)\(\s*["']([^"']+)["']\s*,\s*([^,\n]+)/g)) {
  const next = text.runtimeEntry.indexOf("\napp.", match.index + 5);
  const handler = text.runtimeEntry.slice(match.index, next < 0 ? text.runtimeEntry.length : next);
  const destructures = [...handler.matchAll(/const\s*\{([\s\S]*?)\}\s*=\s*req\.body/g)]
    .map((item) => item[1].replace(/\/\/[^^\n]*|\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim());
  runtimeEndpoints.push({
    method: match[1].toUpperCase(), path: match[2],
    auth: match[3].includes("authMiddleware") ? "bearer-worker-secret" : "public",
    requestBodyDestructuring: destructures,
    ...sourceRef("runtimeEntry", text.runtimeEntry, match.index),
  });
}

const gatewayEndpoints = [
  { method: "GET", path: "/healthz", auth: "public", request: {}, response: ["status", "service"] },
  { method: "POST", path: "/api/auth/login", auth: "public", request: { required: ["email", "password"] }, response: ["HttpOnly dp_session cookie", "ok"] },
  { method: "GET", path: "/api/jobs", auth: "HttpOnly dp_session -> Supabase access token", request: {}, upstream: { mode: "workflow-type-dependent", action: "status", workflowRunId: "run.id" } },
  { method: "POST", path: "/api/revisions", auth: "HttpOnly dp_session -> Supabase access token", request: { required: ["revisionId", "generationId", "visualizationId", "expectedUpdatedAt", "renderAssets", "idempotencyKey", "revisionSnapshot"], optional: ["view", "instruction", "attachmentIds"] }, upstream: { rpcs: ["save_designpro_revision_source", "create_designpro_entice_workflow"] } },
  { method: "POST", path: "/api/production", auth: "HttpOnly dp_session -> Supabase access token", request: { required: ["enticeWorkflowRunId", "idempotencyKey"], optional: ["orderRequestId"] }, upstream: { rpc: "create_designpro_production_workflow" } },
  { method: "GET", path: "/api/jobs/:id", auth: "HttpOnly dp_session -> Supabase access token", upstream: { action: "status" } },
  { method: "POST", path: "/api/jobs/:id/resume", auth: "HttpOnly dp_session -> Supabase access token", upstream: { action: "resume", retryFailed: true } },
  { method: "POST", path: "/api/jobs/:id/approvals/preflight", auth: "HttpOnly dp_session -> Supabase access token; production job only", request: { optional: ["notes"] }, upstream: { mode: "designpro_job", action: "approve_preflight" } },
  { method: "POST", path: "/api/jobs/:id/approvals/final", auth: "HttpOnly dp_session -> Supabase access token; production job only", request: { optional: ["notes"] }, upstream: { mode: "designpro_job", action: "approve" } },
];

const inventory = {
  schemaVersion: "designpro.runtime-contract-inventory.v1",
  generatedFrom: Object.fromEntries(Object.entries(sources).map(([key, file]) => [key, file.replace(`${workspace}/`, "")])),
  storage: { buckets: ["wrap-files"], access: "private Supabase Storage; immutable input identities; service-role runtime reads and create-only derived writes" },
  tables: Object.fromEntries(Object.entries(tables).sort(([a], [b]) => a.localeCompare(b))),
  rpcs: Object.fromEntries(Object.entries(rpcs).sort(([a], [b]) => a.localeCompare(b))),
  endpoints: { runtime: runtimeEndpoints.sort((a, b) => `${a.path}:${a.method}`.localeCompare(`${b.path}:${b.method}`)), gateway: gatewayEndpoints, orchestrator: null },
};

process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
