import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const workflow = readFileSync(resolve(root, ".github/workflows/deploy-production.yml"), "utf8");
const release = readFileSync(resolve(root, ".github/workflows/release.yml"), "utf8");
const remote = readFileSync(resolve(root, "ops/ci-dark-deploy.sh"), "utf8");
const backup = readFileSync(resolve(root, "ops/backup.sh"), "utf8");
const deploy = readFileSync(resolve(root, "ops/deploy.sh"), "utf8");
const inventoryScript = readFileSync(resolve(root, "ops/inventory.sh"), "utf8");

test("dark deploy is exact-main, environment protected, and new-host pinned", () => {
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /Exact DesignProAI release gate/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /AUDIT_ONLY_DESIGNPROAI_PROD_SFO3/);
  assert.match(workflow, /git log -1 --format=%B \| grep -Fq '\[dark-deploy\]'/);
  assert.match(workflow, /name: designproai-production/);
  assert.match(workflow, /TARGET_HOST: 137\.184\.0\.4/);
  assert.match(workflow, /TARGET_HOSTNAME: designproai-prod-sfo3/);
  assert.match(workflow, /SHA256:2MADGyqFCu7YrIRL\+\/qm1EcxQ0uEdQXFSN4\/JwBjWng/);
  assert.match(workflow, /ssh-keyscan[\s\S]*ssh-keygen -lf[\s\S]*EXPECTED_HOST_FINGERPRINT/);
  assert.doesNotMatch(workflow, /143\.110\.237\.145/);
});

test("deploy consumes one existing successful exact-main artifact and never rebuilds it", () => {
  assert.match(workflow, /TRIGGER_RUN_ID: \$\{\{ github\.event\.workflow_run\.id \}\}/);
  assert.match(workflow, /actions\/runs\/\$TRIGGER_RUN_ID/);
  assert.match(workflow, /actions\/workflows\/release\.yml\/runs\?head_sha=\$EXACT_SHA/);
  assert.match(workflow, /event=push&status=success/);
  assert.match(workflow, /test "\$count" -eq 1/);
  assert.match(workflow, /gh run download/);
  assert.match(workflow, /designproai-release-\$EXACT_SHA/);
  assert.match(workflow, /validate-archive\.py "\$archive" "\$EXACT_SHA"/);
  assert.doesNotMatch(workflow, /npm (?:ci|run build)|docker build|build-release\.sh/);
});

test("inventory precedes transfer and dark acceptance changes no public routing", () => {
  const providers = workflow.indexOf("Fail closed on all provider secret classes");
  const ssh = workflow.indexOf("Pin the new droplet SSH identity");
  const inventory = workflow.indexOf("Inventory the exact new droplet");
  const transfer = workflow.indexOf("Stage exact controls and artifact");
  assert.ok(providers >= 0 && ssh > providers);
  assert.ok(inventory >= 0 && transfer > inventory);
  assert.match(workflow, /ops\/inventory\.sh/);
  assert.match(workflow, /Unexpected DesignPro container/);
  assert.match(remote, /ALREADY_COMPLETE: exact release is locally accepted/);
  assert.match(remote, /acceptance\.sh" "\$EXACT_SHA"/);
  assert.doesNotMatch(`${workflow}\n${remote}`, /install-caddy\.sh|os\.designproai\.com.*curl|cloudflare|godaddy/i);
});

test("deployment does not apply migrations and requires all deployment secret names", () => {
  const source = `${workflow}\n${remote}`;
  for (const name of [
    "DESIGNPROAI_SSH_PRIVATE_KEY",
    "DESIGNPRO_SUPABASE_ACCESS_TOKEN",
    "DESIGNPRO_GOOGLE_AI_API_KEY",
    "DESIGNPRO_RESEND_API_KEY",
  ]) assert.match(source, new RegExp(name));
  assert.doesNotMatch(source, /secrets\.DESIGNPRO_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /api\.supabase\.com\/v1\/projects\/\$EXPECTED_PROJECT_REF\/api-keys/);
  assert.match(source, /\.id == \$ref/);
  assert.match(source, /::add-mask::\$service_key/);
  assert.match(source, /api\.resend\.com\/domains/);
  assert.doesNotMatch(source, /supabase\s+(?:db|migration)|db\s+(?:push|reset)|APPLY_DESIGNPRO_PRODUCTION/);
  assert.match(remote, /runtime-1/);
  assert.match(remote, /runtime-2/);
  assert.match(remote, /gateway/);
  assert.match(remote, /docker volume ls[\s\S]*-eq 0/);
});

test("the exact release gate asks Docker Compose itself to parse expanded production structure", () => {
  assert.match(release, /DESIGNPRO_SHA="\$EXACT_SHA" docker compose -f ops\/compose\.yaml config --quiet/);
});

test("fresh host deploy has no obsolete VectorizIt guard or host Node prerequisite", () => {
  assert.equal(existsSync(resolve(root, "ops/vectorize-guard.sh")), false);
  assert.doesNotMatch(backup, /vectorize-guard|:3200/);
  assert.doesNotMatch(deploy, /^for command in .*\bnode\b/m);
});

test("inventory records every Docker state class before deployment without reading secrets", () => {
  for (const contract of [
    /docker ps -a --no-trunc/,
    /docker images --digests --no-trunc/,
    /docker volume ls/,
    /docker network ls/,
    /docker compose ls --all/,
    /find -P \/opt\/designproai/,
  ]) assert.match(inventoryScript, contract);
  assert.doesNotMatch(inventoryScript, /cat .*\.env|source .*\.env/);
});
